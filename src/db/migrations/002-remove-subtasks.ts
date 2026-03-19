import type Database from 'better-sqlite3';

export function runMigration002(db: Database.Database): void {
  db.exec('BEGIN TRANSACTION');
  try {
    const hasParentCol = (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>)
      .some(c => c.name === 'parent_task_id');

    if (hasParentCol) {
      // Cancel non-terminal subtasks then delete all subtask rows
      db.prepare(`UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE parent_task_id IS NOT NULL AND status NOT IN ('done', 'failed', 'cancelled')`).run();
      db.prepare('DELETE FROM tasks WHERE parent_task_id IS NOT NULL').run();

      db.exec(`
        CREATE TABLE tasks_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'backlog',
          risk_level TEXT NOT NULL DEFAULT 'low',
          priority INTEGER NOT NULL DEFAULT 0,
          spec TEXT,
          blocked_reason TEXT,
          blocked_at_stage TEXT,
          claimed_at TEXT,
          claimed_by TEXT,
          chat_session_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO tasks_new (id, project_id, title, description, status, risk_level, priority, spec, blocked_reason, blocked_at_stage, claimed_at, claimed_by, chat_session_id, created_at, updated_at)
          SELECT id, project_id, title, description, status, risk_level, priority, spec, blocked_reason, blocked_at_stage, claimed_at, claimed_by, chat_session_id, created_at, updated_at
          FROM tasks;

        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;

        CREATE INDEX idx_tasks_project_id ON tasks(project_id);
        CREATE INDEX idx_tasks_status ON tasks(status);
        CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
      `);
    }

    const hasSubtaskCol = (db.prepare("PRAGMA table_info(stage_logs)").all() as Array<{ name: string }>)
      .some(c => c.name === 'subtask_id');

    if (hasSubtaskCol) {
      db.exec(`
        CREATE TABLE stage_logs_new (
          id TEXT PRIMARY KEY,
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          stage TEXT NOT NULL,
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

        INSERT INTO stage_logs_new (id, task_id, project_id, run_id, stage, attempt, file_path, status, summary, tokens_used, duration_ms, created_at, started_at, completed_at)
          SELECT id, task_id, project_id, run_id, stage, attempt, file_path, status, summary, tokens_used, duration_ms, created_at, started_at, completed_at
          FROM stage_logs;

        DROP TABLE stage_logs;
        ALTER TABLE stage_logs_new RENAME TO stage_logs;

        CREATE INDEX idx_stage_logs_task_id ON stage_logs(task_id, started_at);
        CREATE INDEX idx_stage_logs_project_id ON stage_logs(project_id);
        CREATE INDEX idx_stage_logs_status ON stage_logs(status);
      `);
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
