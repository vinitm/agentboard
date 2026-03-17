import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from '../test/helpers.js';

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
          `INSERT INTO tasks (id, project_id, title) VALUES ('t1', 'nonexistent-project', 'Test')`
        ).run();
      }).toThrow();
    });

    it('rejects a run with a nonexistent task_id', () => {
      expect(() => {
        db.prepare(
          `INSERT INTO runs (id, task_id, stage) VALUES ('r1', 'nonexistent-task', 'planning')`
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
          `INSERT INTO git_refs (id, task_id, branch) VALUES ('g1', 'nonexistent-task', 'main')`
        ).run();
      }).toThrow();
    });

    it('rejects an event with a nonexistent task_id', () => {
      expect(() => {
        db.prepare(
          `INSERT INTO events (id, task_id, type) VALUES ('e1', 'nonexistent-task', 'test')`
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

  describe('column defaults', () => {
    it('tasks default status is backlog', () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
         VALUES ('p1', 'P', '/p', '/c', ?, ?)`
      ).run(now, now);
      db.prepare(
        `INSERT INTO tasks (id, project_id, title) VALUES ('t1', 'p1', 'Test task')`
      ).run();
      const row = db.prepare(`SELECT status, risk_level, priority, column_position FROM tasks WHERE id='t1'`).get() as Record<string, unknown>;
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
      db.prepare(
        `INSERT INTO tasks (id, project_id, title) VALUES ('t1', 'p1', 'Test')`
      ).run();
      db.prepare(
        `INSERT INTO runs (id, task_id, stage, started_at) VALUES ('r1', 't1', 'planning', ?)`
      ).run(now);
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
      db.prepare(
        `INSERT INTO tasks (id, project_id, title) VALUES ('t1', 'p1', 'Test')`
      ).run();
      db.prepare(
        `INSERT INTO git_refs (id, task_id, branch) VALUES ('g1', 't1', 'main')`
      ).run();
      const row = db.prepare(`SELECT status FROM git_refs WHERE id='g1'`).get() as Record<string, unknown>;
      expect(row.status).toBe('local');
    });

    it("events default payload is '{}'", () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
         VALUES ('p1', 'P', '/p', '/c', ?, ?)`
      ).run(now, now);
      db.prepare(
        `INSERT INTO tasks (id, project_id, title) VALUES ('t1', 'p1', 'Test')`
      ).run();
      db.prepare(
        `INSERT INTO events (id, task_id, type) VALUES ('e1', 't1', 'test.event')`
      ).run();
      const row = db.prepare(`SELECT payload FROM events WHERE id='e1'`).get() as Record<string, unknown>;
      expect(row.payload).toBe('{}');
    });
  });
});
