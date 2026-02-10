/**
 * VectorSearchStrategy - Vector-based semantic search via sqlite-vec
 *
 * This strategy handles semantic search queries using sqlite-vec extension:
 * 1. Query sqlite-vec for semantically similar documents
 * 2. Filter by recency (90-day window)
 * 3. Categorize by document type
 * 4. Hydrate from SQLite
 *
 * Used when: Query text is provided and sqlite-vec is available
 *
 * REPLACES: ChromaSearchStrategy (removes Chroma/Python dependency)
 */

import { BaseSearchStrategy, SearchStrategy } from './SearchStrategy.js';
import {
  StrategySearchOptions,
  StrategySearchResult,
  SEARCH_CONSTANTS,
  ObservationSearchResult,
  SessionSummarySearchResult,
  UserPromptSearchResult
} from '../types.js';
import { SessionStore } from '../../../sqlite/SessionStore.js';
import { EmbeddingService } from '../../EmbeddingService.js';
import { logger } from '../../../../utils/logger.js';
import { Database } from 'bun:sqlite';

export class VectorSearchStrategy extends BaseSearchStrategy implements SearchStrategy {
  readonly name = 'vector';

  constructor(
    private db: Database,
    private sessionStore: SessionStore,
    private embeddingService: EmbeddingService
  ) {
    super();
  }

  canHandle(options: StrategySearchOptions): boolean {
    // Can handle when query text is provided
    return !!options.query;
  }

  async search(options: StrategySearchOptions): Promise<StrategySearchResult> {
    const {
      query,
      searchType = 'all',
      obsType,
      concepts,
      files,
      limit = SEARCH_CONSTANTS.DEFAULT_LIMIT,
      project,
      orderBy = 'date_desc'
    } = options;

    if (!query) {
      return this.emptyResult('sqlite');
    }

    const searchObservations = searchType === 'all' || searchType === 'observations';
    const searchSessions = searchType === 'all' || searchType === 'sessions';
    const searchPrompts = searchType === 'all' || searchType === 'prompts';

    let observations: ObservationSearchResult[] = [];
    let sessions: SessionSummarySearchResult[] = [];
    let prompts: UserPromptSearchResult[] = [];

    try {
      // Step 1: Get embedding for query (would need embedding service)
      const queryEmbedding = await this.getQueryEmbedding(query);

      // Step 2: Query sqlite-vec for similar documents
      logger.debug('SEARCH', 'VectorSearchStrategy: Querying sqlite-vec', { query, searchType });
      const vecResults = this.queryVectorDB(queryEmbedding, limit * 2); // Fetch more for filtering

      logger.debug('SEARCH', 'VectorSearchStrategy: sqlite-vec returned matches', {
        matchCount: vecResults.length
      });

      if (vecResults.length === 0) {
        return {
          results: { observations: [], sessions: [], prompts: [] },
          usedChroma: false,
          fellBack: false,
          strategy: 'vector'
        };
      }

      // Step 3: Filter by recency (90 days)
      const recentItems = this.filterByRecency(vecResults);
      logger.debug('SEARCH', 'VectorSearchStrategy: Filtered by recency', {
        count: recentItems.length
      });

      // Step 4: Categorize by document type
      const categorized = this.categorizeByDocType(recentItems, {
        searchObservations,
        searchSessions,
        searchPrompts
      });

      // Step 5: Hydrate from SQLite with additional filters
      if (categorized.obsIds.length > 0) {
        const obsOptions = { type: obsType, concepts, files, orderBy, limit, project };
        observations = this.sessionStore.getObservationsByIds(categorized.obsIds, obsOptions);
      }

      if (categorized.sessionIds.length > 0) {
        sessions = this.sessionStore.getSessionSummariesByIds(categorized.sessionIds, {
          orderBy,
          limit,
          project
        });
      }

      if (categorized.promptIds.length > 0) {
        prompts = this.sessionStore.getUserPromptsByIds(categorized.promptIds, {
          orderBy,
          limit,
          project
        });
      }

      logger.debug('SEARCH', 'VectorSearchStrategy: Hydrated results', {
        observations: observations.length,
        sessions: sessions.length,
        prompts: prompts.length
      });

      return {
        results: { observations, sessions, prompts },
        usedChroma: false,
        fellBack: false,
        strategy: 'vector'
      };

    } catch (error) {
      logger.error('SEARCH', 'VectorSearchStrategy: Search failed', {}, error as Error);
      // Return empty result - caller may try fallback strategy
      return {
        results: { observations: [], sessions: [], prompts: [] },
        usedChroma: false,
        fellBack: false,
        strategy: 'vector'
      };
    }
  }

  /**
   * Get embedding for query text
   * Uses EmbeddingService with caching
   */
  private async getQueryEmbedding(query: string): Promise<Float32Array> {
    // Determine which provider to use
    // Priority: custom > openai > sdkagent
    let provider: 'openai' | 'custom' = 'openai';

    const customEndpoint = process.env.EMBEDDING_CUSTOM_ENDPOINT;
    const customKey = process.env.EMBEDDING_CUSTOM_API_KEY;

    if (customEndpoint && customKey) {
      provider = 'custom';
    }

    const result = await this.embeddingService.getEmbedding(query, provider);
    return result.embedding;
  }

  /**
   * Query sqlite-vec for similar documents
   */
  private queryVectorDB(embedding: Float32Array, limit: number): Array<{
    id: number;
    doc_type: string;
    created_at_epoch: number;
    distance: number;
  }> {
    try {
      const sql = `
        SELECT
          v.sqlite_id as id,
          o.doc_type,
          o.created_at_epoch,
          v.distance
        FROM vec_obs v
        JOIN observations o ON o.id = v.sqlite_id
        WHERE v.embedding MATCH vec_embedding(?)
        ORDER BY v.distance
        LIMIT ?
      `;

      const results = this.db.prepare(sql).all(
        Array.from(embedding),  // Convert Float32Array to array for sqlite
        limit
      ) as Array<{
        id: number;
        doc_type: string;
        created_at_epoch: number;
        distance: number;
      }>;

      return results;

    } catch (error) {
      logger.error('SEARCH', 'VectorSearchStrategy: sqlite-vec query failed', {}, error as Error);
      return [];
    }
  }

  /**
   * Filter results by recency (90-day window)
   */
  private filterByRecency(items: Array<{
    id: number;
    doc_type: string;
    created_at_epoch: number;
    distance: number;
  }>): typeof items {
    const cutoff = Date.now() - SEARCH_CONSTANTS.RECENCY_WINDOW_MS;

    return items.filter(item => item.created_at_epoch > cutoff);
  }

  /**
   * Categorize IDs by document type
   */
  private categorizeByDocType(
    items: Array<{ id: number; doc_type: string }>,
    options: {
      searchObservations: boolean;
      searchSessions: boolean;
      searchPrompts: boolean;
    }
  ): { obsIds: number[]; sessionIds: number[]; promptIds: number[] } {
    const obsIds: number[] = [];
    const sessionIds: number[] = [];
    const promptIds: number[] = [];

    for (const item of items) {
      const docType = item.doc_type;
      if (docType === 'observation' && options.searchObservations) {
        obsIds.push(item.id);
      } else if (docType === 'session_summary' && options.searchSessions) {
        sessionIds.push(item.id);
      } else if (docType === 'user_prompt' && options.searchPrompts) {
        promptIds.push(item.id);
      }
    }

    return { obsIds, sessionIds, promptIds };
  }
}
