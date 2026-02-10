/**
 * VectorSearchStrategy Tests
 *
 * Test suite for the new sqlite-vec based vector search strategy.
 * These tests verify that VectorSearchStrategy works correctly as a replacement for ChromaSearchStrategy.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { VectorSearchStrategy } from '../../../src/services/worker/search/strategies/VectorSearchStrategy.js';
import { EmbeddingService } from '../../../src/services/worker/EmbeddingService.js';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { ClaudeMemDatabase } from '../../../src/services/sqlite/Database.js';

describe('VectorSearchStrategy', () => {
  let db: Database;
  let sessionStore: SessionStore;
  let embeddingService: EmbeddingService;
  let vectorStrategy: VectorSearchStrategy;

  beforeAll(() => {
    // Create in-memory database for tests
    db = new ClaudeMemDatabase(':memory:').db;

    // Create vector tables (simulate Migration 018)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_obs USING vec0(
        sqlite_id INTEGER PRIMARY KEY,
        embedding FLOAT(1536)
      );

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT,
        project TEXT,
        text TEXT,
        type TEXT,
        title TEXT,
        subtitle TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT,
        created_at_epoch INTEGER,
        doc_type TEXT DEFAULT 'observation'
      );

      CREATE INDEX IF NOT EXISTS idx_obs_doc_type ON observations(doc_type);
      CREATE INDEX IF NOT EXISTS idx_obs_created_at ON observations(created_at_epoch);
    `);

    sessionStore = new SessionStore(db);
    embeddingService = new EmbeddingService(db);
    vectorStrategy = new VectorSearchStrategy(db, sessionStore, embeddingService);
  });

  describe('canHandle', () => {
    it('should return true when query is provided', () => {
      const result = vectorStrategy.canHandle({
        query: 'test query',
        limit: 10
      });

      expect(result).toBe(true);
    });

    it('should return false when query is not provided', () => {
      const result = vectorStrategy.canHandle({
        limit: 10
      });

      expect(result).toBe(false);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      // Insert test observations
      const insertStmt = db.prepare(`
        INSERT INTO observations (memory_session_id, project, text, type, title, created_at_epoch)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();

      // Create test observations
      insertStmt.run('session-1', 'test-project', 'Fixed authentication bug', 'bugfix', 'Auth fix', now - 1000); // 16 seconds ago
      insertStmt.run('session-2', 'test-project', 'Added new feature for users', 'feature', 'User feature', now - 86400000); // 1 day ago
      insertStmt.run('session-3', 'test-project', 'Database optimization complete', 'improvement', 'DB optimization', now - (90 * 24 * 60 * 60 * 1000 - 1000)); // 89 days ago
    });

    it('should return empty result when query matches nothing', async () => {
      const result = await vectorStrategy.search({
        query: 'xyz_nonexistent_query',
        limit: 10
      });

      expect(result.results.observations).toHaveLength(0);
      expect(result.results.sessions).toHaveLength(0);
      expect(result.results.prompts).toHaveLength(0);
      expect(result.strategy).toBe('vector');
      expect(result.usedChroma).toBe(false);
      expect(result.fellBack).toBe(false);
    });

    it('should filter by recency (90 days)', async () => {
      // Insert an embedding for the recent observation
      const embedding = new Float32Array(1536).fill(0.1);
      db.prepare('INSERT INTO vec_obs (sqlite_id, embedding) VALUES (?, ?)')
        .run(1, Buffer.from(embedding.buffer));

      // Mock the embedding service to return our test embedding
      const mockEmbedding = async () => embedding;

      // Temporarily replace getQueryEmbedding
      const originalMethod = vectorStrategy['getQueryEmbedding'].bind(vectorStrategy);
      vectorStrategy['getQueryEmbedding'] = mockEmbedding;

      try {
        const result = await vectorStrategy.search({
          query: 'authentication', // Will match our mocked embedding
          limit: 10
        });

        // Should only return recent observations (within 90 days)
        expect(result.results.observations.length).toBeGreaterThan(0);

        // All results should be within 90 days
        const cutoff = Date.now() - (90 * 24 * 60 * 60 * 1000);
        for (const obs of result.results.observations) {
          expect(obs.created_at_epoch).toBeGreaterThan(cutoff);
        }

        expect(result.strategy).toBe('vector');

      } finally {
        // Restore original method
        vectorStrategy['getQueryEmbedding'] = originalMethod;
      }
    });

    it('should categorize results by document type', async () => {
      // Insert embeddings for different document types
      const embedding = new Float32Array(1536).fill(0.2);
      db.prepare('INSERT INTO vec_obs (sqlite_id, embedding) VALUES (?, ?)')
        .run(1, Buffer.from(embedding.buffer));

      // Mock embedding service
      const mockEmbedding = async () => embedding;
      const originalMethod = vectorStrategy['getQueryEmbedding'].bind(vectorStrategy);
      vectorStrategy['getQueryEmbedding'] = mockEmbedding;

      try {
        const result = await vectorStrategy.search({
          query: 'test',
          searchType: 'observations',
          limit: 10
        });

        // Should only return observations
        expect(result.results.observations.length).toBeGreaterThan(0);
        expect(result.results.sessions).toHaveLength(0);
        expect(result.results.prompts).toHaveLength(0);

      } finally {
        vectorStrategy['getQueryEmbedding'] = originalMethod;
      }
    });

    it('should handle errors gracefully', async () => {
      // Mock getQueryEmbedding to throw error
      const mockError = async () => {
        throw new Error('Embedding service failed');
      };

      const originalMethod = vectorStrategy['getQueryEmbedding'].bind(vectorStrategy);
      vectorStrategy['getQueryEmbedding'] = mockError;

      try {
        const result = await vectorStrategy.search({
          query: 'test',
          limit: 10
        });

        // Should return empty result instead of throwing
        expect(result.results.observations).toHaveLength(0);
        expect(result.strategy).toBe('vector');

      } finally {
        vectorStrategy['getQueryEmbedding'] = originalMethod;
      }
    });
  });

  describe('filterByRecency', () => {
    it('should filter out items older than 90 days', () => {
      const now = Date.now();
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

      const items = [
        { id: 1, doc_type: 'observation', created_at_epoch: now - 1000, distance: 0.1 }, // Recent
        { id: 2, doc_type: 'observation', created_at_epoch: now - (ninetyDaysMs + 1000), distance: 0.2 }, // Too old
        { id: 3, doc_type: 'observation', created_at_epoch: now - (ninetyDaysMs / 2), distance: 0.3 }, // Within window
      ];

      // Access private method using bracket notation
      const filtered = vectorStrategy['filterByRecency'](items);

      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe(1);
      expect(filtered[1].id).toBe(3);
    });
  });

  describe('categorizeByDocType', () => {
    it('should correctly categorize items by type', () => {
      const items = [
        { id: 1, doc_type: 'observation' },
        { id: 2, doc_type: 'session_summary' },
        { id: 3, doc_type: 'user_prompt' },
        { id: 4, doc_type: 'observation' },
      ];

      const categorized = vectorStrategy['categorizeByDocType'](items, {
        searchObservations: true,
        searchSessions: true,
        searchPrompts: true
      });

      expect(categorized.obsIds).toEqual([1, 4]);
      expect(categorized.sessionIds).toEqual([2]);
      expect(categorized.promptIds).toEqual([3]);
    });

    it('should respect search type filters', () => {
      const items = [
        { id: 1, doc_type: 'observation' },
        { id: 2, doc_type: 'session_summary' },
        { id: 3, doc_type: 'user_prompt' },
      ];

      // Only search observations
      const categorized = vectorStrategy['categorizeByDocType'](items, {
        searchObservations: true,
        searchSessions: false,
        searchPrompts: false
      });

      expect(categorized.obsIds).toEqual([1]);
      expect(categorized.sessionIds).toEqual([]);
      expect(categorized.promptIds).toEqual([]);
    });
  });
});

describe('EmbeddingService', () => {
  let db: Database;
  let embeddingService: EmbeddingService;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
    embeddingService = new EmbeddingService(db, 'test-api-key');
  });

  describe('caching', () => {
    it('should cache embeddings', async () => {
      // Mock OpenAI API call
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          data: [{
            embedding: new Array(1536).fill(0.1)
          }]
        })
      });

      global.fetch = mockFetch as any;

      const text = 'test query';

      // First call - should hit API
      const result1 = await embeddingService.getEmbedding(text, 'openai');
      expect(result1.cached).toBe(false);

      // Second call - should hit cache
      const result2 = await embeddingService.getEmbedding(text, 'openai');
      expect(result2.cached).toBe(true);

      // Embeddings should be identical
      expect(result2.embedding).toEqual(result1.embedding);
    });

    it('should respect cache enabled flag', async () => {
      embeddingService.setCacheEnabled(false);

      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          data: [{
            embedding: new Array(1536).fill(0.2)
          }]
        })
      });

      global.fetch = mockFetch as any;

      const text = 'test query';

      // Both calls should hit API when cache is disabled
      const result1 = await embeddingService.getEmbedding(text, 'openai');
      const result2 = await embeddingService.getEmbedding(text, 'openai');

      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);
    });
  });

  describe('getQueryEmbedding', () => {
    it('should generate embedding with correct dimension', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          data: [{
            embedding: new Array(1536).fill(0.3)
          }]
        })
      });

      global.fetch = mockFetch as any;

      const result = await embeddingService.getEmbedding('test', 'openai');

      expect(result.embedding).toBeInstanceOf(Float32Array);
      expect(result.embedding.length).toBe(1536);
      expect(result.dimension).toBe(1536);
    });

    it('should handle OpenAI API errors', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      });

      global.fetch = mockFetch as any;

      await expect(embeddingService.getEmbedding('test', 'openai'))
        .rejects.toThrow('OpenAI API error: 500');
    });
  });

  describe('cache management', () => {
    it('should clear old cache entries', () => {
      // Insert some old cache entries manually
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(`
        INSERT INTO embedding_cache (text_hash, text, embedding, provider, dimension, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('hash1', 'text1', new Uint8Array([]), 'openai', 1536, oldDate);

      db.prepare(`
        INSERT INTO embedding_cache (text_hash, text, embedding, provider, dimension, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('hash2', 'text2', new Uint8Array([]), 'openai', 1536, new Date().toISOString());

      // Clear cache entries older than 30 days
      const deletedCount = embeddingService.clearOldCache(30 * 24 * 60 * 60 * 1000);

      expect(deletedCount).toBe(1); // Only the old entry should be deleted
    });

    it('should provide cache statistics', () => {
      const stats = embeddingService.getCacheStats();

      expect(stats.total).toBeDefined();
      expect(stats.totalSize).toBeDefined();
      expect(stats.total).toBe(0); // No entries yet
    });
  });
});
