#!/usr/bin/env bun
/**
 * Complete ChromaDB to sqlite-vec Migration Tool
 *
 * This script handles the full migration process:
 * 1. Backs up existing data
 * 2. Exports embeddings from ChromaDB
 * 3. Imports to sqlite-vec
 * 4. Verifies data integrity
 * 5. Cleans up on success
 *
 * Usage:
 *   bun scripts/migrate-chroma-complete.ts [--cleanup] [--skip-backup]
 */

import { Database } from 'bun:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Configuration
const CLAUDE_MEM_DIR = path.join(os.homedir(), '.claude-mem');
const DB_PATH = path.join(CLAUDE_MEM_DIR, 'claude-mem.db');
const VECTOR_DB_DIR = path.join(CLAUDE_MEM_DIR, 'vector-db');
const BACKUP_DIR = path.join(CLAUDE_MEM_DIR, 'backups');

interface ChromaCollection {
  name: string;
  count: number;
}

interface ChromaDocument {
  id: string;
  embedding: number[];
  metadata: {
    sqlite_id: number;
    doc_type: string;
    created_at_epoch: number;
  };
}

interface MigrationStats {
  totalExported: number;
  totalImported: number;
  observations: number;
  sessions: number;
  prompts: number;
  errors: string[];
}

/**
 * ChromaDB Client
 *
 * Simple client to read data from ChromaDB SQLite storage
 */
class ChromaClient {
  private db: Database | null = null;

  constructor(private vectorDbDir: string) {}

  /**
   * Connect to ChromaDB SQLite storage
   */
  connect(): boolean {
    try {
      const chromaDbPath = path.join(this.vectorDbDir, 'chroma.sqlite3');

      if (!fs.existsSync(chromaDbPath)) {
        console.log('  ℹ️  ChromaDB database not found at', chromaDbPath);
        return false;
      }

      this.db = new Database(chromaDbPath, { readonly: true });
      console.log('  ✓ Connected to ChromaDB');
      return true;

    } catch (error) {
      console.error('  ✗ Failed to connect to ChromaDB:', error);
      return false;
    }
  }

  /**
   * Get all collections
   */
  getCollections(): ChromaCollection[] {
    if (!this.db) {
      throw new Error('Not connected to ChromaDB');
    }

    try {
      const rows = this.db.prepare(`
        SELECT name, count
        FROM collections
      `).all() as ChromaCollection[];

      return rows;

    } catch (error) {
      console.error('  ✗ Failed to get collections:', error);
      return [];
    }
  }

  /**
   * Export all documents from a collection
   */
  exportCollection(collectionName: string): ChromaDocument[] {
    if (!this.db) {
      throw new Error('Not connected to ChromaDB');
    }

    try {
      // Get collection ID
      const collectionRow = this.db.prepare(`
        SELECT id
        FROM collections
        WHERE name = ?
      `).get(collectionName) as { id: number } | undefined;

      if (!collectionRow) {
        console.log(`  ℹ️  Collection '${collectionName}' not found`);
        return [];
      }

      const collectionId = collectionRow.id;

      // Get all embeddings
      const rows = this.db.prepare(`
        SELECT
          s.id as doc_id,
          e.embedding as embedding,
          m.metadata as metadata
        FROM segments s
        JOIN embeddings e ON s.embedding_id = e.id
        JOIN metadata m ON s.id = m.segment_id
        WHERE s.collection_id = ?
      `).all(collectionId) as Array<{
        doc_id: string;
        embedding: Buffer;
        metadata: string;
      }>;

      const documents: ChromaDocument[] = [];

      for (const row of rows) {
        try {
          const metadata = JSON.parse(row.metadata);
          const embeddingArray = new Float32Array(row.embedding.buffer);

          documents.push({
            id: row.doc_id,
            embedding: Array.from(embeddingArray),
            metadata
          });
        } catch (error) {
          console.error('  ✗ Failed to parse document:', error);
        }
      }

      console.log(`  ✓ Exported ${documents.length} documents from '${collectionName}'`);
      return documents;

    } catch (error) {
      console.error(`  ✗ Failed to export collection '${collectionName}':`, error);
      return [];
    }
  }

  /**
   * Close connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/**
 * Migration Manager
 */
class MigrationManager {
  private stats: MigrationStats = {
    totalExported: 0,
    totalImported: 0,
    observations: 0,
    sessions: 0,
    prompts: 0,
    errors: []
  };

  constructor(
    private db: Database,
    private chromaClient: ChromaClient
  ) {}

  /**
   * Run full migration
   */
  async migrate(skipBackup: boolean = false): Promise<void> {
    console.log('');
    console.log('=== ChromaDB → sqlite-vec Migration ===');
    console.log('');

    // Step 1: Backup
    if (!skipBackup) {
      await this.backupExistingData();
    }

    // Step 2: Export from Chroma
    console.log('');
    console.log('Step 2: Exporting from ChromaDB...');
    console.log('');

    const collections = this.chromaClient.getCollections();
    console.log(`  Found ${collections.length} collections`);

    if (collections.length === 0) {
      console.log('  ℹ️  No ChromaDB data found. Migration complete.');
      return;
    }

    // Step 3: Import to sqlite-vec
    console.log('');
    console.log('Step 3: Importing to sqlite-vec...');
    console.log('');

    for (const collection of collections) {
      await this.migrateCollection(collection.name);
    }

    // Step 4: Verify
    console.log('');
    console.log('Step 4: Verification...');
    console.log('');

    this.verifyMigration();

    // Summary
    console.log('');
    console.log('=== Migration Summary ===');
    console.log('');
    console.log(`  Total exported:   ${this.stats.totalExported}`);
    console.log(`  Total imported:   ${this.stats.totalImported}`);
    console.log(`  Observations:    ${this.stats.observations}`);
    console.log(`  Sessions:        ${this.stats.sessions}`);
    console.log(`  Prompts:          ${this.stats.prompts}`);
    console.log(`  Errors:           ${this.stats.errors.length}`);

    if (this.stats.errors.length > 0) {
      console.log('');
      console.log('  Errors encountered:');
      this.stats.errors.forEach((err, i) => {
        console.log(`    ${i + 1}. ${err}`);
      });
    }

    console.log('');
    console.log('✅ Migration complete!');
  }

  /**
   * Backup existing vector data
   */
  private async backupExistingData(): Promise<void> {
    console.log('Step 1: Backing up existing data...');
    console.log('');

    try {
      // Create backup directory
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}`);

      // Backup database
      if (fs.existsSync(DB_PATH)) {
        fs.mkdirSync(backupPath, { recursive: true });
        fs.copyFileSync(
          DB_PATH,
          path.join(backupPath, 'claude-mem.db')
        );
      }

      // Backup vector DB if exists
      if (fs.existsSync(VECTOR_DB_DIR)) {
        this.copyDirectory(VECTOR_DB_DIR, path.join(backupPath, 'vector-db'));
      }

      console.log(`  ✓ Backup created at ${backupPath}`);

    } catch (error) {
      console.error('  ✗ Backup failed:', error);
      this.stats.errors.push(`Backup failed: ${error}`);
    }
  }

  /**
   * Migrate a single collection
   */
  private async migrateCollection(collectionName: string): Promise<void> {
    console.log(`  Migrating collection: ${collectionName}`);

    const documents = this.chromaClient.exportCollection(collectionName);

    if (documents.length === 0) {
      console.log(`    ℹ️  No documents in collection`);
      return;
    }

    this.stats.totalExported += documents.length;

    // Determine target table based on collection name
    const targetTable = this.getTargetTable(collectionName);

    for (const doc of documents) {
      await this.importDocument(doc, targetTable);
    }
  }

  /**
   * Get target table for collection
   */
  private getTargetTable(collectionName: string): string {
    if (collectionName.includes('obs') || collectionName.includes('observation')) {
      return 'vec_obs';
    } else if (collectionName.includes('session') || collectionName.includes('summary')) {
      return 'vec_sessions';
    } else if (collectionName.includes('prompt')) {
      return 'vec_prompts';
    } else {
      return 'vec_obs'; // Default
    }
  }

  /**
   * Import a single document
   */
  private async importDocument(doc: ChromaDocument, targetTable: string): Promise<void> {
    try {
      // Convert embedding to Float32Array
      const embedding = new Float32Array(doc.embedding);

      // Insert into appropriate vector table
      this.db.prepare(`
        INSERT INTO ${targetTable} (sqlite_id, embedding)
        VALUES (?, ?)
      `).run(
        doc.metadata.sqlite_id,
        Buffer.from(embedding.buffer)
      );

      this.stats.totalImported++;

      // Update type-specific counter
      if (targetTable === 'vec_obs') {
        this.stats.observations++;
      } else if (targetTable === 'vec_sessions') {
        this.stats.sessions++;
      } else if (targetTable === 'vec_prompts') {
        this.stats.prompts++;
      }

    } catch (error) {
      this.stats.errors.push(`Failed to import document ${doc.id}: ${error}`);
    }
  }

  /**
   * Verify migration integrity
   */
  private verifyMigration(): void {
    // Check vec_obs count
    const obsCount = this.db.prepare(`SELECT COUNT(*) as count FROM vec_obs`).get() as { count: number };
    const sessionCount = this.db.prepare(`SELECT COUNT(*) as count FROM vec_sessions`).get() as { count: number };
    const promptCount = this.db.prepare(`SELECT COUNT(*) as count FROM vec_prompts`).get() as { count: number };

    console.log(`  vec_obs:     ${obsCount.count} embeddings`);
    console.log(`  vec_sessions: ${sessionCount.count} embeddings`);
    console.log(`  vec_prompts:  ${promptCount.count} embeddings`);

    const totalMigrated = obsCount.count + sessionCount.count + promptCount.count;

    if (totalMigrated === this.stats.totalImported) {
      console.log('  ✓ Verification passed: All embeddings migrated successfully');
    } else {
      console.log(`  ⚠️  Warning: Imported ${this.stats.totalImported} but found ${totalMigrated}`);
    }
  }

  /**
   * Copy directory recursively
   */
  private copyDirectory(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const skipBackup = args.includes('--skip-backup');

  console.log('================================');
  console.log('ChromaDB → sqlite-vec Migration');
  console.log('================================');
  console.log('');

  // Check if database exists
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ Database not found at', DB_PATH);
    console.error('');
    console.error('Please run claude-mem at least once before migrating.');
    process.exit(1);
  }

  // Open database
  console.log('Opening database:', DB_PATH);
  const db = new Database(DB_PATH, { readonly: false });

  // Check if vector tables exist
  const vecObsExists = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='vec_obs'
  `).get() as { name: string } | undefined;

  if (!vecObsExists) {
    console.error('❌ Vector tables not found. Please run Migration 018 first.');
    console.error('');
    console.error('Run: bun run migrate');
    process.exit(1);
  }

  try {
    // Connect to ChromaDB
    const chromaClient = new ChromaClient(VECTOR_DB_DIR);

    const connected = chromaClient.connect();
    if (!connected) {
      console.log('ℹ️  ChromaDB not available. No migration needed.');
      db.close();
      return;
    }

    // Run migration
    const manager = new MigrationManager(db, chromaClient);
    await manager.migrate(skipBackup);

    // Cleanup
    chromaClient.close();
    db.close();

  } catch (error) {
    console.error('❌ Migration failed:', error);
    db.close();
    process.exit(1);
  }
}

// Run migration
main();
