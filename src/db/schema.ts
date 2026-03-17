import type Database from 'better-sqlite3';

const DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  config_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  risk_level TEXT NOT NULL DEFAULT 'low',
  priority INTEGER NOT NULL DEFAULT 0,
  column_position INTEGER NOT NULL DEFAULT 0,
  spec TEXT,
  blocked_reason TEXT,
  claimed_at TEXT,
  claimed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS git_refs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  worktree_path TEXT,
  status TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_logs_project_id ON task_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_runs_task_id ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_task_stage ON runs(task_id, stage);
CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_git_refs_task_id ON git_refs(task_id);
CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

CREATE TABLE IF NOT EXISTS stage_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  stage TEXT NOT NULL,
  subtask_id TEXT,
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

CREATE INDEX IF NOT EXISTS idx_stage_logs_task_id ON stage_logs(task_id, started_at);
CREATE INDEX IF NOT EXISTS idx_stage_logs_project_id ON stage_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_stage_logs_status ON stage_logs(status);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_task_id ON chat_messages(task_id);

-- Deduplicate projects by path (keep oldest)
DELETE FROM projects WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY path ORDER BY created_at ASC) AS rn
    FROM projects
  ) WHERE rn = 1
);

-- Enforce unique repo paths
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
`;

export function initSchema(db: Database.Database): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(DDL);
  migrateReviewStages(db);
  migrateToSuperpowersWorkflow(db);
}

export function migrateReviewStages(db: Database.Database): void {
  const migrated = db
    .prepare(`UPDATE tasks SET status = 'review_panel' WHERE status IN ('review_spec', 'review_code')`)
    .run();
  const migratedRuns = db
    .prepare(`UPDATE runs SET stage = 'review_panel' WHERE stage IN ('review_spec', 'review_code')`)
    .run();
  if (migrated.changes > 0 || migratedRuns.changes > 0) {
    console.log(`[db] Migrated ${migrated.changes} tasks and ${migratedRuns.changes} runs from review_spec/review_code to review_panel`);
  }
}

export function migrateToSuperpowersWorkflow(db: Database.Database): void {
  const migratedTasks = db
    .prepare(`UPDATE tasks SET status = 'code_quality' WHERE status = 'review_panel'`)
    .run();
  const migratedRuns = db
    .prepare(`UPDATE runs SET stage = 'code_quality' WHERE stage = 'review_panel'`)
    .run();
  const migratedSpecTasks = db
    .prepare(`UPDATE tasks SET status = 'backlog' WHERE status = 'spec'`)
    .run();
  const migratedSpecRuns = db
    .prepare(`UPDATE runs SET stage = 'spec_review' WHERE stage = 'spec'`)
    .run();
  const totalChanges = migratedTasks.changes + migratedRuns.changes + migratedSpecTasks.changes + migratedSpecRuns.changes;
  if (totalChanges > 0) {
    console.log(`[db] Superpowers migration: ${totalChanges} rows updated (review_panel→code_quality, spec→spec_review/backlog)`);
  }
}
