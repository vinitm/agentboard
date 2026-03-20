import type Database from 'better-sqlite3';
import { runMigration002 } from './migrations/002-remove-subtasks.js';
import { runMigration003 } from './migrations/003-pty-columns.js';

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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  risk_level TEXT NOT NULL DEFAULT 'low',
  priority INTEGER NOT NULL DEFAULT 0,
  spec TEXT,
  blocked_reason TEXT,
  claimed_at TEXT,
  claimed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
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
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  worktree_path TEXT,
  status TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_logs (
  id TEXT PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_stage_logs_task_id ON stage_logs(task_id, started_at);
CREATE INDEX IF NOT EXISTS idx_stage_logs_project_id ON stage_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_stage_logs_status ON stage_logs(status);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
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
  migrateChatSessionId(db);
  migrateTaskIdsToInteger(db);
  migrateBlockedAtStage(db);
  migrateParentCascade(db);
  runMigration002(db);
  runMigration003(db);
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

export function migrateChatSessionId(db: Database.Database): void {
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN chat_session_id TEXT');
    console.log('[db] Added chat_session_id column to tasks');
  } catch {
    // Column already exists — ignore
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

/**
 * Migrate tasks from UUID (TEXT) primary keys to INTEGER AUTOINCREMENT.
 * Detects whether migration is needed by checking the column type.
 * Preserves all existing data by mapping UUIDs to sequential integers.
 */
export function migrateTaskIdsToInteger(db: Database.Database): void {
  // Check if tasks.id is still TEXT (old schema)
  const colInfo = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string; type: string }>;
  const idCol = colInfo.find((c) => c.name === 'id');
  if (!idCol || idCol.type !== 'TEXT') return; // Already migrated or fresh DB

  console.log('[db] Migrating task IDs from UUID to integer...');

  // Disable FK checks during migration
  db.exec('PRAGMA foreign_keys = OFF;');

  const migrate = db.transaction(() => {
    // 1. Build UUID → integer mapping (ordered by created_at for stable ordering)
    const oldTasks = db.prepare('SELECT id, created_at FROM tasks ORDER BY created_at ASC').all() as Array<{ id: string; created_at: string }>;
    const idMap = new Map<string, number>();
    oldTasks.forEach((t, i) => idMap.set(t.id, i + 1));

    if (idMap.size === 0) {
      // No tasks — just recreate tables with new schema
      db.exec('DROP TABLE IF EXISTS chat_messages');
      db.exec('DROP TABLE IF EXISTS stage_logs');
      db.exec('DROP TABLE IF EXISTS task_logs');
      db.exec('DROP TABLE IF EXISTS events');
      db.exec('DROP TABLE IF EXISTS git_refs');
      db.exec('DROP TABLE IF EXISTS artifacts');
      db.exec('DROP TABLE IF EXISTS runs');
      db.exec('DROP TABLE IF EXISTS tasks');
      // Tables will be created by DDL on next initSchema call
      console.log('[db] No tasks to migrate — tables recreated');
      return;
    }

    // 2. Create new tasks table
    db.exec(`CREATE TABLE tasks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parent_task_id INTEGER REFERENCES tasks_new(id) ON DELETE SET NULL,
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
      chat_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    // 3. Copy tasks with mapped IDs (insert without parent first, update parent after)
    const insertTask = db.prepare(`INSERT INTO tasks_new (id, project_id, parent_task_id, title, description, status,
      risk_level, priority, column_position, spec, blocked_reason, claimed_at, claimed_by, chat_session_id, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const oldTaskRows = db.prepare(`SELECT * FROM tasks ORDER BY created_at ASC`).all() as Array<Record<string, unknown>>;
    for (const row of oldTaskRows) {
      const newId = idMap.get(row.id as string)!;
      insertTask.run(
        newId, row.project_id, row.title, row.description, row.status,
        row.risk_level, row.priority, row.column_position, row.spec,
        row.blocked_reason, row.claimed_at, row.claimed_by,
        row.chat_session_id ?? null, row.created_at, row.updated_at
      );
    }

    // Set parent_task_id now that all tasks exist
    const updateParent = db.prepare('UPDATE tasks_new SET parent_task_id = ? WHERE id = ?');
    for (const row of oldTaskRows) {
      if (row.parent_task_id) {
        const newId = idMap.get(row.id as string)!;
        const newParentId = idMap.get(row.parent_task_id as string);
        if (newParentId !== undefined) {
          updateParent.run(newParentId, newId);
        }
      }
    }

    // 4. Migrate dependent tables — runs
    db.exec(`CREATE TABLE runs_new (
      id TEXT PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks_new(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      attempt INTEGER NOT NULL DEFAULT 1,
      tokens_used INTEGER, model_used TEXT, input TEXT, output TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    )`);
    const oldRuns = db.prepare('SELECT * FROM runs').all() as Array<Record<string, unknown>>;
    const insertRun = db.prepare(`INSERT INTO runs_new (id, task_id, stage, status, attempt, tokens_used, model_used, input, output, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of oldRuns) {
      const newTaskId = idMap.get(row.task_id as string);
      if (newTaskId !== undefined) {
        insertRun.run(row.id, newTaskId, row.stage, row.status, row.attempt, row.tokens_used, row.model_used, row.input, row.output, row.started_at, row.finished_at);
      }
    }

    // 5. Migrate artifacts (references runs, not tasks directly — just copy)
    db.exec(`CREATE TABLE artifacts_new (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs_new(id) ON DELETE CASCADE,
      type TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`INSERT INTO artifacts_new SELECT * FROM artifacts WHERE run_id IN (SELECT id FROM runs_new)`);

    // 6. Migrate git_refs
    db.exec(`CREATE TABLE git_refs_new (
      id TEXT PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks_new(id) ON DELETE CASCADE,
      branch TEXT NOT NULL, worktree_path TEXT,
      status TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const oldGitRefs = db.prepare('SELECT * FROM git_refs').all() as Array<Record<string, unknown>>;
    const insertGitRef = db.prepare('INSERT INTO git_refs_new (id, task_id, branch, worktree_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const row of oldGitRefs) {
      const newTaskId = idMap.get(row.task_id as string);
      if (newTaskId !== undefined) {
        insertGitRef.run(row.id, newTaskId, row.branch, row.worktree_path, row.status, row.created_at);
      }
    }

    // 7. Migrate events
    db.exec(`CREATE TABLE events_new (
      id TEXT PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks_new(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs_new(id) ON DELETE SET NULL,
      type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const oldEvents = db.prepare('SELECT * FROM events').all() as Array<Record<string, unknown>>;
    const insertEvent = db.prepare('INSERT INTO events_new (id, task_id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const row of oldEvents) {
      const newTaskId = idMap.get(row.task_id as string);
      if (newTaskId !== undefined) {
        insertEvent.run(row.id, newTaskId, row.run_id, row.type, row.payload, row.created_at);
      }
    }

    // 8. Migrate task_logs
    db.exec(`CREATE TABLE task_logs_new (
      id TEXT PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks_new(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      log_path TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const oldTaskLogs = db.prepare('SELECT * FROM task_logs').all() as Array<Record<string, unknown>>;
    const insertTaskLog = db.prepare('INSERT INTO task_logs_new (id, task_id, project_id, log_path, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const row of oldTaskLogs) {
      const newTaskId = idMap.get(row.task_id as string);
      if (newTaskId !== undefined) {
        insertTaskLog.run(row.id, newTaskId, row.project_id, row.log_path, row.size_bytes, row.created_at);
      }
    }

    // 9. Migrate stage_logs
    db.exec(`CREATE TABLE stage_logs_new (
      id TEXT PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks_new(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs_new(id) ON DELETE SET NULL,
      stage TEXT NOT NULL, subtask_id INTEGER,
      attempt INTEGER NOT NULL DEFAULT 1,
      file_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
      summary TEXT, tokens_used INTEGER, duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT NOT NULL, completed_at TEXT
    )`);
    const oldStageLogs = db.prepare('SELECT * FROM stage_logs').all() as Array<Record<string, unknown>>;
    const insertStageLog = db.prepare(`INSERT INTO stage_logs_new (id, task_id, project_id, run_id, stage, subtask_id, attempt,
      file_path, status, summary, tokens_used, duration_ms, created_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of oldStageLogs) {
      const newTaskId = idMap.get(row.task_id as string);
      const newSubtaskId = row.subtask_id ? idMap.get(row.subtask_id as string) ?? null : null;
      if (newTaskId !== undefined) {
        insertStageLog.run(row.id, newTaskId, row.project_id, row.run_id, row.stage, newSubtaskId,
          row.attempt, row.file_path, row.status, row.summary, row.tokens_used, row.duration_ms,
          row.created_at, row.started_at, row.completed_at);
      }
    }

    // 10. Migrate chat_messages
    db.exec(`CREATE TABLE chat_messages_new (
      id TEXT PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks_new(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const oldChatMsgs = db.prepare('SELECT * FROM chat_messages').all() as Array<Record<string, unknown>>;
    const insertChat = db.prepare('INSERT INTO chat_messages_new (id, task_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const row of oldChatMsgs) {
      const newTaskId = idMap.get(row.task_id as string);
      if (newTaskId !== undefined) {
        insertChat.run(row.id, newTaskId, row.role, row.content, row.created_at);
      }
    }

    // 11. Drop old tables and rename new ones
    db.exec('DROP TABLE chat_messages');
    db.exec('DROP TABLE stage_logs');
    db.exec('DROP TABLE task_logs');
    db.exec('DROP TABLE events');
    db.exec('DROP TABLE git_refs');
    db.exec('DROP TABLE artifacts');
    db.exec('DROP TABLE runs');
    db.exec('DROP TABLE tasks');

    db.exec('ALTER TABLE tasks_new RENAME TO tasks');
    db.exec('ALTER TABLE runs_new RENAME TO runs');
    db.exec('ALTER TABLE artifacts_new RENAME TO artifacts');
    db.exec('ALTER TABLE git_refs_new RENAME TO git_refs');
    db.exec('ALTER TABLE events_new RENAME TO events');
    db.exec('ALTER TABLE task_logs_new RENAME TO task_logs');
    db.exec('ALTER TABLE stage_logs_new RENAME TO stage_logs');
    db.exec('ALTER TABLE chat_messages_new RENAME TO chat_messages');

    // 12. Recreate indexes
    db.exec(`
      CREATE INDEX idx_tasks_project_id ON tasks(project_id);
      CREATE INDEX idx_tasks_status ON tasks(status);
      CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id);
      CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
      CREATE INDEX idx_runs_task_id ON runs(task_id);
      CREATE INDEX idx_runs_task_stage ON runs(task_id, stage);
      CREATE INDEX idx_artifacts_run_id ON artifacts(run_id);
      CREATE INDEX idx_git_refs_task_id ON git_refs(task_id);
      CREATE INDEX idx_events_task_id ON events(task_id);
      CREATE INDEX idx_events_run_id ON events(run_id);
      CREATE INDEX idx_events_type ON events(type);
      CREATE INDEX idx_task_logs_task_id ON task_logs(task_id);
      CREATE INDEX idx_task_logs_project_id ON task_logs(project_id);
      CREATE INDEX idx_stage_logs_task_id ON stage_logs(task_id, started_at);
      CREATE INDEX idx_stage_logs_project_id ON stage_logs(project_id);
      CREATE INDEX idx_stage_logs_status ON stage_logs(status);
      CREATE INDEX idx_chat_messages_task_id ON chat_messages(task_id);
    `);

    console.log(`[db] Migrated ${idMap.size} tasks from UUID to integer IDs`);
  });

  migrate();
  db.exec('PRAGMA foreign_keys = ON;');
}

export function migrateBlockedAtStage(db: Database.Database): void {
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN blocked_at_stage TEXT');
    console.log('[db] Added blocked_at_stage column to tasks');
  } catch {
    // Column already exists — ignore
  }
}

export function migrateParentCascade(db: Database.Database): void {
  // Check current FK definition for parent_task_id
  const fkList = db.prepare('PRAGMA foreign_key_list(tasks)').all() as Array<{
    table: string;
    from: string;
    on_delete: string;
  }>;
  const parentFk = fkList.find((fk) => fk.from === 'parent_task_id');
  if (!parentFk || parentFk.on_delete === 'CASCADE') return;

  console.log('[db] Migrating parent_task_id FK from SET NULL to CASCADE...');

  db.exec('PRAGMA foreign_keys = OFF;');

  const migrate = db.transaction(() => {
    // Get current column info to build the CREATE TABLE dynamically
    const colInfo = db.prepare('PRAGMA table_info(tasks)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const columnNames = colInfo.map((c) => c.name);

    db.exec(`CREATE TABLE tasks_temp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parent_task_id INTEGER REFERENCES tasks_temp(id) ON DELETE CASCADE,
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
    )`);

    // Copy data — only columns that exist in both tables
    const tempColInfo = db.prepare('PRAGMA table_info(tasks_temp)').all() as Array<{ name: string }>;
    const tempColNames = new Set(tempColInfo.map((c) => c.name));
    const sharedCols = columnNames.filter((c) => tempColNames.has(c));
    const colList = sharedCols.join(', ');

    db.exec(`INSERT INTO tasks_temp (${colList}) SELECT ${colList} FROM tasks`);
    db.exec('DROP TABLE tasks');
    db.exec('ALTER TABLE tasks_temp RENAME TO tasks');

    db.exec(`
      CREATE INDEX idx_tasks_project_id ON tasks(project_id);
      CREATE INDEX idx_tasks_status ON tasks(status);
      CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id);
      CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
    `);

    console.log('[db] Migrated parent_task_id FK to ON DELETE CASCADE');
  });

  migrate();
  db.exec('PRAGMA foreign_keys = ON;');
}
