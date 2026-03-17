# Stage-Wise Log Streaming & Persistence

**Date:** 2026-03-17
**Status:** Approved

## Problem

Agent thinking and pipeline output during task execution is ephemeral — streamed via Socket.IO but not persisted in a structured way. Users cannot review what happened during a specific pipeline stage after the fact. The current LogViewer shows a flat, unsegmented stream that disappears when the session ends. File-based logs exist but are monolithic per-task with no stage boundaries.

## Goals

1. Stream agent output to the UI in real time, organized by pipeline stage
2. Persist output so it can be reviewed later by clicking on a task
3. Store logs stage-wise (one file per stage) with a DB index for fast retrieval
4. Show structured summaries extracted from existing stage results (no extra LLM calls)
5. Auto-follow the active stage during live execution, with manual override

## Non-Goals

- LLM-generated summaries of stage output
- Event-sourced activity feed / replay system
- Changes to existing runs, events, or task APIs

---

## Migration Strategy

### Existing `task_logs` Table

The current `task_logs` table tracks one monolithic log file per task (`log_path`, `size_bytes`). It is **kept as-is** — no migration, no drop. The new `stage_logs` table is additive alongside it.

- `task_logs` continues to serve the existing `log-writer.ts` system for backward compatibility
- `createTaskLogger`/`openTaskLogger` remain functional during the transition
- Once all stages write through `StageRunner`, `task_logs` and `log-writer.ts` become dead code and can be removed in a follow-up cleanup PR
- Existing monolithic `.agentboard/logs/{taskId}.log` files are left in place (read-only, no migration)

### Rollout Order

1. Add `stage_logs` table (additive schema change)
2. Implement `StageRunner` — stages write to both old `task_logs` and new `stage_logs` during transition
3. Build StageAccordion UI alongside existing LogViewer
4. Switch default tab to StageAccordion
5. Remove old `task_logs` table, `log-writer.ts`, and `LogViewer` in cleanup PR

---

## Stage Name Mapping

The `stage` column in `stage_logs` uses a `StageLogStage` type that extends the existing pipeline `Stage` type to include sub-stage granularity:

```typescript
// Existing pipeline stages (src/types/index.ts)
type Stage = 'spec_review' | 'planning' | 'implementing' | 'checks'
           | 'code_quality' | 'final_review' | 'pr_creation';

// Extended for stage_logs — includes sub-stages not in the pipeline enum
type StageLogStage = Stage | 'inline_fix' | 'learner';
```

- File names use the `StageLogStage` value: `implementing.log` (not `implement.log`)
- `inline_fix` is a sub-stage that runs within the `implementing` pipeline phase
- `learner` is fire-and-forget — gets a `stage_logs` row but is non-blocking. If `extractLearnings()` fails, the row is marked `failed` silently (no task impact)

---

## Storage Model

### File Structure

```
.agentboard/logs/{taskId}/
  spec_review.log
  planning.log
  planning-2.log              # retry attempt 2
  subtask-{subtaskId}/
    implementing.log
    checks.log
    inline_fix.log            # if checks failed and inline fix ran
    checks-2.log              # re-run after inline fix
    code_quality.log
  final_review.log
  pr_creation.log
  learner.log                 # fire-and-forget, non-blocking
```

- One file per stage execution, append-only during execution
- Retries get suffixed: `{stage}-{attempt}.log`
- Subtask stages nest under `subtask-{subtaskId}/`
- Simple tasks (no subtasks) put implementing/checks/code_quality at the top level
- File paths are relative to the project root
- File names use `StageLogStage` values (e.g., `implementing.log`, not `implement.log`)

### DB Table — `stage_logs`

| Column       | Type    | Notes                                                  |
|--------------|---------|--------------------------------------------------------|
| id           | TEXT PK | UUID                                                   |
| task_id      | TEXT    | FK → tasks, NOT NULL                                   |
| project_id   | TEXT    | FK → projects, NOT NULL (denormalized for direct queries) |
| run_id       | TEXT    | FK → runs, nullable                                    |
| stage        | TEXT    | StageLogStage value. NOT NULL                          |
| subtask_id   | TEXT    | null for parent-level stages                           |
| attempt      | INTEGER | 1-based, for retries. Default 1                        |
| file_path    | TEXT    | Relative path to log file. NOT NULL                    |
| status       | TEXT    | running, completed, failed, skipped. NOT NULL          |
| summary      | TEXT    | Extracted from stage result (plan summary, verdict, etc.) |
| tokens_used  | INTEGER |                                                        |
| duration_ms  | INTEGER |                                                        |
| created_at   | TEXT    | ISO 8601. NOT NULL. Row creation time                  |
| started_at   | TEXT    | ISO 8601. NOT NULL                                     |
| completed_at | TEXT    | ISO 8601. Null while running                           |

### DDL

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

- One row per stage execution attempt
- `project_id` denormalized from the task row — avoids JOIN for per-project queries (consistent with `task_logs` pattern)
- `created_at` included for convention consistency with other tables
- Summary comes from existing stage return values — no extra LLM call
- DB is an index; files hold the content

---

## Streaming & Real-Time Updates

### Enhanced `run:log` Socket.IO Event

```typescript
{
  taskId: string;
  runId: string;
  stage: string;         // StageLogStage value: "planning", "implementing", etc.
  subtaskId?: string;    // null for parent stages
  chunk: string;
  timestamp: string;
}
```

The two new fields (`stage`, `subtaskId`) are additive. The existing `LogViewer` component filters on `taskId` only and ignores unknown fields, so it continues to work unchanged during the transition period. The old `LogViewer` is removed only after `StageAccordion` is fully shipped.

The existing `broadcastLog` function in `src/server/ws.ts` needs its type signature updated to include the new `stage` and `subtaskId` fields. Since the fields are optional from the consumer's perspective (old LogViewer ignores them), this is a non-breaking type change.

### New `stage:transition` Socket.IO Event

```typescript
{
  taskId: string;
  stage: string;
  subtaskId?: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  summary?: string;       // populated on completed/failed
  durationMs?: number;
  tokensUsed?: number;
}
```

### Write Behavior

- Chunks appended to file immediately (same as current `fs.appendFileSync`)
- DB row created at stage start, updated once at stage end
- No per-chunk DB writes

### Stages Using `execFile` / `claude --print`

Some stages (e.g., `extractLearnings` in `learner.ts`) spawn `claude --print` via `execFile` and capture stdout directly, not through the `onOutput` callback. For these stages:
- `StageRunner` captures the stdout return value from `execFile` and writes it to the log file after completion (not streamed live)
- The `stage_logs` row is still created at start and updated at end
- Live streaming is not available for these stages — the UI shows a spinner during execution and renders the full output on completion

---

## API

### `GET /api/tasks/:id/stages`

Returns all `stage_logs` rows for a task, ordered by `started_at`. No file content — metadata only.

```json
{
  "stages": [
    {
      "id": "...",
      "stage": "spec_review",
      "subtaskId": null,
      "attempt": 1,
      "status": "completed",
      "summary": "Spec is complete, no gaps identified",
      "durationMs": 4200,
      "tokensUsed": 3100,
      "startedAt": "2026-03-17T10:00:00Z",
      "completedAt": "2026-03-17T10:00:04Z"
    },
    {
      "id": "...",
      "stage": "implementing",
      "subtaskId": "st-1",
      "attempt": 1,
      "status": "running",
      "summary": null,
      "startedAt": "2026-03-17T10:01:00Z",
      "completedAt": null
    }
  ]
}
```

### `GET /api/tasks/:id/stages/:stageLogId/logs`

Reads the file at `file_path` and returns raw content as `text/plain`. Supports a simplified byte-range subset (single range only, not full RFC 7233):

- No `Range` header → 200 with full content, `Content-Length` header set
- `Range: bytes=START-END` → 206 with partial content, `Content-Range` header set
- Invalid/unsatisfiable range → 416

```
GET /api/tasks/t-1/stages/sl-1/logs
→ 200 OK
Content-Type: text/plain
Content-Length: 24580

[raw log content]

GET /api/tasks/t-1/stages/sl-1/logs
Range: bytes=20000-24580
→ 206 Partial Content
Content-Type: text/plain
Content-Range: bytes 20000-24580/24580

[partial log content]
```

---

## Worker Integration — StageRunner

A `StageRunner` utility wraps existing stage calls with lifecycle management. Existing stage functions are unchanged.

### Lifecycle

```
Before stage call:
  1. Create stage_logs DB row (status: running)
  2. Create/open file at logs/{taskId}/{stage}.log
  3. Emit stage:transition { status: 'running' }
  4. Create onOutput callback that:
     - Appends chunk to file
     - Emits run:log with stage + subtaskId fields

After stage returns:
  5. Extract summary from stage result
  6. Update stage_logs row (status, summary, duration, tokens)
  7. Emit stage:transition { status: 'completed' | 'failed' }
```

### Usage in Worker Loop

```typescript
const runner = createStageRunner(taskId, subtaskId, io, db);
const result = await runner.execute('planning', (onOutput) =>
  runPlanning(task, config, onOutput)
);
```

`runner.execute` creates the wrapped `onOutput` callback (which appends to file + emits Socket.IO events) and passes it to the stage function via the callback argument. The stage function receives it as its `onOutput` parameter — no change to stage function signatures.

`createStageRunner` handles the full lifecycle. The loop stays clean.

### Directory Creation

- `logs/{taskId}/` created when first stage starts
- `logs/{taskId}/subtask-{id}/` created when first subtask stage starts

---

## UI — StageAccordion Component

Replaces the current Logs tab as the default view on TaskPage.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ Spec Review    ✓ completed   4.2s   3.1k tokens         │
│  "Spec is complete, no gaps identified"                  │
├─────────────────────────────────────────────────────────┤
│ Planning       ✓ completed   12.1s  8.4k tokens         │
│  "3 subtasks: auth middleware, route guards, tests"      │
├─────────────────────────────────────────────────────────┤
│ ▼ Implementing                                           │
│   ┌ Subtask 1: Auth middleware  ✓ done                  │
│   │  implement ✓  checks ✓  code_quality ✓              │
│   ├ Subtask 2: Route guards    ● running                │
│   │  ▼ implement ● running  2m 12s  ···                 │
│   │  ┌──────────────────────────────────────────┐       │
│   │  │ [live raw output streaming here]          │       │
│   │  │ Analyzing route structure...              │       │
│   │  │ Creating guard for /api/admin...          │       │
│   │  │ █                                         │       │
│   │  └──────────────────────────────────────────┘       │
│   └ Subtask 3: Tests           ○ queued                 │
├─────────────────────────────────────────────────────────┤
│ Final Review   ○ pending                                 │
├─────────────────────────────────────────────────────────┤
│ PR Creation    ○ pending                                 │
└─────────────────────────────────────────────────────────┘
```

### Behavior

- **Auto-follow mode** (default): `stage:transition` events auto-expand the active stage and collapse the previous. A pulsing dot indicates the live stage.
- **Pinned mode**: triggered when user clicks a different stage or scrolls up in raw output. A "Follow live" button appears to re-engage auto-follow.
- **Lazy load with prefetch**: on page open, `GET /stages` fetches metadata. The active/most-recent stage's log content is prefetched. Other stages load on expand.

### Tabs (Restructured)

- **Default view**: StageAccordion (replaces Logs tab)
- **Runs**: historical run records (unchanged)
- **Events**: raw event timeline (unchanged)

---

## Edge Cases & Recovery

### Stage Crash Mid-Run

- File has partial output (already appended incrementally)
- DB row stays `status: running` with no `completed_at`
- Recovery logic is added to the existing `recoverStaleTasks` function in `recovery.ts`, after all task-level recovery (including `recoverStalledSubtaskChains`):
  1. Task recovery runs first (existing behavior)
  2. Subtask chain recovery runs second (existing `recoverStalledSubtaskChains`)
  3. Then: find `stage_logs` rows with `status: running` and mark as `failed` (metadata cleanup, does not affect task state transitions)
  4. Partial file preserved for debugging

### Retries

- Each attempt gets its own `stage_logs` row and file: `planning.log`, `planning-2.log`, `planning-3.log`
- UI shows all attempts; most recent expanded by default

### Inline Fix Flow

- Checks fail → inline_fix runs → checks re-run
- Each gets its own stage entry: `checks.log` (failed), `inline_fix.log`, `checks-2.log` (passed)
- UI shows the natural sequence

### Simple Tasks (No Subtasks)

- Stages run directly at the top level: `implementing.log`, `checks.log`, `code_quality.log`
- No subtask directory created

### Large Log Files

- API supports simplified byte-range requests for partial reads
- UI uses virtualized scrolling for content exceeding 5000 lines

### Log File Cleanup

The existing `cleanupOldLogs` function in `log-writer.ts` handles monolithic log files. For the new per-stage structure:
- Cleanup operates on the `logs/{taskId}/` directory level — delete the entire directory when the task's log retention expires (default 30 days, same as existing policy)
- Corresponding `stage_logs` rows are deleted via `ON DELETE CASCADE` from the task or via a cleanup query matching the task_id
- Cleanup logic is added to the existing function, not a separate system

---

## Summary of Changes

| Layer        | What Changes                                                      |
|--------------|-------------------------------------------------------------------|
| **DB**       | New `stage_logs` table                                            |
| **Files**    | `logs/{taskId}/{stage}.log` per stage (replaces monolithic log)   |
| **Socket.IO**| `run:log` gains `stage`/`subtaskId`; new `stage:transition` event |
| **API**      | Two new endpoints: list stages, read stage logs                   |
| **Worker**   | `StageRunner` wraps stage calls with lifecycle                    |
| **UI**       | `StageAccordion` replaces Logs tab as default view                |
