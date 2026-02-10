/**
 * Vector Database Migration
 *
 * This migration creates the sqlite-vec tables to replace ChromaDB.
 * It adds:
 * 1. vec_obs - Vector table for observation embeddings
 * 2. vec_sessions - Vector table for session summary embeddings
 * 3. vec_prompts - Vector table for user prompt embeddings
 *
 * This removes the dependency on ChromaDB and Python/uv.
 */

import type { Migration } from '../Database.js';

/**
 * Check if sqlite-vec extension is available
 */
function checkVecExtension(db: import('bun:sqlite').Database): boolean {
  try {
    const result = db.prepare(`SELECT vec_version()`).get() as { vec_version: string } | undefined;
    return !!result?.vec_version;
  } catch {
    return false;
  }
}

/**
 * Enable sqlite-vec extension
 */
function enableVecExtension(db: import('bun:sqlite').Database): void {
  try {
    // Try to load sqlite-vec extension
    // This assumes sqlite-vec is installed as a loadable extension
    db.loadExtension('./vec0');
  } catch (error) {
    // If extension loading fails, log but don't fail the migration
    // The extension might be compiled into SQLite
    console.warn('Could not load sqlite-vec extension:', error);
  }
}

/**
 * Migration 018: Add vector tables for sqlite-vec
 */
export const Migration018: Migration = {
  version: 18,
  up: (db) => {
    console.log('Running Migration 018: Add vector tables for sqlite-vec');

    // Enable sqlite-vec extension
    enableVecExtension(db);

    // Check if extension is available
    if (!checkVecExtension(db)) {
      throw new Error('sqlite-vec extension is not available. Please install sqlite-vec.');
    }

    // Create vector table for observations
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_obs USING vec0(
        sqlite_id INTEGER PRIMARY KEY,
        embedding FLOAT(1536)
      );
    `);

    // Create vector table for session summaries
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_sessions USING vec0(
        sqlite_id INTEGER PRIMARY KEY,
        embedding FLOAT(1536)
      );
    `);

    // Create vector table for user prompts
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_prompts USING vec0(
        sqlite_id INTEGER PRIMARY KEY,
        embedding FLOAT(1536)
      );
    `);

    // Create indexes for metadata joins
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_obs_doc_type
      ON observations(doc_type);

      CREATE INDEX IF NOT EXISTS idx_obs_created_at
      ON observations(created_at_epoch);
    `);

    console.log('Migration 018 completed successfully');
  },

  down: (db) => {
    // Rollback: Drop vector tables
    db.exec(`DROP TABLE IF EXISTS vec_obs`);
    db.exec(`DROP TABLE IF EXISTS vec_sessions`);
    db.exec(`DROP TABLE IF EXISTS vec_prompts`);
    db.exec(`DROP INDEX IF EXISTS idx_obs_doc_type`);
    db.exec(`DROP INDEX IF EXISTS idx_obs_created_at`);
    console.log('Rolled back Migration 018');
  }
};
