import type Database from 'better-sqlite3';

export function runMigration003(db: Database.Database): void {
  try {
    db.exec(`ALTER TABLE stage_logs ADD COLUMN pid INTEGER`);
    console.log('[db] Added pid column to stage_logs');
  } catch {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE stage_logs ADD COLUMN terminal_mode TEXT NOT NULL DEFAULT 'print'`);
    console.log('[db] Added terminal_mode column to stage_logs');
  } catch {
    // Column already exists
  }
}
