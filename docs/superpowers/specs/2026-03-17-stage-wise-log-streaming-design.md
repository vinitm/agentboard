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

## Storage Model

### File Structure

```
.agentboard/logs/{taskId}/
  spec_review.log
  planning.log
  planning-2.log              # retry attempt 2
  subtask-{subtaskId}/
    implement.log
    checks.log
    inline_fix.log            # if checks failed and inline fix ran
    checks-2.log              # re-run after inline fix
    code_quality.log
  final_review.log
  pr_creation.log
```

- One file per stage execution, append-only during execution
- Retries get suffixed: `{stage}-{attempt}.log`
- Subtask stages nest under `subtask-{subtaskId}/`
- Simple tasks (no subtasks) put implement/checks/code_quality at the top level
- File paths are relative to the project root

### DB Table — `stage_logs`

| Column       | Type    | Notes                                                  |
|--------------|---------|--------------------------------------------------------|
| id           | TEXT PK | UUID                                                   |
| task_id      | TEXT    | FK → tasks, NOT NULL                                   |
| run_id       | TEXT    | FK → runs, nullable                                    |
| stage        | TEXT    | spec_review, planning, implement, checks, etc. NOT NULL |
| subtask_id   | TEXT    | null for parent-level stages                           |
| attempt      | INTEGER | 1-based, for retries. Default 1                        |
| file_path    | TEXT    | Relative path to log file. NOT NULL                    |
| status       | TEXT    | running, completed, failed, skipped. NOT NULL          |
| summary      | TEXT    | Extracted from stage result (plan summary, verdict, etc.) |
| tokens_used  | INTEGER |                                                        |
| duration_ms  | INTEGER |                                                        |
| started_at   | TEXT    | ISO 8601. NOT NULL                                     |
| completed_at | TEXT    | ISO 8601. Null while running                           |

- One row per stage execution attempt
- Summary comes from existing stage return values — no extra LLM call
- DB is an index; files hold the content

---

## Streaming & Real-Time Updates

### Enhanced `run:log` Socket.IO Event

```typescript
{
  taskId: string;
  runId: string;
  stage: string;         // "planning", "implement", etc.
  subtaskId?: string;    // null for parent stages
  chunk: string;
  timestamp: string;
}
```

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
      "stage": "implement",
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

Reads the file at `file_path` and returns raw content. Supports `Range` header for partial reads (large files).

```json
{
  "content": "...",
  "size": 24580
}
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
const result = await runner.execute('planning', () =>
  runPlanning(task, config, onOutput)
);
```

`createStageRunner` handles the full lifecycle. The loop stays clean. Stage functions still receive `onOutput` and return their typed results.

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
- Worker recovery: on restart, find `stage_logs` rows with `status: running`. Mark as `failed`. Partial file preserved for debugging.

### Retries

- Each attempt gets its own `stage_logs` row and file: `planning.log`, `planning-2.log`, `planning-3.log`
- UI shows all attempts; most recent expanded by default

### Inline Fix Flow

- Checks fail → inline_fix runs → checks re-run
- Each gets its own stage entry: `checks.log` (failed), `inline_fix.log`, `checks-2.log` (passed)
- UI shows the natural sequence

### Simple Tasks (No Subtasks)

- Stages run directly at the top level: `implement.log`, `checks.log`, `code_quality.log`
- No subtask directory created

### Large Log Files

- API supports `Range` header for partial reads
- UI uses virtualized scrolling for content exceeding ~5000 lines

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
