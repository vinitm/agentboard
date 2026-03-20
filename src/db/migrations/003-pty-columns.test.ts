import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../schema.js';

describe('migration 003: pty columns', () => {
  it('adds pid and terminal_mode columns to stage_logs', () => {
    const db = new Database(':memory:');
    initSchema(db);

    const cols = db.prepare('PRAGMA table_info(stage_logs)').all() as Array<{ name: string; type: string; dflt_value: string | null }>;
    const pidCol = cols.find(c => c.name === 'pid');
    const modeCol = cols.find(c => c.name === 'terminal_mode');

    expect(pidCol).toBeDefined();
    expect(pidCol!.type).toBe('INTEGER');

    expect(modeCol).toBeDefined();
    expect(modeCol!.type).toBe('TEXT');
    expect(modeCol!.dflt_value).toBe("'print'");
  });
});
