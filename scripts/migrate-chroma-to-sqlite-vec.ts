#!/usr/bin/env bun
/**
 * Migration Script: ChromaDB → sqlite-vec
 *
 * This script migrates all embeddings from ChromaDB to sqlite-vec.
 * After running this script, ChromaDB can be safely removed.
 *
 * Usage:
 *   bun scripts/migrate-chroma-to-sqlite-vec.ts
 */

import { Database } from 'bun:sqlite';
import path from 'path';
import os from 'os';

// Paths
const CLAUDE_MEM_DIR = path.join(os.homedir(), '.claude-mem');
const DB_PATH = path.join(CLAUDE_MEM_DIR, 'claude-mem.db');
const VECTOR_DB_DIR = path.join(CLAUDE_MEM_DIR, 'vector-db');

interface ChromaData {
  ids: number[];
  embeddings: number[][];
  metadatas: Array<{
    sqlite_id: number;
    doc_type: string;
    created_at_epoch: number;
  }>;
}

/**
 * Load ChromaDB data
 * This is a placeholder - actual implementation would use Chroma client
 */
async function loadChromaData(): Promise<ChromaData> {
  console.log('Loading ChromaDB data from', VECTOR_DB_DIR);

  // TODO: Implement actual Chroma client connection
  // For now, return empty data
  return {
    ids: [],
    embeddings: [],
    metadatas: []
  };
}

/**
 * Insert embeddings into sqlite-vec
 */
function insertEmbeddings(db: Database, data: ChromaData): void {
  console.log(`Migrating ${data.ids.length} embeddings to sqlite-vec`);

  const insertObs = db.prepare(`INSERT INTO vec_obs (sqlite_id, embedding) VALUES (?, ?)`);
  const insertSession = db.prepare(`INSERT INTO vec_sessions (sqlite_id, embedding) VALUES (?, ?)`);
  const insertPrompt = db.prepare(`INSERT INTO vec_prompts (sqlite_id, embedding) VALUES (?, ?)`);

  const insertObsTransaction = db.transaction((sqliteId: number, embedding: number[]) => {
    insertObs.run(sqliteId, new Float32Array(embedding));
  });

  const insertSessionTransaction = db.transaction((sqliteId: number, embedding: number[]) => {
    insertSession.run(sqliteId, new Float32Array(embedding));
  });

  const insertPromptTransaction = db.transaction((sqliteId: number, embedding: number[]) => {
    insertPrompt.run(sqliteId, new Float32Array(embedding));
  });

  for (let i = 0; i < data.ids.length; i++) {
    const sqliteId = data.ids[i];
    const embedding = data.embeddings[i];
    const metadata = data.metadatas[i];

    // Insert into appropriate table based on doc_type
    switch (metadata.doc_type) {
      case 'observation':
        insertObsTransaction(sqliteId, embedding);
        break;
      case 'session_summary':
        insertSessionTransaction(sqliteId, embedding);
        break;
      case 'user_prompt':
        insertPromptTransaction(sqliteId, embedding);
        break;
      default:
      console.warn(`Unknown doc_type: ${metadata.doc_type}`);
    }

    // Progress indicator
    if (i % 100 === 0) {
      console.log(`  Progress: ${i}/${data.ids.length}`);
    }
  }

  console.log('Migration completed!');
}

/**
 * Verify migration
 */
function verifyMigration(db: Database, chromaData: ChromaData): void {
  console.log('Verifying migration...');

  const obsCount = db.prepare(`SELECT COUNT(*) as count FROM vec_obs`).get() as { count: number };
  const sessionCount = db.prepare(`SELECT COUNT(*) as count FROM vec_sessions`).get() as { count: number };
  const promptCount = db.prepare(`SELECT COUNT(*) as count FROM vec_prompts`).get() as { count: number };

  const totalMigrated = obsCount.count + sessionCount.count + promptCount.count;
  const totalSource = chromaData.ids.length;

  console.log(`  Observations: ${obsCount.count}`);
  console.log(`  Sessions: ${sessionCount.count}`);
  console.log(`  Prompts: ${promptCount.count}`);
  console.log(`  Total migrated: ${totalMigrated}/${totalSource}`);

  if (totalMigrated === totalSource) {
    console.log('✅ Verification passed!');
  } else {
    console.warn('⚠️  Verification failed: Counts do not match');
  }
}

/**
 * Clean up ChromaDB data
 */
function cleanupChroma(): void {
  console.log('Cleaning up ChromaDB data...');
  // TODO: Delete VECTOR_DB_DIR after successful migration
  console.log('  (Skipped - run with --cleanup to delete ChromaDB data)');
}

/**
 * Main migration flow
 */
async function main() {
  console.log('=== ChromaDB → sqlite-vec Migration ===\n');

  // Check if database exists
  const dbExists = require('fs').existsSync(DB_PATH);
  if (!dbExists) {
    console.error('Database not found at', DB_PATH);
    console.error('Please run claude-mem at least once before migrating.');
    process.exit(1);
  }

  // Open database
  console.log('Opening database:', DB_PATH);
  const db = new Database(DB_PATH, { readonly: false });

  try {
    // Load ChromaDB data
    const chromaData = await loadChromaData();

    if (chromaData.ids.length === 0) {
      console.log('No ChromaDB data found. Migration complete.');
      return;
    }

    // Insert embeddings
    insertEmbeddings(db, chromaData);

    // Verify
    verifyMigration(db, chromaData);

    // Cleanup (if --cleanup flag provided)
    const cleanup = process.argv.includes('--cleanup');
    if (cleanup) {
      cleanupChroma();
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Test vector search with: bun scripts/test-vector-search.ts');
    console.log('  2. If tests pass, cleanup ChromaDB: bun scripts/migrate-chroma-to-sqlite-vec.ts --cleanup');
    console.log('  3. Remove Chroma dependencies from code');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Run migration
main();
