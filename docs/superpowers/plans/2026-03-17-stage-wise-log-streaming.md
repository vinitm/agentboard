# Stage-Wise Log Streaming Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream agent pipeline output to the UI in real time per stage, persist it to per-stage files with a DB index, and display it as an expandable stage accordion.

**Architecture:** New `stage_logs` DB table indexes per-stage log files at `.agentboard/logs/{taskId}/{stage}.log`. A `StageRunner` wraps existing stage calls with file/socket/DB lifecycle. Socket.IO gains `stage` + `subtaskId` fields on `run:log` and a new `stage:transition` event. A `StageAccordion` React component replaces the Logs tab with an auto-following, lazy-loading stage-wise view.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Socket.IO, Express, React + Tailwind

**Spec:** `docs/superpowers/specs/2026-03-17-stage-wise-log-streaming-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/types/index.ts` | Add `StageLogStage`, `StageLog`, `StageLogStatus`, `StageTransitionEvent` types |
| Modify | `src/db/schema.ts` | Add `stage_logs` DDL + indexes |
| Create | `src/db/stage-log-queries.ts` | CRUD for `stage_logs` table |
| Create | `src/db/stage-log-queries.test.ts` | Tests for stage log queries |
| Modify | `src/server/ws.ts` | Update `broadcastLog` signature, add `broadcastStageTransition` |
| Modify | `src/server/ws.test.ts` | Tests for updated ws functions |
| Create | `src/worker/stage-runner.ts` | `createStageRunner` — lifecycle wrapper for stages |
| Create | `src/worker/stage-runner.test.ts` | Tests for StageRunner |
| Modify | `src/worker/loop.ts` | Wire StageRunner into `processTask`, `processSubtaskV2`, `runSubtaskPipeline`, `runFinalReviewAndPR` |
| Modify | `src/worker/recovery.ts` | Add stale `stage_logs` recovery after `recoverStalledSubtaskChains` |
| Modify | `src/worker/recovery.test.ts` | Test for stage_logs recovery (create if absent) |
| Create | `src/server/routes/stage-logs.ts` | `GET /api/tasks/:id/stages` and `GET /api/tasks/:id/stages/:stageLogId/logs` |
| Create | `src/server/routes/stage-logs.test.ts` | Tests for stage log API routes |
| Modify | `src/test/helpers.ts` | Mount stage-logs routes in `createTestApp` |
| Modify | `ui/src/types.ts` | Add `StageLogStage`, `StageLog`, `StageTransitionEvent` types |
| Modify | `ui/src/api/client.ts` | Add `getStages`, `getStageLogContent` API methods |
| Create | `ui/src/components/StageAccordion.tsx` | Stage accordion component with auto-follow |
| Create | `ui/src/components/StageRow.tsx` | Individual stage row (header + expandable content) |
| Create | `ui/src/components/SubtaskStages.tsx` | Nested subtask stage rendering |
| Modify | `ui/src/components/TaskPage.tsx` | Replace Logs tab with StageAccordion as default |

---

## Task 1: Types — `StageLogStage`, `StageLog`, `StageLogStatus`

**Files:**
- Modify: `src/types/index.ts:27` (after `Stage` type)
- Modify: `ui/src/types.ts:27` (after `Stage` type)
- Test: `src/types/index.test.ts` (if exists, otherwise skip)

- [ ] **Step 1: Add backend types**

In `src/types/index.ts`, after the `Stage` type (line 27), add:

```typescript
// ── Stage log types (extends Stage with sub-stages) ─────────────────
export type StageLogStage = Stage | 'inline_fix' | 'learner';

export type StageLogStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface StageLog {
  id: string;
  taskId: string;
  projectId: string;
  runId: string | null;
  stage: StageLogStage;
  subtaskId: string | null;
  attempt: number;
  filePath: string;
  status: StageLogStatus;
  summary: string | null;
  tokensUsed: number | null;
  durationMs: number | null;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
}

export interface StageTransitionEvent {
  taskId: string;
  stage: StageLogStage;
  subtaskId?: string;
  status: StageLogStatus;
  summary?: string;
  durationMs?: number;
  tokensUsed?: number;
}
```

- [ ] **Step 2: Add frontend types**

In `ui/src/types.ts`, after the `Stage` type (line 27), add frontend-specific types. Note: `StageLog` omits `filePath` (server-internal) and `projectId` (not needed in UI):

```typescript
export type StageLogStage = Stage | 'inline_fix' | 'learner';

export type StageLogStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface StageLog {
  id: string;
  taskId: string;
  runId: string | null;
  stage: StageLogStage;
  subtaskId: string | null;
  attempt: number;
  status: StageLogStatus;
  summary: string | null;
  tokensUsed: number | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface StageTransitionEvent {
  taskId: string;
  stage: StageLogStage;
  subtaskId?: string;
  status: StageLogStatus;
  summary?: string;
  durationMs?: number;
  tokensUsed?: number;
}
```

The API route (`listStageLogsByTask`) returns the full DB row. The server route should strip `filePath` and `projectId` from the response before sending to the client. Add a `toClientStageLog` mapping function in `src/server/routes/stage-logs.ts`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts ui/src/types.ts
git commit -m "feat: add StageLog types for stage-wise log streaming"
```

---

## Task 2: Schema — `stage_logs` table

**Files:**
- Modify: `src/db/schema.ts:95` (before chat_messages table)
- Modify: `src/db/schema.test.ts:17` (add `stage_logs` to expected tables)

- [ ] **Step 1: Write failing test**

In `src/db/schema.test.ts`, add `'stage_logs'` to the `expectedTables` array on line 17:

```typescript
const expectedTables = ['projects', 'tasks', 'runs', 'artifacts', 'git_refs', 'events', 'task_logs', 'chat_messages', 'stage_logs'];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=schema.test`
Expected: FAIL — `stage_logs` table not found.

- [ ] **Step 3: Add DDL**

In `src/db/schema.ts`, before the `chat_messages` table DDL (line 96), add:

```sql
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=schema.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/schema.test.ts
git commit -m "feat: add stage_logs table for per-stage log indexing"
```

---

## Task 3: DB Queries — `stage-log-queries.ts`

**Files:**
- Create: `src/db/stage-log-queries.ts`
- Create: `src/db/stage-log-queries.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/db/stage-log-queries.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test/helpers.js';
import { createProject, createTask } from './queries.js';
import {
  createStageLog,
  getStageLogById,
  listStageLogsByTask,
  updateStageLog,
  listStaleRunningLogs,
} from './stage-log-queries.js';

describe('stage-log-queries', () => {
  let db: Database.Database;
  let projectId: string;
  let taskId: string;

  beforeEach(() => {
    db = createTestDb();
    const project = createProject(db, { name: 'test', path: '/tmp/test', configPath: '/tmp/test/.agentboard/config.json' });
    projectId = project.id;
    const task = createTask(db, { projectId, title: 'test task', description: 'desc' });
    taskId = task.id;
  });

  it('creates and retrieves a stage log', () => {
    const log = createStageLog(db, {
      taskId,
      projectId,
      stage: 'planning',
      filePath: '.agentboard/logs/test/planning.log',
      startedAt: new Date().toISOString(),
    });

    expect(log.stage).toBe('planning');
    expect(log.status).toBe('running');
    expect(log.attempt).toBe(1);

    const fetched = getStageLogById(db, log.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(log.id);
  });

  it('lists stage logs by task ordered by started_at', () => {
    const t1 = '2026-03-17T10:00:00Z';
    const t2 = '2026-03-17T10:01:00Z';

    createStageLog(db, { taskId, projectId, stage: 'spec_review', filePath: 'a.log', startedAt: t1 });
    createStageLog(db, { taskId, projectId, stage: 'planning', filePath: 'b.log', startedAt: t2 });

    const logs = listStageLogsByTask(db, taskId);
    expect(logs).toHaveLength(2);
    expect(logs[0].stage).toBe('spec_review');
    expect(logs[1].stage).toBe('planning');
  });

  it('updates a stage log with completion data', () => {
    const log = createStageLog(db, {
      taskId,
      projectId,
      stage: 'implementing',
      filePath: 'c.log',
      startedAt: new Date().toISOString(),
    });

    updateStageLog(db, log.id, {
      status: 'completed',
      summary: 'Implemented auth middleware',
      tokensUsed: 5000,
      durationMs: 12000,
      completedAt: new Date().toISOString(),
    });

    const updated = getStageLogById(db, log.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.summary).toBe('Implemented auth middleware');
    expect(updated!.tokensUsed).toBe(5000);
  });

  it('finds stale running logs', () => {
    const staleTime = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    createStageLog(db, { taskId, projectId, stage: 'planning', filePath: 'd.log', startedAt: staleTime });
    createStageLog(db, { taskId, projectId, stage: 'implementing', filePath: 'e.log', startedAt: new Date().toISOString() });

    const stale = listStaleRunningLogs(db);
    expect(stale).toHaveLength(1);
    expect(stale[0].stage).toBe('planning');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=stage-log-queries.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/db/stage-log-queries.ts`:

```typescript
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { StageLog, StageLogStage, StageLogStatus } from '../types/index.js';

function rowToStageLog(row: Record<string, unknown>): StageLog {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    projectId: row.project_id as string,
    runId: (row.run_id as string) ?? null,
    stage: row.stage as StageLogStage,
    subtaskId: (row.subtask_id as string) ?? null,
    attempt: row.attempt as number,
    filePath: row.file_path as string,
    status: row.status as StageLogStatus,
    summary: (row.summary as string) ?? null,
    tokensUsed: (row.tokens_used as number) ?? null,
    durationMs: (row.duration_ms as number) ?? null,
    createdAt: row.created_at as string,
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) ?? null,
  };
}

export interface CreateStageLogData {
  taskId: string;
  projectId: string;
  runId?: string;
  stage: StageLogStage;
  subtaskId?: string;
  attempt?: number;
  filePath: string;
  startedAt: string;
}

export function createStageLog(
  db: Database.Database,
  data: CreateStageLogData
): StageLog {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO stage_logs (id, task_id, project_id, run_id, stage, subtask_id, attempt, file_path, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.taskId,
    data.projectId,
    data.runId ?? null,
    data.stage,
    data.subtaskId ?? null,
    data.attempt ?? 1,
    data.filePath,
    data.startedAt
  );
  return getStageLogById(db, id)!;
}

export function getStageLogById(
  db: Database.Database,
  id: string
): StageLog | undefined {
  const row = db.prepare('SELECT * FROM stage_logs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToStageLog(row) : undefined;
}

export function listStageLogsByTask(
  db: Database.Database,
  taskId: string
): StageLog[] {
  const rows = db
    .prepare('SELECT * FROM stage_logs WHERE task_id = ? ORDER BY started_at ASC')
    .all(taskId) as Record<string, unknown>[];
  return rows.map(rowToStageLog);
}

export interface UpdateStageLogData {
  status?: StageLogStatus;
  summary?: string | null;
  tokensUsed?: number | null;
  durationMs?: number | null;
  completedAt?: string;
  runId?: string;
}

export function updateStageLog(
  db: Database.Database,
  id: string,
  data: UpdateStageLogData
): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (data.status !== undefined) { sets.push('status = ?'); values.push(data.status); }
  if (data.summary !== undefined) { sets.push('summary = ?'); values.push(data.summary); }
  if (data.tokensUsed !== undefined) { sets.push('tokens_used = ?'); values.push(data.tokensUsed); }
  if (data.durationMs !== undefined) { sets.push('duration_ms = ?'); values.push(data.durationMs); }
  if (data.completedAt !== undefined) { sets.push('completed_at = ?'); values.push(data.completedAt); }
  if (data.runId !== undefined) { sets.push('run_id = ?'); values.push(data.runId); }

  if (sets.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE stage_logs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Find stage_logs rows still in 'running' status that are older than 30 minutes.
 * Used by recovery to mark crashed stages as failed.
 */
export function listStaleRunningLogs(db: Database.Database): StageLog[] {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM stage_logs WHERE status = 'running' AND started_at < ?`
    )
    .all(cutoff) as Record<string, unknown>[];
  return rows.map(rowToStageLog);
}

export function markStageLogFailed(db: Database.Database, id: string): void {
  db.prepare(
    `UPDATE stage_logs SET status = 'failed', completed_at = ? WHERE id = ?`
  ).run(new Date().toISOString(), id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=stage-log-queries.test`
Expected: PASS — all tests green.

- [ ] **Step 5: Run full build**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 6: Commit**

```bash
git add src/db/stage-log-queries.ts src/db/stage-log-queries.test.ts
git commit -m "feat: add stage_logs CRUD queries"
```

---

## Task 4: WebSocket — update `broadcastLog`, add `broadcastStageTransition`

**Files:**
- Modify: `src/server/ws.ts`
- Modify: `src/server/ws.test.ts`

- [ ] **Step 1: Update `broadcastLog` signature**

In `src/server/ws.ts`, update the `broadcastLog` data type to include optional `stage` and `subtaskId`:

```typescript
export function broadcastLog(
  io: Server,
  data: {
    taskId: string;
    runId: string;
    stage?: string;
    subtaskId?: string;
    chunk: string;
    timestamp: string;
  }
): void {
  io.emit('run:log', data);
}
```

- [ ] **Step 2: Add `broadcastStageTransition`**

Add after `broadcastLog`:

```typescript
import type { StageTransitionEvent } from '../types/index.js';

export function broadcastStageTransition(
  io: Server,
  data: StageTransitionEvent
): void {
  io.emit('stage:transition', data);
}
```

- [ ] **Step 3: Update tests**

In `src/server/ws.test.ts`, add a test for the new event and verify the updated signature compiles.

- [ ] **Step 4: Verify build**

Run: `npm run build && npm test -- --testPathPattern=ws.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ws.ts src/server/ws.test.ts
git commit -m "feat: add stage and subtaskId to broadcastLog, add broadcastStageTransition"
```

---

## Task 5: StageRunner — lifecycle wrapper

**Files:**
- Create: `src/worker/stage-runner.ts`
- Create: `src/worker/stage-runner.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/worker/stage-runner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { Server } from 'socket.io';
import { createTestDb } from '../test/helpers.js';
import { createProject, createTask } from '../db/queries.js';
import { getStageLogById, listStageLogsByTask } from '../db/stage-log-queries.js';
import { createStageRunner } from './stage-runner.js';

describe('StageRunner', () => {
  let db: Database.Database;
  let io: Server;
  let projectId: string;
  let taskId: string;
  let logsDir: string;

  beforeEach(() => {
    db = createTestDb();
    io = { emit: vi.fn() } as unknown as Server;
    const project = createProject(db, { name: 'test', path: '/tmp/test', configPath: '/tmp/test/.agentboard/config.json' });
    projectId = project.id;
    const task = createTask(db, { projectId, title: 'test', description: '' });
    taskId = task.id;
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-runner-test-'));
  });

  afterEach(() => {
    fs.rmSync(logsDir, { recursive: true, force: true });
  });

  it('creates stage_logs row, file, and emits events', async () => {
    const runner = createStageRunner({ taskId, projectId, io, db, logsDir, projectRoot: logsDir });

    const result = await runner.execute('planning', (onOutput) => {
      onOutput('chunk 1');
      onOutput('chunk 2');
      return Promise.resolve({ plan: '3 subtasks', tokens: 1000 });
    }, {
      summarize: (r) => ({ summary: 'Found ' + r.plan, tokensUsed: r.tokens }),
    });

    // Verify DB row
    const logs = listStageLogsByTask(db, taskId);
    expect(logs).toHaveLength(1);
    expect(logs[0].stage).toBe('planning');
    expect(logs[0].status).toBe('completed');
    expect(logs[0].summary).toBe('Found 3 subtasks');

    // Verify file exists and has content
    const filePath = path.join(logsDir, taskId, 'planning.log');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('chunk 1');
    expect(content).toContain('chunk 2');

    // Verify Socket.IO events
    expect(io.emit).toHaveBeenCalledWith('stage:transition', expect.objectContaining({ stage: 'planning', status: 'running' }));
    expect(io.emit).toHaveBeenCalledWith('stage:transition', expect.objectContaining({ stage: 'planning', status: 'completed' }));
    expect(io.emit).toHaveBeenCalledWith('run:log', expect.objectContaining({ stage: 'planning', chunk: 'chunk 1' }));
  });

  it('marks stage as failed when function throws', async () => {
    const runner = createStageRunner({ taskId, projectId, io, db, logsDir, projectRoot: logsDir });

    await expect(
      runner.execute('implementing', () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    const logs = listStageLogsByTask(db, taskId);
    expect(logs[0].status).toBe('failed');
  });

  it('handles subtaskId for nested stages', async () => {
    const subtaskId = 'st-1';
    const runner = createStageRunner({ taskId, projectId, subtaskId, io, db, logsDir, projectRoot: logsDir });

    await runner.execute('implementing', (onOutput) => {
      onOutput('impl output');
      return Promise.resolve({ done: true });
    });

    const logs = listStageLogsByTask(db, taskId);
    expect(logs[0].subtaskId).toBe(subtaskId);

    // File should be in subtask directory
    const filePath = path.join(logsDir, taskId, `subtask-${subtaskId}`, 'implementing.log');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('handles retry attempts with suffixed filenames', async () => {
    const runner = createStageRunner({ taskId, projectId, io, db, logsDir, projectRoot: logsDir });

    await runner.execute('planning', (onOutput) => {
      onOutput('attempt 1');
      return Promise.resolve({ attempt: 1 });
    });

    await runner.execute('planning', (onOutput) => {
      onOutput('attempt 2');
      return Promise.resolve({ attempt: 2 });
    }, { attempt: 2 });

    const logs = listStageLogsByTask(db, taskId);
    expect(logs).toHaveLength(2);
    expect(logs[1].attempt).toBe(2);

    const retryFile = path.join(logsDir, taskId, 'planning-2.log');
    expect(fs.existsSync(retryFile)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=stage-runner.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/worker/stage-runner.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { StageLogStage } from '../types/index.js';
import { createStageLog, updateStageLog } from '../db/stage-log-queries.js';
import { broadcastLog, broadcastStageTransition } from '../server/ws.js';

export interface StageRunnerOptions {
  taskId: string;
  projectId: string;
  subtaskId?: string;
  io: Server;
  db: Database.Database;
  /** Absolute path to the logs directory, e.g., /repo/.agentboard/logs */
  logsDir: string;
  /** Absolute path to the project root — used to compute relative file paths for DB storage */
  projectRoot: string;
}

export interface ExecuteOptions {
  attempt?: number;
  runId?: string;
}

export interface StageRunner {
  /**
   * Execute a stage with lifecycle management.
   * The `fn` receives an `onOutput` callback and should return any object.
   * To populate the stage_logs summary/tokensUsed, pass a `summarize` option
   * that extracts these from the result.
   */
  execute<T>(
    stage: StageLogStage,
    fn: (onOutput: (chunk: string) => void) => T | Promise<T>,
    options?: ExecuteOptions & {
      summarize?: (result: T) => { summary?: string; tokensUsed?: number };
    }
  ): Promise<T>;
}

export function createStageRunner(opts: StageRunnerOptions): StageRunner {
  const { taskId, projectId, subtaskId, io, db, logsDir, projectRoot } = opts;

  function getFilePath(stage: StageLogStage, attempt: number): string {
    const dir = subtaskId
      ? path.join(logsDir, taskId, `subtask-${subtaskId}`)
      : path.join(logsDir, taskId);

    const fileName = attempt > 1 ? `${stage}-${attempt}.log` : `${stage}.log`;
    return path.join(dir, fileName);
  }

  return {
    async execute<T>(
      stage: StageLogStage,
      fn: (onOutput: (chunk: string) => void) => T | Promise<T>,
      options?: ExecuteOptions & {
        summarize?: (result: T) => { summary?: string; tokensUsed?: number };
      }
    ): Promise<T> {
      const attempt = options?.attempt ?? 1;
      const filePath = getFilePath(stage, attempt);
      const relativeFilePath = path.relative(projectRoot, filePath);
      const startedAt = new Date().toISOString();
      const startTime = Date.now();

      // Ensure directory exists
      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      // Create DB row
      const stageLog = createStageLog(db, {
        taskId,
        projectId,
        runId: options?.runId,
        stage,
        subtaskId,
        attempt,
        filePath: relativeFilePath,
        startedAt,
      });

      // Emit running transition
      broadcastStageTransition(io, {
        taskId,
        stage,
        subtaskId,
        status: 'running',
      });

      // Create onOutput callback
      const onOutput = (chunk: string): void => {
        fs.appendFileSync(filePath, chunk, 'utf-8');
        broadcastLog(io, {
          taskId,
          runId: options?.runId ?? `stage-${stageLog.id}`,
          stage,
          subtaskId,
          chunk,
          timestamp: new Date().toISOString(),
        });
      };

      try {
        const result = await fn(onOutput);
        const durationMs = Date.now() - startTime;
        const extracted = options?.summarize?.(result) ?? {};

        // Update DB row
        updateStageLog(db, stageLog.id, {
          status: 'completed',
          summary: extracted.summary,
          tokensUsed: extracted.tokensUsed,
          durationMs,
          completedAt: new Date().toISOString(),
          runId: options?.runId,
        });

        // Emit completed transition
        broadcastStageTransition(io, {
          taskId,
          stage,
          subtaskId,
          status: 'completed',
          summary: extracted.summary,
          durationMs,
          tokensUsed: extracted.tokensUsed,
        });

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;

        updateStageLog(db, stageLog.id, {
          status: 'failed',
          summary: error instanceof Error ? error.message : String(error),
          durationMs,
          completedAt: new Date().toISOString(),
        });

        broadcastStageTransition(io, {
          taskId,
          stage,
          subtaskId,
          status: 'failed',
          durationMs,
        });

        throw error;
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=stage-runner.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/stage-runner.ts src/worker/stage-runner.test.ts
git commit -m "feat: add StageRunner lifecycle wrapper for per-stage logging"
```

---

## Task 6: Wire StageRunner into Worker Loop

**Files:**
- Modify: `src/worker/loop.ts`

This is the largest task. The worker loop has four functions that call stages: `processTask`, `processSubtaskV2`, `runSubtaskPipeline`, `runFinalReviewAndPR`. Each needs to create a `StageRunner` and use it to wrap stage calls.

**Key principle:** `StageRunner.execute` provides its own `onOutput` callback that writes to the per-stage file and emits Socket.IO events. When a stage is wrapped with `StageRunner`, the existing `createLogStreamer` call for that stage becomes dead code and should be removed. The old `createLogStreamer` is kept only for call sites not yet migrated (during the transition) and for the old `TaskLogger` writes. Once all stages use `StageRunner`, `createLogStreamer` calls that were replaced can be deleted.

For each stage call site in `loop.ts`:
- If the stage is wrapped with `runner.execute(stage, (onOutput) => ...)` → the `onOutput` comes from StageRunner, remove the old `createLogStreamer` call
- The old `logger?.stageStart/stageEnd` calls are also superseded by StageRunner's DB writes — remove them
- The `TaskLogger` (old monolithic log file) is still written to during transition via the existing `logger?.write()` calls — but StageRunner's `onOutput` replaces this

- [ ] **Step 1: Add imports**

At the top of `src/worker/loop.ts`, add:

```typescript
import { createStageRunner } from './stage-runner.js';
import { broadcastStageTransition } from '../server/ws.js';
```

- [ ] **Step 2: Update `createLogStreamer` to accept stage info**

The existing `createLogStreamer` function (line 216) does not pass `stage` or `subtaskId` to `broadcastLog`. Update it:

```typescript
function createLogStreamer(
  taskId: string,
  runId: string,
  logger?: TaskLogger,
  stage?: string,
  subtaskId?: string
): (chunk: string) => void {
  return (chunk: string) => {
    broadcastLog(io, {
      taskId,
      runId,
      stage,
      subtaskId,
      chunk,
      timestamp: new Date().toISOString(),
    });
    logger?.write(chunk);
  };
}
```

- [ ] **Step 3: Create StageRunner in `processTask` — parent-level stages**

In `processTask`, after obtaining `configDir` and `worktreePath`, create a stage runner:

```typescript
const stageRunner = createStageRunner({
  taskId: task.id,
  projectId: task.projectId,
  io,
  db,
  logsDir: path.join(configDir, 'logs'),
  projectRoot: project.path,
});
```

Then wrap parent-level stage calls (spec_review, planning). For example:

```typescript
// Before (existing):
const specResult = await runSpecReview(db, task, worktreePath, taskConfig, onOutput);

// After (with StageRunner):
const specResult = await stageRunner.execute('spec_review', (onOutput) =>
  runSpecReview(db, task, worktreePath, taskConfig, onOutput),
  { summarize: (r) => ({ summary: r.passed ? 'Spec approved' : `${r.issues.length} issues found` }) }
);
```

Remove the corresponding `createLogStreamer`, `logger?.stageStart`, and `logger?.stageEnd` calls for each wrapped stage — StageRunner handles all of this.

- [ ] **Step 4: Create StageRunner in `runFinalReviewAndPR`**

Wrap `runFinalReview` and `createPR` calls with StageRunner. Also wrap the learner call:

```typescript
// Fire-and-forget learner — StageRunner marks failed if it throws
stageRunner.execute('learner', (onOutput) =>
  extractLearnings(metrics, worktreePath, taskConfig.modelDefaults.learning, onOutput)
    .then(r => ({ saved: r.saved })),
  { summarize: (r) => ({ summary: r.saved ? 'Skill extracted' : 'No patterns found' }) }
).catch(() => { /* already logged */ });
```

- [ ] **Step 5: Run tests and build**

Run: `npm test && npm run build`
Expected: All tests pass, clean compilation.

- [ ] **Step 6: Commit**

```bash
git add src/worker/loop.ts
git commit -m "feat: wire StageRunner into parent-level stages (spec_review, planning, final_review, pr_creation, learner)"
```

---

## Task 6b: Wire StageRunner into Subtask Stages

**Files:**
- Modify: `src/worker/loop.ts`

- [ ] **Step 1: Create StageRunner in `processSubtaskV2`**

In `processSubtaskV2` (line 296), create a subtask-scoped runner:

```typescript
const stageRunner = createStageRunner({
  taskId: task.parentTaskId ?? task.id,
  projectId: task.projectId,
  subtaskId: task.id,
  io,
  db,
  logsDir: path.join(configDir, 'logs'),
  projectRoot: project.path,
});
```

Wrap the implementing, checks, inline_fix, and code_quality calls. Remove corresponding `createLogStreamer` and `logger?.stageStart/stageEnd` calls.

- [ ] **Step 2: Create StageRunner in `runSubtaskPipeline`**

Same pattern as `processSubtaskV2` but for tasks without subtasks (no `subtaskId`).

- [ ] **Step 3: Run tests and build**

Run: `npm test && npm run build`
Expected: All tests pass, clean compilation.

- [ ] **Step 4: Commit**

```bash
git add src/worker/loop.ts
git commit -m "feat: wire StageRunner into subtask stages (implementing, checks, inline_fix, code_quality)"
```

---

## Task 7: Recovery — stale `stage_logs` cleanup

**Files:**
- Modify: `src/worker/recovery.ts`
- Create or Modify: `src/worker/recovery.test.ts` (create if absent)

- [ ] **Step 1: Write failing test**

Add test that creates a stale `stage_logs` row with `status: running` and verifies `recoverStaleTasks` marks it as `failed`. Ensure the test imports `createStageLog`, `listStaleRunningLogs`, and `listStageLogsByTask` from `../db/stage-log-queries.js`:

```typescript
import { createStageLog, listStaleRunningLogs, listStageLogsByTask } from '../db/stage-log-queries.js';

it('marks stale stage_logs as failed', () => {
  // Create a stage_log row with running status and old started_at
  createStageLog(db, {
    taskId,
    projectId,
    stage: 'planning',
    filePath: 'test.log',
    startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
  });

  recoverStaleTasks(db);

  const logs = listStaleRunningLogs(db);
  expect(logs).toHaveLength(0); // All stale logs should be recovered

  const allLogs = listStageLogsByTask(db, taskId);
  expect(allLogs[0].status).toBe('failed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=recovery`
Expected: FAIL.

- [ ] **Step 3: Add recovery logic**

In `src/worker/recovery.ts`, add import and recovery step at the end of `recoverStaleTasks`:

```typescript
import { listStaleRunningLogs, markStageLogFailed } from '../db/stage-log-queries.js';

// At the end of recoverStaleTasks, after recoverStalledSubtaskChains:
const staleLogs = listStaleRunningLogs(db);
for (const log of staleLogs) {
  markStageLogFailed(db, log.id);
  console.log(`[recovery] Marked stale stage_log ${log.id} (${log.stage}) as failed`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=recovery`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/recovery.ts src/worker/recovery.test.ts
git commit -m "feat: recover stale stage_logs on worker restart"
```

---

## Task 8: API Routes — stage logs endpoints

**Files:**
- Create: `src/server/routes/stage-logs.ts`
- Create: `src/server/routes/stage-logs.test.ts`
- Modify: `src/test/helpers.ts` (mount routes in `createTestApp`)
- Modify: `src/server/index.ts` (mount routes)

- [ ] **Step 1: Write failing tests**

Create `src/server/routes/stage-logs.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb, createTestApp } from '../../test/helpers.js';
import { createProject, createTask } from '../../db/queries.js';
import { createStageLog } from '../../db/stage-log-queries.js';

describe('GET /api/tasks/:id/stages', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createTestApp>['app'];
  let taskId: string;

  beforeEach(() => {
    db = createTestDb();
    const testApp = createTestApp(db);
    app = testApp.app;
    const project = createProject(db, { name: 'test', path: '/tmp/test', configPath: '/tmp/test/.agentboard/config.json' });
    const task = createTask(db, { projectId: project.id, title: 'test', description: '' });
    taskId = task.id;
  });

  it('returns empty stages for task with no stage logs', async () => {
    const res = await request(app).get(`/api/tasks/${taskId}/stages`);
    expect(res.status).toBe(200);
    expect(res.body.stages).toEqual([]);
  });

  it('returns stage logs ordered by started_at', async () => {
    const project = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string };
    createStageLog(db, { taskId, projectId: project.id, stage: 'spec_review', filePath: 'a.log', startedAt: '2026-03-17T10:00:00Z' });
    createStageLog(db, { taskId, projectId: project.id, stage: 'planning', filePath: 'b.log', startedAt: '2026-03-17T10:01:00Z' });

    const res = await request(app).get(`/api/tasks/${taskId}/stages`);
    expect(res.status).toBe(200);
    expect(res.body.stages).toHaveLength(2);
    expect(res.body.stages[0].stage).toBe('spec_review');
    expect(res.body.stages[1].stage).toBe('planning');
  });
});

describe('GET /api/tasks/:id/stages/:stageLogId/logs', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createTestApp>['app'];
  let taskId: string;
  let tmpDir: string;

  beforeEach(() => {
    db = createTestDb();
    const testApp = createTestApp(db);
    app = testApp.app;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-logs-test-'));
    const project = createProject(db, { name: 'test', path: tmpDir, configPath: path.join(tmpDir, '.agentboard/config.json') });
    const task = createTask(db, { projectId: project.id, title: 'test', description: '' });
    taskId = task.id;
  });

  it('returns log file content', async () => {
    const logDir = path.join(tmpDir, '.agentboard', 'logs', taskId);
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'planning.log');
    fs.writeFileSync(logFile, 'planning output here');

    const project = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string };
    const log = createStageLog(db, {
      taskId,
      projectId: project.id,
      stage: 'planning',
      filePath: '.agentboard/logs/' + taskId + '/planning.log',
      startedAt: '2026-03-17T10:00:00Z',
    });

    const res = await request(app)
      .get(`/api/tasks/${taskId}/stages/${log.id}/logs`);
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/plain');
    expect(res.text).toBe('planning output here');
  });

  it('returns 404 for non-existent stage log', async () => {
    const res = await request(app)
      .get(`/api/tasks/${taskId}/stages/nonexistent/logs`);
    expect(res.status).toBe(404);
  });

  it('returns partial content for valid Range header', async () => {
    const logDir = path.join(tmpDir, '.agentboard', 'logs', taskId);
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'spec_review.log');
    fs.writeFileSync(logFile, 'abcdefghij'); // 10 bytes

    const project = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string };
    const log = createStageLog(db, {
      taskId,
      projectId: project.id,
      stage: 'spec_review',
      filePath: '.agentboard/logs/' + taskId + '/spec_review.log',
      startedAt: '2026-03-17T10:00:00Z',
    });

    const res = await request(app)
      .get(`/api/tasks/${taskId}/stages/${log.id}/logs`)
      .set('Range', 'bytes=5-9');
    expect(res.status).toBe(206);
    expect(res.text).toBe('fghij');
    expect(res.headers['content-range']).toBe('bytes 5-9/10');
  });

  it('returns 416 for unsatisfiable range', async () => {
    const logDir = path.join(tmpDir, '.agentboard', 'logs', taskId);
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'checks.log');
    fs.writeFileSync(logFile, 'short');

    const project = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string };
    const log = createStageLog(db, {
      taskId,
      projectId: project.id,
      stage: 'checks',
      filePath: '.agentboard/logs/' + taskId + '/checks.log',
      startedAt: '2026-03-17T10:00:00Z',
    });

    const res = await request(app)
      .get(`/api/tasks/${taskId}/stages/${log.id}/logs`)
      .set('Range', 'bytes=100-200');
    expect(res.status).toBe(416);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=stage-logs.test`
Expected: FAIL.

- [ ] **Step 3: Write route implementation**

Create `src/server/routes/stage-logs.ts`:

```typescript
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { StageLog } from '../../types/index.js';
import { getStageLogById, listStageLogsByTask } from '../../db/stage-log-queries.js';
import { getTaskById, getProjectById } from '../../db/queries.js';

export function createStageLogRoutes(db: Database.Database): Router {
  const router = Router({ mergeParams: true });

  /** Strip server-internal fields before sending to client. */
  function toClientStageLog(log: StageLog): Omit<StageLog, 'filePath' | 'projectId' | 'createdAt'> {
    const { filePath, projectId, createdAt, ...clientLog } = log;
    return clientLog;
  }

  // GET /api/tasks/:id/stages
  router.get('/', (req, res) => {
    const { id } = req.params;
    const task = getTaskById(db, id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const stages = listStageLogsByTask(db, id).map(toClientStageLog);
    res.json({ stages });
  });

  // GET /api/tasks/:id/stages/:stageLogId/logs
  router.get('/:stageLogId/logs', (req, res) => {
    const { id, stageLogId } = req.params;
    const stageLog = getStageLogById(db, stageLogId);

    if (!stageLog || stageLog.taskId !== id) {
      return res.status(404).json({ error: 'Stage log not found' });
    }

    const task = getTaskById(db, id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const project = getProjectById(db, task.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const absolutePath = path.resolve(project.path, stageLog.filePath);

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Log file not found' });
    }

    const stat = fs.statSync(absolutePath);
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) return res.status(416).json({ error: 'Invalid range' });

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;

      if (start >= stat.size || end >= stat.size) {
        return res.status(416).json({ error: 'Range not satisfiable' });
      }

      res.status(206);
      res.set('Content-Type', 'text/plain');
      res.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.set('Content-Length', String(end - start + 1));
      fs.createReadStream(absolutePath, { start, end }).pipe(res);
    } else {
      res.set('Content-Type', 'text/plain');
      res.set('Content-Length', String(stat.size));
      fs.createReadStream(absolutePath).pipe(res);
    }
  });

  return router;
}
```

- [ ] **Step 4: Mount routes in `createTestApp`**

In `src/test/helpers.ts`, add:

```typescript
import { createStageLogRoutes } from '../server/routes/stage-logs.js';

// Inside createTestApp, after existing route mounts:
app.use('/api/tasks/:id/stages', createStageLogRoutes(db));
```

- [ ] **Step 5: Mount routes in `src/server/index.ts`**

Add the stage-log routes as a nested router under the tasks path. Since `createStageLogRoutes` uses `mergeParams: true`, mount it as:

```typescript
import { createStageLogRoutes } from './routes/stage-logs.js';

// After the existing task routes mount, add:
app.use('/api/tasks/:id/stages', createStageLogRoutes(db));
```

This avoids path collision with the existing `/api/tasks` routes because it matches a more specific path (`/:id/stages`). Express resolves routes in registration order, and this specific path won't conflict with the task CRUD routes or chat routes.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=stage-logs.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/stage-logs.ts src/server/routes/stage-logs.test.ts src/test/helpers.ts src/server/index.ts
git commit -m "feat: add stage logs API endpoints"
```

---

## Task 9: Frontend API Client

**Files:**
- Modify: `ui/src/api/client.ts`

- [ ] **Step 1: Add API methods**

```typescript
import type { StageLog } from '../types';

// Add to the api object (after existing methods):
getStages(taskId: string) {
  return request<{ stages: StageLog[] }>('GET', `/api/tasks/${taskId}/stages`);
},
getStageLogContent(taskId: string, stageLogId: string): Promise<string> {
  return fetch(`/api/tasks/${taskId}/stages/${stageLogId}/logs`)
    .then(res => {
      if (!res.ok) throw new Error('Failed to fetch log content');
      return res.text();
    });
},
```

Note: `getStages` uses the existing `request<T>()` function (not `this.get`). `getStageLogContent` uses raw `fetch` because it returns `text/plain`, not JSON.

**Follow-up:** The initial `getStageLogContent` fetches full content. For large log files (5000+ lines), a future enhancement should add `getStageLogContentRange(taskId, stageLogId, start, end)` that sends a `Range` header for incremental loading. The server already supports byte-range requests — the client method is the gap.

- [ ] **Step 2: Verify build**

Run: `npm run build:ui`
Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add ui/src/api/client.ts
git commit -m "feat: add stage logs API client methods"
```

---

## Task 10: StageAccordion UI Component

**Files:**
- Create: `ui/src/components/StageRow.tsx`
- Create: `ui/src/components/SubtaskStages.tsx`
- Create: `ui/src/components/StageAccordion.tsx`

- [ ] **Step 1: Create StageRow component**

Create `ui/src/components/StageRow.tsx` — a single expandable stage row showing:
- Stage name, status icon (checkmark/spinner/dot), duration, token count
- Summary text (one line)
- Expandable raw log content area (lazy loaded)
- Auto-scroll behavior within the log content

Key behaviors:
- Collapsed by default for completed stages
- Expanded when stage is `running`
- Log content fetched via `api.getStageLogContent()` on expand
- Live chunks appended via Socket.IO `run:log` filtered by `stage` field

- [ ] **Step 2: Create SubtaskStages component**

Create `ui/src/components/SubtaskStages.tsx` — renders a group of subtask stages nested under the "Implementing" parent stage. Shows mini stage progress per subtask (implement/checks/code_quality as icons) with expand-to-detail.

- [ ] **Step 3: Create StageAccordion component**

Create `ui/src/components/StageAccordion.tsx` — the main component:
- Fetches `/api/tasks/:id/stages` on mount
- Renders `StageRow` for each parent-level stage
- For the "implementing" section, groups subtask stages and renders `SubtaskStages`
- Listens to `stage:transition` Socket.IO events to update stage metadata in real time
- **Auto-follow mode**: auto-expands the active stage, collapses previous
- **Pinned mode**: triggered on user click or scroll-up. Shows "Follow live" button
- **Prefetch**: on mount, prefetches log content for the active/most-recent stage

- [ ] **Step 4: Verify build**

Run: `npm run build:ui`
Expected: Clean compilation.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/StageRow.tsx ui/src/components/SubtaskStages.tsx ui/src/components/StageAccordion.tsx
git commit -m "feat: add StageAccordion UI component for per-stage log viewing"
```

---

## Task 11: Integrate StageAccordion into TaskPage

**Files:**
- Modify: `ui/src/components/TaskPage.tsx`

- [ ] **Step 1: Replace Logs tab with StageAccordion**

In `TaskPage.tsx`:
- Import `StageAccordion`
- Change the default tab from `'logs'` to `'stages'`
- Update the `Tab` type: `type Tab = 'stages' | 'events' | 'runs';`
- Replace the `LogViewer` rendering with `<StageAccordion taskId={id} />`
- Keep `LogViewer` import for backward compatibility (old tasks without stage_logs will fall back to it)
- Update tab labels: "Stages" (default), "Events", "Runs"

- [ ] **Step 2: Verify build**

Run: `npm run build:ui`
Expected: Clean compilation.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`
- Open a task page → verify StageAccordion renders (empty state if no stage_logs)
- Create a test task → verify stages appear as the pipeline runs

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/TaskPage.tsx
git commit -m "feat: replace Logs tab with StageAccordion as default task view"
```

---

## Task 12: Log File Cleanup

**Files:**
- Modify: `src/worker/log-writer.ts`

- [ ] **Step 1: Update `cleanupOldLogs` to handle stage-wise directory structure**

The existing function only handles flat `{taskId}.log` files. Extend it to also delete `logs/{taskId}/` directories (per-stage log directories) when their modification time exceeds the retention period:

```typescript
// After the existing file cleanup loop, add directory cleanup:
for (const entry of fs.readdirSync(logsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dirPath = path.join(logsDir, entry.name);
  try {
    const stat = fs.statSync(dirPath);
    if (stat.mtimeMs < cutoff) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      deleted++;
    }
  } catch {
    // Best effort
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add src/worker/log-writer.ts
git commit -m "feat: extend log cleanup to handle per-stage log directories"
```

---

## Task 13: Final Verification & Cleanup

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: Clean compilation, no warnings.

- [ ] **Step 3: End-to-end smoke test**

Run: `npm run dev`
1. Create a task via the chat UI
2. Move it to "ready" column
3. Watch the StageAccordion auto-follow as stages execute
4. After completion, reload the page and verify stages load from DB/files
5. Expand completed stages to verify log content loads

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup for stage-wise log streaming"
```
