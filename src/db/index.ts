import Database from 'better-sqlite3';
import { initSchema } from './schema.js';

let _db: Database.Database | null = null;

/**
 * Open (or create) a SQLite database at the given path,
 * enable WAL mode, and run schema migrations.
 */
export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Initialize schema
  initSchema(db);

  // Store as singleton
  _db = db;

  return db;
}

/**
 * Return the singleton database instance.
 * Throws if createDatabase() has not been called yet.
 */
export function getDatabase(): Database.Database {
  if (!_db) {
    throw new Error(
      'Database not initialized. Call createDatabase() first.'
    );
  }
  return _db;
}
