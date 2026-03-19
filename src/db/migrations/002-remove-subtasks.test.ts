import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from '../../test/helpers.js';
import { runMigration002 } from './002-remove-subtasks.js';

/**
 * Create a DB with the old schema (including parent_task_id, column_position, subtask_id)
 * so we can test that the migration removes them.
 */
function createOldSchemaDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      config_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_projects_path ON projects(path);

    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'backlog',
      risk_level TEXT NOT NULL DEFAULT 'low',
      priority INTEGER NOT NULL DEFAULT 0,
      column_position INTEGER NOT NULL DEFAULT 0,
      spec TEXT,
      blocked_reason TEXT,
      blocked_at_stage TEXT,
      claimed_at TEXT,
      claimed_by TEXT,
      chat_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX idx_tasks_status ON tasks(status);
    CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id);
    CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);

    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      attempt INTEGER NOT NULL DEFAULT 1,
      tokens_used INTEGER,
      model_used TEXT,
      input TEXT,
      output TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE stage_logs (
      id TEXT PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      stage TEXT NOT NULL,
      subtask_id INTEGER,
      attempt INTEGER NOT NULL DEFAULT 1,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      summary TEXT,
      tokens_used INTEGER,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX idx_stage_logs_task_id ON stage_logs(task_id, started_at);
    CREATE INDEX idx_stage_logs_project_id ON stage_logs(project_id);
    CREATE INDEX idx_stage_logs_status ON stage_logs(status);
  `);

  return db;
}

describe('migration 002: remove subtasks', () => {
  it('drops parent_task_id and column_position from tasks', () => {
    const db = createOldSchemaDb();
    db.prepare(`INSERT INTO projects (id, name, path, config_path) VALUES ('p1', 'test', '/tmp', '/tmp/config.json')`).run();
    db.prepare(`INSERT INTO tasks (project_id, title, status) VALUES ('p1', 'parent', 'implementing')`).run();
    const parentId = (db.prepare('SELECT last_insert_rowid() as id').get() as any).id;
    db.prepare(`INSERT INTO tasks (project_id, title, status, parent_task_id) VALUES ('p1', 'child', 'backlog', ?)`).run(parentId);

    runMigration002(db);

    const cols = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).not.toContain('parent_task_id');
    expect(colNames).not.toContain('column_position');

    const tasks = db.prepare('SELECT * FROM tasks').all();
    expect(tasks).toHaveLength(1);
  });

  it('drops subtask_id from stage_logs', () => {
    const db = createOldSchemaDb();
    runMigration002(db);

    const cols = db.prepare("PRAGMA table_info(stage_logs)").all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).not.toContain('subtask_id');
  });

  it('is idempotent on clean DB', () => {
    const db = createTestDb();
    runMigration002(db);
    expect(() => runMigration002(db)).not.toThrow();
  });
});
