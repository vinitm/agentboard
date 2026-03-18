import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from '../test/helpers.js';
import { migrateTaskIdsToInteger } from './schema.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

describe('schema initialization', () => {
  describe('tables', () => {
    const expectedTables = ['projects', 'tasks', 'runs', 'artifacts', 'git_refs', 'events', 'task_logs', 'chat_messages', 'stage_logs'];

    it.each(expectedTables)('creates table: %s', (tableName) => {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(tableName) as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe(tableName);
    });

    it('creates exactly 9 tables', () => {
      const rows = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .all() as { name: string }[];
      const tableNames = rows.map((r) => r.name).sort();
      expect(tableNames).toEqual(expectedTables.slice().sort());
    });
  });

  describe('indexes', () => {
    const expectedIndexes = [
      'idx_tasks_project_id',
      'idx_tasks_status',
      'idx_tasks_parent_task_id',
      'idx_tasks_project_status',
      'idx_runs_task_id',
      'idx_runs_task_stage',
      'idx_artifacts_run_id',
      'idx_git_refs_task_id',
      'idx_events_task_id',
      'idx_events_run_id',
      'idx_events_type',
      'idx_chat_messages_task_id',
      'idx_projects_path',
      'idx_stage_logs_task_id',
      'idx_stage_logs_project_id',
      'idx_stage_logs_status',
    ];

    it.each(expectedIndexes)('creates index: %s', (indexName) => {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
        .get(indexName) as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe(indexName);
    });

    it('idx_projects_path is a unique index', () => {
      const row = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_projects_path'`)
        .get() as { sql: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.sql.toUpperCase()).toContain('UNIQUE');
    });
  });

  describe('foreign keys enforcement', () => {
    it('rejects a task with a nonexistent project_id', () => {
      expect(() => {
        db.prepare(
          `INSERT INTO tasks (project_id, title) VALUES ('nonexistent-project', 'Test')`
        ).run();
      }).toThrow();
    });

    it('rejects a run with a nonexistent task_id', () => {
      expect(() => {
        db.prepare(
          `INSERT INTO runs (id, task_id, stage) VALUES ('r1', 99999, 'planning')`
        ).run();
      }).toThrow();
    });

    it('rejects an artifact with a nonexistent run_id', () => {
      expect(() => {
        db.prepare(
          `INSERT INTO artifacts (id, run_id, type, name, content) VALUES ('a1', 'nonexistent-run', 'file', 'foo.ts', 'content')`
        ).run();
      }).toThrow();
    });

    it('rejects a git_ref with a nonexistent task_id', () => {
      expect(() => {
        db.prepare(
          `INSERT INTO git_refs (id, task_id, branch) VALUES ('g1', 99999, 'main')`
        ).run();
      }).toThrow();
    });

    it('rejects an event with a nonexistent task_id', () => {
      expect(() => {
        db.prepare(
          `INSERT INTO events (id, task_id, type) VALUES ('e1', 99999, 'test')`
        ).run();
      }).toThrow();
    });
  });

  describe('unique project path enforcement', () => {
    it('rejects duplicate project paths', () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
         VALUES ('p1', 'Project One', '/unique/path', '/config', ?, ?)`
      ).run(now, now);

      expect(() => {
        db.prepare(
          `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
           VALUES ('p2', 'Project Two', '/unique/path', '/config2', ?, ?)`
        ).run(now, now);
      }).toThrow();
    });

    it('allows different project paths', () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
         VALUES ('p1', 'Project One', '/path/one', '/config', ?, ?)`
      ).run(now, now);

      expect(() => {
        db.prepare(
          `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
           VALUES ('p2', 'Project Two', '/path/two', '/config2', ?, ?)`
        ).run(now, now);
      }).not.toThrow();
    });
  });

  describe('migrations', () => {
    it('tasks table has chat_session_id column', () => {
      const columns = db
        .prepare("PRAGMA table_info('tasks')")
        .all() as Array<{ name: string }>;
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain('chat_session_id');
    });
  });

  describe('migrateTaskIdsToInteger', () => {
    it('converts UUID task IDs to sequential integers preserving data', () => {
      // Create a DB with old TEXT-based schema
      const oldDb = new Database(':memory:');
      oldDb.exec('PRAGMA foreign_keys = ON;');
      oldDb.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, config_path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'backlog', risk_level TEXT NOT NULL DEFAULT 'low', priority INTEGER NOT NULL DEFAULT 0,
          column_position INTEGER NOT NULL DEFAULT 0, spec TEXT, blocked_reason TEXT, claimed_at TEXT, claimed_by TEXT,
          chat_session_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          stage TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', attempt INTEGER NOT NULL DEFAULT 1,
          tokens_used INTEGER, model_used TEXT, input TEXT, output TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT);
        CREATE TABLE artifacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          type TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE git_refs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          branch TEXT NOT NULL, worktree_path TEXT, status TEXT NOT NULL DEFAULT 'local', created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE events (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL, type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE task_logs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, log_path TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE stage_logs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          stage TEXT NOT NULL, subtask_id TEXT, attempt INTEGER NOT NULL DEFAULT 1, file_path TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running', summary TEXT, tokens_used INTEGER, duration_ms INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')), started_at TEXT NOT NULL, completed_at TEXT);
        CREATE TABLE chat_messages (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant')), content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')));
      `);

      const now = '2026-03-18T12:00:00.000Z';
      const later = '2026-03-18T12:01:00.000Z';
      oldDb.exec('PRAGMA foreign_keys = OFF;');

      // Insert project and two tasks (parent + subtask)
      oldDb.prepare(`INSERT INTO projects (id, name, path, config_path) VALUES ('proj-1', 'Test', '/test', '/cfg')`).run();
      oldDb.prepare(`INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES ('uuid-aaa', 'proj-1', 'Parent Task', ?, ?)`).run(now, now);
      oldDb.prepare(`INSERT INTO tasks (id, project_id, parent_task_id, title, created_at, updated_at) VALUES ('uuid-bbb', 'proj-1', 'uuid-aaa', 'Subtask', ?, ?)`).run(later, later);

      // Insert related records
      oldDb.prepare(`INSERT INTO runs (id, task_id, stage) VALUES ('run-1', 'uuid-aaa', 'planning')`).run();
      oldDb.prepare(`INSERT INTO events (id, task_id, type) VALUES ('evt-1', 'uuid-bbb', 'status_change')`).run();
      oldDb.prepare(`INSERT INTO chat_messages (id, task_id, role, content) VALUES ('msg-1', 'uuid-aaa', 'user', 'hello')`).run();
      oldDb.prepare(`INSERT INTO stage_logs (id, task_id, project_id, stage, subtask_id, file_path, started_at) VALUES ('sl-1', 'uuid-aaa', 'proj-1', 'planning', 'uuid-bbb', '/log', ?)`).run(now);

      oldDb.exec('PRAGMA foreign_keys = ON;');

      // Run migration
      migrateTaskIdsToInteger(oldDb);

      // Verify tasks have integer IDs
      const tasks = oldDb.prepare('SELECT id, parent_task_id, title FROM tasks ORDER BY id').all() as Array<{ id: number; parent_task_id: number | null; title: string }>;
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe(1);
      expect(tasks[0].title).toBe('Parent Task');
      expect(tasks[0].parent_task_id).toBeNull();
      expect(tasks[1].id).toBe(2);
      expect(tasks[1].title).toBe('Subtask');
      expect(tasks[1].parent_task_id).toBe(1);

      // Verify runs migrated
      const runs = oldDb.prepare('SELECT task_id FROM runs WHERE id = ?').get('run-1') as { task_id: number };
      expect(runs.task_id).toBe(1);

      // Verify events migrated
      const events = oldDb.prepare('SELECT task_id FROM events WHERE id = ?').get('evt-1') as { task_id: number };
      expect(events.task_id).toBe(2);

      // Verify chat_messages migrated
      const msgs = oldDb.prepare('SELECT task_id FROM chat_messages WHERE id = ?').get('msg-1') as { task_id: number };
      expect(msgs.task_id).toBe(1);

      // Verify stage_logs migrated with subtask_id mapped
      const sl = oldDb.prepare('SELECT task_id, subtask_id FROM stage_logs WHERE id = ?').get('sl-1') as { task_id: number; subtask_id: number };
      expect(sl.task_id).toBe(1);
      expect(sl.subtask_id).toBe(2);

      // Verify schema is now INTEGER
      const colInfo = oldDb.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string; type: string }>;
      const idCol = colInfo.find((c) => c.name === 'id');
      expect(idCol?.type).toBe('INTEGER');

      oldDb.close();
    });

    it('is a no-op on a fresh integer-schema DB', () => {
      // db is already created with integer schema via createTestDb()
      // migrateTaskIdsToInteger should detect INTEGER and skip
      migrateTaskIdsToInteger(db);
      const colInfo = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string; type: string }>;
      const idCol = colInfo.find((c) => c.name === 'id');
      expect(idCol?.type).toBe('INTEGER');
    });
  });

  describe('column defaults', () => {
    it('tasks default status is backlog', () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
         VALUES ('p1', 'P', '/p', '/c', ?, ?)`
      ).run(now, now);
      const result = db.prepare(
        `INSERT INTO tasks (project_id, title) VALUES ('p1', 'Test task')`
      ).run();
      const taskId = Number(result.lastInsertRowid);
      const row = db.prepare(`SELECT status, risk_level, priority, column_position FROM tasks WHERE id=?`).get(taskId) as Record<string, unknown>;
      expect(row.status).toBe('backlog');
      expect(row.risk_level).toBe('low');
      expect(row.priority).toBe(0);
      expect(row.column_position).toBe(0);
    });

    it('runs default status is running', () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
         VALUES ('p1', 'P', '/p', '/c', ?, ?)`
      ).run(now, now);
      const taskResult = db.prepare(
        `INSERT INTO tasks (project_id, title) VALUES ('p1', 'Test')`
      ).run();
      const taskId = Number(taskResult.lastInsertRowid);
      db.prepare(
        `INSERT INTO runs (id, task_id, stage, started_at) VALUES ('r1', ?, 'planning', ?)`
      ).run(taskId, now);
      const row = db.prepare(`SELECT status, attempt FROM runs WHERE id='r1'`).get() as Record<string, unknown>;
      expect(row.status).toBe('running');
      expect(row.attempt).toBe(1);
    });

    it('git_refs default status is local', () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
         VALUES ('p1', 'P', '/p', '/c', ?, ?)`
      ).run(now, now);
      const taskResult = db.prepare(
        `INSERT INTO tasks (project_id, title) VALUES ('p1', 'Test')`
      ).run();
      const taskId = Number(taskResult.lastInsertRowid);
      db.prepare(
        `INSERT INTO git_refs (id, task_id, branch) VALUES ('g1', ?, 'main')`
      ).run(taskId);
      const row = db.prepare(`SELECT status FROM git_refs WHERE id='g1'`).get() as Record<string, unknown>;
      expect(row.status).toBe('local');
    });

    it("events default payload is '{}'", () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
         VALUES ('p1', 'P', '/p', '/c', ?, ?)`
      ).run(now, now);
      const taskResult = db.prepare(
        `INSERT INTO tasks (project_id, title) VALUES ('p1', 'Test')`
      ).run();
      const taskId = Number(taskResult.lastInsertRowid);
      db.prepare(
        `INSERT INTO events (id, task_id, type) VALUES ('e1', ?, 'test.event')`
      ).run(taskId);
      const row = db.prepare(`SELECT payload FROM events WHERE id='e1'`).get() as Record<string, unknown>;
      expect(row.payload).toBe('{}');
    });
  });
});
