/**
 * EmbeddingService - Generate and cache text embeddings
 *
 * This service provides text embeddings for vector search.
 * It supports multiple embedding providers and implements caching to avoid redundant API calls.
 *
 * REFACTOR (Phase 2): New service to support VectorSearchStrategy
 * - Replaces ChromaDB's automatic embedding
 * - Implements caching layer
 * - Supports multiple providers (OpenAI, SDKAgent, etc.)
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

/**
 * Supported embedding providers
 */
export type EmbeddingProvider = 'openai' | 'sdkagent' | 'custom' | 'cached';

/**
 * Embedding result with metadata
 */
export interface EmbeddingResult {
  embedding: Float32Array;
  provider: EmbeddingProvider;
  cached: boolean;
  dimension: number;
  duration: number;
}

/**
 * Embedding cache entry
 */
interface CachedEmbedding {
  text_hash: string;
  embedding: string;  // Stored as base64 or comma-separated values
  provider: string;
  created_at: string;
}

export class EmbeddingService {
  private cacheEnabled: boolean = true;

  constructor(
    private db: Database,
    private openaiApiKey?: string,
    private customConfig?: {
      endpoint?: string;
      apiKey?: string;
      model?: string;
    }
  ) {
    this.initializeCacheTable();
  }

  /**
   * Initialize cache table if it doesn't exist
   */
  private initializeCacheTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text_hash TEXT UNIQUE NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        provider TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash
      ON embedding_cache(text_hash);

      CREATE INDEX IF NOT EXISTS idx_embedding_cache_created
      ON embedding_cache(created_at);
    `);
  }

  /**
   * Get embedding for a text query
   * - Checks cache first
   * - Uses configured provider if not cached
   * - Stores result in cache
   */
  async getEmbedding(text: string, provider: EmbeddingProvider = 'openai'): Promise<EmbeddingResult> {
    const startTime = Date.now();
    const textHash = this.hashText(text);

    // Check cache first
    if (this.cacheEnabled) {
      const cached = this.getFromCache(textHash);
      if (cached) {
        logger.debug('EMBEDDING', 'Cache hit', { textHash, provider });
        return {
          embedding: cached.embedding,
          provider: cached.provider as EmbeddingProvider,
          cached: true,
          dimension: cached.embedding.length,
          duration: Date.now() - startTime
        };
      }
    }

    // Generate embedding using configured provider
    const embedding = await this.generateEmbedding(text, provider);
    const duration = Date.now() - startTime;

    // Store in cache
    if (this.cacheEnabled) {
      this.storeInCache(textHash, text, embedding, provider);
    }

    logger.debug('EMBEDDING', 'Embedding generated', {
      textHash,
      provider,
      dimension: embedding.length,
      duration: `${duration}ms`
    });

    return {
      embedding,
      provider,
      cached: false,
      dimension: embedding.length,
      duration
    };
  }

  /**
   * Generate embedding using configured provider
   */
  private async generateEmbedding(
    text: string,
    provider: EmbeddingProvider
  ): Promise<Float32Array> {
    switch (provider) {
      case 'openai':
        return await this.generateWithOpenAI(text);

      case 'sdkagent':
        return await this.generateWithSDKAgent(text);

      case 'custom':
        return await this.generateWithCustom(text);

      default:
        throw new Error(`Unknown embedding provider: ${provider}`);
    }
  }

  /**
   * Generate embedding using OpenAI API
   */
  private async generateWithOpenAI(text: string): Promise<Float32Array> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not configured. Set EMBEDDING_OPENAI_API_KEY environment variable.');
    }

    logger.debug('EMBEDDING', 'Calling OpenAI API', { textLength: text.length });

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: text,
          model: 'text-embedding-ada-002'  // 1536 dimensions
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${error}`);
      }

      const data = await response.json();

      if (!data.data || !data.data[0] || !data.data[0].embedding) {
        throw new Error('Invalid OpenAI API response format');
      }

      const embeddingArray = data.data[0].embedding;
      return new Float32Array(embeddingArray);

    } catch (error) {
      logger.error('EMBEDDING', 'OpenAI API call failed', {}, error as Error);
      throw error;
    }
  }

  /**
   * Generate embedding using SDKAgent
   * This uses the existing claude-mem SDK agent infrastructure
   */
  private async generateWithSDKAgent(text: string): Promise<Float32Array> {
    // TODO: Implement SDKAgent integration
    // For now, fall back to OpenAI
    logger.warn('EMBEDDING', 'SDKAgent provider not implemented, falling back to OpenAI');
    return await this.generateWithOpenAI(text);
  }

  /**
   * Generate embedding using custom provider (z.ai, etc.)
   * Supports any OpenAI-compatible API
   */
  private async generateWithCustom(text: string): Promise<Float32Array> {
    if (!this.customConfig?.endpoint) {
      throw new Error('Custom embedding provider not configured. Set EMBEDDING_CUSTOM_ENDPOINT environment variable.');
    }

    if (!this.customConfig?.apiKey) {
      throw new Error('Custom embedding API key not configured. Set EMBEDDING_CUSTOM_API_KEY environment variable.');
    }

    const model = this.customConfig.model || 'text-embedding-ada-002';

    logger.debug('EMBEDDING', 'Calling custom embedding API', {
      endpoint: this.customConfig.endpoint,
      model,
      textLength: text.length
    });

    try {
      const response = await fetch(this.customConfig.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.customConfig.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: text,
          model: model
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Custom embedding API error: ${response.status} ${error}`);
      }

      const data = await response.json();

      // Support both OpenAI format (data.data[0].embedding) and direct format (data.embedding)
      let embeddingArray: number[];
      if (data.data && data.data[0] && data.data[0].embedding) {
        embeddingArray = data.data[0].embedding;
      } else if (data.embedding) {
        embeddingArray = data.embedding;
      } else {
        throw new Error('Invalid custom API response format. Expected {data: [{embedding: [...][]}]} or {embedding: [...]}');
      }

      return new Float32Array(embeddingArray);

    } catch (error) {
      logger.error('EMBEDDING', 'Custom embedding API call failed', {}, error as Error);
      throw error;
    }
  }

  /**
   * Get embedding from cache
   */
  private getFromCache(textHash: string): { embedding: Float32Array; provider: string } | null {
    try {
      const row = this.db.prepare(`
        SELECT embedding, provider
        FROM embedding_cache
        WHERE text_hash = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(textHash) as { embedding: Buffer; provider: string } | undefined;

      if (!row) {
        return null;
      }

      // Convert Buffer back to Float32Array
      const embeddingArray = new Float32Array(row.embedding.buffer);
      return {
        embedding: embeddingArray,
        provider: row.provider
      };

    } catch (error) {
      logger.error('EMBEDDING', 'Cache lookup failed', {}, error as Error);
      return null;
    }
  }

  /**
   * Store embedding in cache
   */
  private storeInCache(
    textHash: string,
    text: string,
    embedding: Float32Array,
    provider: string
  ): void {
    try {
      const embeddingBuffer = Buffer.from(embedding.buffer);

      this.db.prepare(`
        INSERT INTO embedding_cache (text_hash, text, embedding, provider, dimension, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        textHash,
        text,
        embeddingBuffer,
        provider,
        embedding.length,
        new Date().toISOString()
      );

      logger.debug('EMBEDDING', 'Stored in cache', { textHash, provider });

    } catch (error) {
      // Cache failure is not critical
      logger.warn('EMBEDDING', 'Failed to store in cache', {}, error as Error);
    }
  }

  /**
   * Hash text for cache lookup
   * Uses simple hash for speed (not cryptographic)
   */
  private hashText(text: string): string {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `h${Math.abs(hash)}`;
  }

  /**
   * Clear old cache entries (older than 30 days)
   */
  clearOldCache(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

    const result = this.db.prepare(`
      DELETE FROM embedding_cache
      WHERE created_at < ?
    `).run(cutoff);

    const deletedCount = result.changes;

    if (deletedCount > 0) {
      logger.info('EMBEDDING', 'Cleared old cache entries', { count: deletedCount });
    }

    return deletedCount;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { total: number; totalSize: number } {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(LENGTH(embedding)) as totalSize
      FROM embedding_cache
    `).get() as { total: number; totalSize: number } | undefined;

    return {
      total: stats?.total || 0,
      totalSize: stats?.totalSize || 0
    };
  }

  /**
   * Enable or disable caching
   */
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    logger.info('EMBEDDING', 'Cache ' + (enabled ? 'enabled' : 'disabled'));
  }
}
