# Task Grid Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the kanban board with a status-grouped card grid and remove subtask entities from the system.

**Architecture:** Remove parent/child task relationships and column positioning from the data model. Simplify the worker loop to process one task through the full pipeline. Replace the kanban Board component with a TaskGrid component that groups cards by status phase (Attention, Running, Queued, Done).

**Tech Stack:** TypeScript, React, Tailwind CSS, SQLite (better-sqlite3), Express, Socket.IO, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-task-grid-redesign-design.md`

---

## File Structure

### Files to Create
| File | Responsibility |
|------|---------------|
| `src/db/migrations/002-remove-subtasks.ts` | DB migration: drop subtask columns, clean up existing subtasks |
| `ui/src/components/TaskGrid.tsx` | Status-grouped responsive card grid with collapsible sections |
| `ui/src/components/PipelineBar.tsx` | 7-segment pipeline progress bar (extracted from TaskCard for reuse on TaskPage) |

### Files to Modify
| File | Change |
|------|--------|
| `src/types/index.ts` | Remove `parentTaskId`, `columnPosition`, `subtaskId`, `maxSubcardDepth`, `PlanningResultMeta.subtaskCount`; rename `PlanReviewAction.edits.subtasks` to `.steps` |
| `src/db/schema.ts` | Add migration runner call |
| `src/db/queries.ts` | Remove `moveToColumn`, `getSubtasksByParentId`, `getNextBacklogSubtask`; remove `parentTaskId`/`columnPosition` from row mapping and `updateTask` |
| `src/worker/loop.ts` | Remove `processSubtaskV2`, subtask imports, sibling promotion; simplify `shouldAutoApprovePlan` |
| `src/worker/stages/planner.ts` | Rename `subtasks` to `steps` in `PlanningResult` |
| `src/worker/recovery.ts` | Remove subtask chain recovery |
| `src/worker/auto-merge.ts` | Remove parent task guard |
| `src/server/routes/tasks.ts` | Remove `/move` endpoint, remove `handleSubtaskTerminal`; add `POST /cancel` |
| `ui/src/types.ts` | Remove `parentTaskId`, `columnPosition`, `subtaskId` from interfaces |
| `ui/src/components/TaskCard.tsx` | Rewrite: remove drag-and-drop, subtask section; add pipeline progress bar |
| `ui/src/components/TaskPage.tsx` | Remove subtask grid, add cost summary |
| `ui/src/components/TopBar.tsx` | Remove bulk action references |
| `ui/src/App.tsx` | Replace `Board` import/route with `TaskGrid` |
| `ui/src/hooks/useTasks.ts` | Remove `moveTask`; remove subtask filtering |
| `prompts/planner.md` | Rename "subtasks" to "steps" in JSON output schema |
| `ui/package.json` | Remove `@dnd-kit/*` dependencies |

### Files to Delete
| File | Reason |
|------|--------|
| `ui/src/components/Board.tsx` | Replaced by TaskGrid |
| `ui/src/components/Column.tsx` | Kanban columns no longer exist |
| `ui/src/components/SubtaskMiniCard.tsx` | Subtasks no longer exist |
| `ui/src/components/SubtaskStages.tsx` | Subtasks no longer exist |

---

## Task 1: Backend Types — Remove Subtask Fields

**Files:**
- Modify: `src/types/index.ts`
- Test: `src/types/index.test.ts` (create if needed, or rely on downstream compile checks)

- [ ] **Step 1: Remove subtask-related fields from Task interface**

In `src/types/index.ts`, change the `Task` interface (lines 82-100):

```typescript
// Remove these two fields:
//   parentTaskId: number | null;    (line 85)
//   columnPosition: number;         (line 91)

export interface Task {
  id: number;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  riskLevel: RiskLevel;
  priority: number;
  spec: string | null;
  blockedReason: string | null;
  blockedAtStage: string | null;
  claimedAt: string | null;
  claimedBy: string | null;
  chatSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Remove subtaskId from StageLog and StageTransitionEvent**

In `src/types/index.ts`:

```typescript
// StageLog (line 34): remove subtaskId field (line 40)
export interface StageLog {
  id: string;
  taskId: number;
  projectId: string;
  runId: string | null;
  stage: StageLogStage;
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

// StageTransitionEvent (line 52): remove subtaskId field (line 55)
export interface StageTransitionEvent {
  taskId: number;
  stage: StageLogStage;
  status: StageLogStatus;
  summary?: string;
  durationMs?: number;
  tokensUsed?: number;
}
```

- [ ] **Step 3: Delete PlanningResultMeta entirely**

In `src/types/index.ts`, delete the entire `PlanningResultMeta` interface (lines 202-207). `totalFiles` is derivable from `fileMap.length` at render time, and `confidence` already lives on `PlanningResult`. Search for all references to `PlanningResultMeta` across the codebase and remove them.

- [ ] **Step 4: Update PlanReviewAction — rename subtasks to steps**

```typescript
// Line 301: rename edits.subtasks to edits.steps
export interface PlanReviewAction {
  action: 'approve' | 'reject';
  reason?: string;
  edits?: {
    planSummary?: string;
    steps?: Array<{ title: string; description: string }>;
  };
}
```

- [ ] **Step 5: Remove maxSubcardDepth and maxRalphIterations from AgentboardConfig**

```typescript
// Line 240: remove maxSubcardDepth (line 246) and maxRalphIterations (line 264)
// The full interface keeps all other fields unchanged
```

- [ ] **Step 6: Run typecheck to see all downstream breakages**

Run: `npx tsc --noEmit 2>&1 | head -60`
Expected: Type errors in queries.ts, loop.ts, routes, and UI files. This is expected — we fix them in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts
git commit -m "refactor: remove subtask fields from backend types

Drop parentTaskId, columnPosition, subtaskId, maxSubcardDepth,
maxRalphIterations, PlanningResultMeta.subtaskCount. Rename
PlanReviewAction.edits.subtasks to .steps."
```

---

## Task 2: DB Migration — Drop Subtask Columns

**Files:**
- Create: `src/db/migrations/002-remove-subtasks.ts`
- Modify: `src/db/schema.ts`
- Test: `src/db/migrations/002-remove-subtasks.test.ts`

- [ ] **Step 1: Write the migration test**

Create `src/db/migrations/002-remove-subtasks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../test/helpers.js';
import { runMigration002 } from './002-remove-subtasks.js';

describe('migration 002: remove subtasks', () => {
  it('drops parent_task_id and column_position from tasks', () => {
    const db = createTestDb();
    // Insert a parent task and a subtask
    db.prepare(`INSERT INTO projects (id, name, path, config_path) VALUES ('p1', 'test', '/tmp', '/tmp/config.json')`).run();
    db.prepare(`INSERT INTO tasks (project_id, title, status) VALUES ('p1', 'parent', 'implementing')`).run();
    const parentId = (db.prepare('SELECT last_insert_rowid() as id').get() as any).id;
    db.prepare(`INSERT INTO tasks (project_id, title, status, parent_task_id) VALUES ('p1', 'child', 'backlog', ?)`).run(parentId);

    runMigration002(db);

    // parent_task_id column should be gone
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).not.toContain('parent_task_id');
    expect(colNames).not.toContain('column_position');

    // Subtask row should have been deleted (terminal check: it was backlog, non-terminal → cancelled then deleted)
    const tasks = db.prepare('SELECT * FROM tasks').all();
    expect(tasks).toHaveLength(1); // only parent remains
  });

  it('drops subtask_id from stage_logs', () => {
    const db = createTestDb();
    runMigration002(db);

    const cols = db.prepare("PRAGMA table_info(stage_logs)").all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).not.toContain('subtask_id');
  });

  it('is idempotent on clean DB', () => {
    const db = createTestDb();
    // Run twice — should not throw
    runMigration002(db);
    expect(() => runMigration002(db)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/db/migrations/002-remove-subtasks.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the migration**

Create `src/db/migrations/002-remove-subtasks.ts`:

```typescript
import type Database from 'better-sqlite3';

export function runMigration002(db: Database.Database): void {
  // SQLite doesn't support DROP COLUMN before 3.35.0, so we use the
  // rename-recreate pattern for broad compatibility.

  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Cancel non-terminal subtasks, delete all subtasks
    const hasParentCol = (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>)
      .some(c => c.name === 'parent_task_id');

    if (hasParentCol) {
      // Cancel non-terminal subtasks
      db.prepare(`
        UPDATE tasks SET status = 'cancelled', updated_at = datetime('now')
        WHERE parent_task_id IS NOT NULL
          AND status NOT IN ('done', 'failed', 'cancelled')
      `).run();
      // Delete all subtask rows
      db.prepare('DELETE FROM tasks WHERE parent_task_id IS NOT NULL').run();

      // Recreate tasks table without parent_task_id and column_position
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

    // 2. Drop subtask_id from stage_logs
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/db/migrations/002-remove-subtasks.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire migration into schema initialization**

In `src/db/schema.ts`, after the DDL execution, add the migration call. Find the `initializeDatabase` function (or wherever `db.exec(DDL)` is called) and add:

```typescript
import { runMigration002 } from './migrations/002-remove-subtasks.js';

// After db.exec(DDL):
runMigration002(db);
```

- [ ] **Step 6: Also update the DDL string itself**

In `src/db/schema.ts`, update the `tasks` CREATE TABLE (lines 13-29) to remove `parent_task_id` (line 16) and `column_position` (line 22). Remove the `idx_tasks_parent_task_id` index (line 86). Remove `subtask_id` from `stage_logs` table (line 102).

- [ ] **Step 7: Run the test**

Run: `npx vitest run src/db/migrations/002-remove-subtasks.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/ src/db/schema.ts
git commit -m "feat: add migration to remove subtask columns

Drop parent_task_id, column_position from tasks table.
Drop subtask_id from stage_logs. Delete existing subtask rows."
```

---

## Task 3: Backend Queries — Remove Subtask Functions

**Files:**
- Modify: `src/db/queries.ts`
- Test: existing query tests

- [ ] **Step 1: Remove subtask query functions**

In `src/db/queries.ts`, delete these functions:
- `getSubtasksByParentId` (lines 321-329)
- `getNextBacklogSubtask` (lines 331-341)
- `moveToColumn` (lines 285-296)

- [ ] **Step 2: Remove parentTaskId and columnPosition from row mapping**

Find the `rowToTask` function. Remove the `parentTaskId` and `columnPosition` field mappings from the snake_case → camelCase conversion.

- [ ] **Step 3: Remove parentTaskId and columnPosition from updateTask**

In the `updateTask` function (around line 250-283), remove:
- The `data.parentTaskId !== undefined` check (line 271)
- The `data.columnPosition !== undefined` check (if it exists)

- [ ] **Step 4: Remove parentTaskId and columnPosition from createTask**

In the `createTask` function, remove these fields from the INSERT statement and the function parameters.

- [ ] **Step 5: Fix listTasksByStatus ORDER BY**

`listTasksByStatus` (around line 235) uses `ORDER BY column_position ASC`. Change to `ORDER BY priority DESC, updated_at DESC` since `column_position` is being dropped.

- [ ] **Step 6: Remove subtask-related imports from other files**

Search for imports of `getSubtasksByParentId`, `getNextBacklogSubtask`, and `moveToColumn` across the codebase and remove them. Key files:
- `src/worker/loop.ts` (line 20-21)
- `src/server/routes/tasks.ts`

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: Some tests may fail due to downstream references. Note which ones for fixing in later tasks.

- [ ] **Step 7: Commit**

```bash
git add src/db/queries.ts
git commit -m "refactor: remove subtask query functions

Delete getSubtasksByParentId, getNextBacklogSubtask, moveToColumn.
Remove parentTaskId and columnPosition from row mapping and mutations."
```

---

## Task 4: Worker Loop — Remove Subtask Orchestration

**Files:**
- Modify: `src/worker/loop.ts`
- Modify: `src/worker/recovery.ts`
- Modify: `src/worker/auto-merge.ts`

This is the largest backend change. The worker loop currently has ~300 lines of subtask orchestration. We remove it all.

- [ ] **Step 1: Remove subtask imports from loop.ts**

In `src/worker/loop.ts` (lines 20-21), remove imports of `getSubtasksByParentId` and `getNextBacklogSubtask`.

- [ ] **Step 2: Remove processSubtaskV2 function**

Find the `processSubtaskV2` function (around line 376) and delete the entire function. It handles the implement-through-code-quality cycle for individual subtasks.

- [ ] **Step 3: Remove subtask creation after plan approval**

Find where subtasks are created after plan approval (search for `createTask` calls inside the planning/approval flow, around lines 1114-1169 and 1277-1312). Replace subtask creation with storing the plan as a JSON blob on the task itself (it likely already does this).

- [ ] **Step 4: Remove sibling promotion logic**

Search for `promoteNextSubtask` or `getNextBacklogSubtask` calls. Delete the promotion logic that moves the next backlog sibling to `ready` when one completes.

- [ ] **Step 5: Remove parent status rollup**

Search for `rollupParentStatus` or `checkAndUpdateParentStatus` or any logic that checks "are all subtasks terminal? → update parent". Delete it.

- [ ] **Step 6: Simplify shouldAutoApprovePlan**

Find `shouldAutoApprovePlan` (around line 96-108). Change it from checking `plan.subtasks.length` to `plan.steps.length`:

```typescript
function shouldAutoApprovePlan(config: AgentboardConfig, plan: PlanningResult, task: Task): boolean {
  if (!config.autoPlanApproval) return false;
  if (task.riskLevel !== 'low') return false;  // keep existing strict check
  if (plan.steps.length > 5) return false;
  if (plan.confidence < 0.8) return false;
  return true;
}
```

- [ ] **Step 7: Simplify recovery.ts — remove subtask chain recovery**

In `src/worker/recovery.ts`:
1. Delete the `recoverStalledSubtaskChains` function (around lines 79-100) entirely.
2. In `recoverStaleTasks` (line 31), the SQL query explicitly selects `parent_task_id` and the result type annotation includes `parent_task_id: number | null`. Remove both — the column no longer exists after migration. Update the query to not reference `parent_task_id` and remove the type annotation.

- [ ] **Step 8: Check auto-merge.ts for subtask references**

In `src/worker/auto-merge.ts`, search for any `parentTaskId`, `parent_task_id`, or subtask references. If the parent task guard exists, remove it. If it does not exist (the spec may have been anticipating future code), this step is a no-op — move on.

- [ ] **Step 9: Run tests**

Run: `npm test`
Expected: Tests involving subtask creation/promotion will fail. That's expected — those tests need updating or removal.

- [ ] **Step 10: Update or remove subtask-related tests**

Find tests that create subtasks, test promotion, or test parent rollup. Remove them or rewrite them to test single-task pipeline flow.

- [ ] **Step 11: Run tests again**

Run: `npm test`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/worker/loop.ts src/worker/recovery.ts src/worker/auto-merge.ts
git commit -m "refactor: remove subtask orchestration from worker loop

Delete processSubtaskV2, sibling promotion, parent status rollup,
subtask chain recovery. Simplify shouldAutoApprovePlan to use
plan.steps instead of plan.subtasks."
```

---

## Task 5: Planner Stage — Rename subtasks to steps

**Files:**
- Modify: `src/worker/stages/planner.ts`
- Test: `src/worker/stages/planner.test.ts` (if exists)

- [ ] **Step 1: Rename PlanningResult.subtasks to .steps**

In `src/worker/stages/planner.ts` (lines 12-23):

```typescript
export interface PlanningResult {
  planSummary: string;
  confidence: number;
  steps: Array<{
    title: string;
    description: string;
    files?: string[];
  }>;
  assumptions: string[];
  fileMap: string[];
}
```

- [ ] **Step 2: Update all references to .subtasks in the file**

Search for `.subtasks` in planner.ts and rename to `.steps`. This includes:
- JSON parsing/validation (`validatePlanningResult`)
- Plan review logic
- Prompt template variable names (check `prompts/planner.md` too)

- [ ] **Step 3: Update the planner prompt template**

In `prompts/planner.md` (or wherever the planner prompt lives), change references from "subtasks" to "steps". The JSON output schema in the prompt should use `"steps"` not `"subtasks"`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS (or planner tests need `.subtasks` → `.steps` rename)

- [ ] **Step 5: Commit**

```bash
git add src/worker/stages/planner.ts prompts/
git commit -m "refactor: rename PlanningResult.subtasks to .steps

Plan steps are implementation instructions, not tracked entities."
```

---

## Task 6: Server Routes — Remove Move Endpoint

**Files:**
- Modify: `src/server/routes/tasks.ts`

- [ ] **Step 1: Delete handleSubtaskTerminal function**

In `src/server/routes/tasks.ts`, find `handleSubtaskTerminal` (around lines 36-64) and delete it entirely.

- [ ] **Step 2: Delete the POST /move endpoint**

Find `router.post('/:id/move', ...)` and delete the entire handler.

- [ ] **Step 3: Add POST /cancel endpoint if not present**

Check if a cancel endpoint already exists. If not, add one:

```typescript
router.post('/:id/cancel', async (req, res) => {
  const { id } = req.params;
  const task = updateTask(db, Number(id), { status: 'cancelled' });
  if (!task) return res.status(404).json({ error: 'Task not found' });
  broadcast(io, task.projectId, 'task:updated', task);
  res.json(task);
});
```

- [ ] **Step 4: Remove subtask filtering from GET /tasks**

If the GET endpoint filters by `parentTaskId`, remove that filter.

- [ ] **Step 5: Remove the `task:moved` WebSocket event**

Search for `task:moved` broadcast calls and remove them.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/tasks.ts
git commit -m "refactor: remove move endpoint and subtask terminal handler

Replace with dedicated cancel endpoint. Remove task:moved events."
```

---

## Task 7: Backend — Full Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (0 errors). If errors remain, fix them.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS. Fix any remaining failures.

- [ ] **Step 3: Run full build**

Run: `npm run build:server`
Expected: PASS

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: resolve remaining type errors from subtask removal"
```

---

## Task 8: Frontend Types — Remove Subtask Fields

**Files:**
- Modify: `ui/src/types.ts`

- [ ] **Step 1: Remove parentTaskId, columnPosition, subtaskId**

In `ui/src/types.ts`:

Remove from `Task` interface (line 70):
- `parentTaskId: number | null;` (line 73)
- `columnPosition: number;` (line 79)

Remove from `StageLog` interface (line 33):
- `subtaskId: number | null;` (line 38)

Remove from `StageTransitionEvent` interface (line 48):
- `subtaskId?: number;` (line 51)

- [ ] **Step 2: Rename subtasks to steps in PlanReviewAction**

```typescript
// Line 173
export interface PlanReviewAction {
  action: 'approve' | 'reject';
  reason?: string;
  edits?: {
    planSummary?: string;
    steps?: Array<{ title: string; description: string }>;
  };
}
```

- [ ] **Step 3: Update PlanReviewData**

```typescript
// Line 182
export interface PlanReviewData {
  planSummary: string;
  steps: Array<{ title: string; description: string }>;
  assumptions: string[];
  fileHints: string[];
  riskAssessment?: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/types.ts
git commit -m "refactor: remove subtask fields from frontend types"
```

---

## Task 9: Frontend — Remove @dnd-kit and Delete Old Components

**Files:**
- Delete: `ui/src/components/Board.tsx`
- Delete: `ui/src/components/Column.tsx`
- Delete: `ui/src/components/SubtaskMiniCard.tsx`
- Delete: `ui/src/components/SubtaskStages.tsx`
- Modify: `ui/package.json`

- [ ] **Step 1: Remove @dnd-kit dependencies**

Run: `cd ui && npm uninstall @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`

- [ ] **Step 2: Delete Board.tsx**

```bash
rm ui/src/components/Board.tsx
```

- [ ] **Step 3: Delete Column.tsx**

```bash
rm ui/src/components/Column.tsx
```

- [ ] **Step 4: Delete SubtaskMiniCard.tsx**

```bash
rm ui/src/components/SubtaskMiniCard.tsx
```

- [ ] **Step 5: Delete SubtaskStages.tsx**

```bash
rm ui/src/components/SubtaskStages.tsx
```

- [ ] **Step 6: Delete test files for removed components**

```bash
rm -f ui/src/components/Board.test.tsx ui/src/components/Column.test.tsx ui/src/components/SubtaskMiniCard.test.tsx ui/src/components/SubtaskStages.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: delete kanban board components and @dnd-kit

Remove Board, Column, SubtaskMiniCard, SubtaskStages.
Uninstall @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities."
```

---

## Task 10: Frontend — Create PipelineBar Component

**Files:**
- Create: `ui/src/components/PipelineBar.tsx`
- Test: `ui/src/components/PipelineBar.test.tsx`

- [ ] **Step 1: Write the test**

Create `ui/src/components/PipelineBar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PipelineBar } from './PipelineBar';

describe('PipelineBar', () => {
  it('shows 7 segments', () => {
    const { container } = render(<PipelineBar status="implementing" />);
    const segments = container.querySelectorAll('[data-segment]');
    expect(segments).toHaveLength(7);
  });

  it('marks completed stages green', () => {
    const { container } = render(<PipelineBar status="implementing" />);
    // spec_review, planning are completed (2 stages before implementing)
    const completed = container.querySelectorAll('[data-completed="true"]');
    expect(completed).toHaveLength(2);
  });

  it('marks current stage purple', () => {
    const { container } = render(<PipelineBar status="checks" />);
    const current = container.querySelector('[data-current="true"]');
    expect(current).toBeTruthy();
  });

  it('shows all green when done', () => {
    const { container } = render(<PipelineBar status="done" />);
    const completed = container.querySelectorAll('[data-completed="true"]');
    expect(completed).toHaveLength(7);
  });

  it('shows stage count text', () => {
    render(<PipelineBar status="implementing" />);
    // implementing is at index 2 (0-based), so 2 stages completed
    expect(screen.getByText('2/7')).toBeTruthy();
  });

  it('shows needs_plan_review as planning current with amber', () => {
    const { container } = render(<PipelineBar status="needs_plan_review" />);
    const current = container.querySelector('[data-current="true"]');
    expect(current?.getAttribute('data-stage')).toBe('planning');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/components/PipelineBar.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PipelineBar**

Create `ui/src/components/PipelineBar.tsx`:

```tsx
import React from 'react';
import type { TaskStatus } from '../types';

const STAGES = [
  'spec_review', 'planning', 'implementing', 'checks',
  'code_quality', 'final_review', 'pr_creation',
] as const;

const STAGE_LABELS: Record<string, string> = {
  spec_review: 'Spec', planning: 'Plan', implementing: 'Impl',
  checks: 'Checks', code_quality: 'Quality', final_review: 'Final', pr_creation: 'PR',
};

// Map status to which stage index is "current"
function getStageIndex(status: TaskStatus): number {
  // needs_plan_review maps to planning (index 1)
  if (status === 'needs_plan_review') return 1;
  // needs_human_review and done mean all stages complete
  if (status === 'done' || status === 'needs_human_review') return STAGES.length;
  return STAGES.indexOf(status as typeof STAGES[number]);
}

interface Props {
  status: TaskStatus;
  showLabels?: boolean; // true on detail page, false on card
}

export const PipelineBar: React.FC<Props> = ({ status, showLabels = false }) => {
  const currentIdx = getStageIndex(status);
  const isDone = currentIdx >= STAGES.length;
  const isFailed = status === 'failed';
  const isHumanPause = status === 'needs_plan_review' || status === 'needs_human_review';
  const completedCount = isDone ? STAGES.length : Math.max(0, currentIdx);

  // Don't show for backlog/ready
  if (currentIdx < 0 && !isFailed) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-0.5">
        {STAGES.map((stage, i) => {
          const isCompleted = isDone || i < currentIdx;
          const isCurrent = i === currentIdx && !isDone;
          const isFailedStage = isFailed && i === currentIdx;

          let bgClass = 'bg-bg-elevated'; // future
          if (isCompleted) bgClass = 'bg-accent-green';
          else if (isFailedStage) bgClass = 'bg-accent-red';
          else if (isCurrent && isHumanPause) bgClass = 'bg-accent-amber animate-pulse-dot';
          else if (isCurrent) bgClass = 'bg-accent-purple animate-pulse-dot';

          return (
            <div
              key={stage}
              data-segment
              data-stage={stage}
              data-completed={isCompleted ? 'true' : 'false'}
              data-current={isCurrent ? 'true' : 'false'}
              className={`flex-1 h-1.5 rounded-sm ${bgClass} transition-colors`}
              title={STAGE_LABELS[stage]}
            />
          );
        })}
        <span className="text-[10px] text-text-tertiary ml-1.5 tabular-nums whitespace-nowrap">
          {completedCount}/{STAGES.length}
        </span>
      </div>
      {showLabels && (
        <div className="flex items-center gap-0.5">
          {STAGES.map((stage, i) => {
            const isCurrent = i === currentIdx && !isDone;
            return (
              <span
                key={stage}
                className={`flex-1 text-[9px] text-center truncate ${
                  isCurrent ? 'text-text-primary font-medium' : 'text-text-tertiary'
                }`}
              >
                {STAGE_LABELS[stage]}
              </span>
            );
          })}
          <span className="w-8" /> {/* spacer for count */}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/components/PipelineBar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/PipelineBar.tsx ui/src/components/PipelineBar.test.tsx
git commit -m "feat: add PipelineBar component

7-segment progress bar for pipeline stages. Shows completed (green),
current (purple/amber), and future (gray) segments."
```

---

## Task 11: Frontend — Rewrite TaskCard for Grid

**Files:**
- Modify: `ui/src/components/TaskCard.tsx`
- Test: `ui/src/components/TaskCard.test.tsx`

- [ ] **Step 1: Write the test**

Create or update `ui/src/components/TaskCard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskCard } from './TaskCard';
import type { Task } from '../types';

const baseTask: Task = {
  id: 42,
  projectId: 'p1',
  title: 'Refactor auth middleware',
  description: 'Extract JWT validation into shared module',
  status: 'implementing',
  riskLevel: 'high',
  priority: 1,
  spec: null,
  blockedReason: null,
  blockedAtStage: null,
  claimedAt: null,
  claimedBy: null,
  chatSessionId: null,
  createdAt: '2026-03-19T10:00:00Z',
  updatedAt: '2026-03-19T10:02:00Z',
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe('TaskCard', () => {
  it('renders task ID and title', () => {
    render(<TaskCard task={baseTask} />, { wrapper });
    expect(screen.getByText('#42')).toBeTruthy();
    expect(screen.getByText('Refactor auth middleware')).toBeTruthy();
  });

  it('renders description', () => {
    render(<TaskCard task={baseTask} />, { wrapper });
    expect(screen.getByText('Extract JWT validation into shared module')).toBeTruthy();
  });

  it('shows risk level', () => {
    render(<TaskCard task={baseTask} />, { wrapper });
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('shows priority badge when > 0', () => {
    render(<TaskCard task={baseTask} />, { wrapper });
    expect(screen.getByText('P1')).toBeTruthy();
  });

  it('hides priority badge when 0', () => {
    render(<TaskCard task={{ ...baseTask, priority: 0 }} />, { wrapper });
    expect(screen.queryByText('P0')).toBeNull();
  });

  it('shows status badge', () => {
    render(<TaskCard task={baseTask} />, { wrapper });
    expect(screen.getByText('implementing')).toBeTruthy();
  });

  it('shows running spinner when claimed', () => {
    render(<TaskCard task={{ ...baseTask, claimedBy: 'worker-1' }} />, { wrapper });
    expect(screen.getByLabelText('Running')).toBeTruthy();
  });

  it('renders pipeline bar for pipeline statuses', () => {
    const { container } = render(<TaskCard task={baseTask} />, { wrapper });
    expect(container.querySelector('[data-segment]')).toBeTruthy();
  });

  it('does not render pipeline bar for backlog', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'backlog' }} />,
      { wrapper }
    );
    expect(container.querySelector('[data-segment]')).toBeNull();
  });

  it('has no drag-and-drop attributes', () => {
    const { container } = render(<TaskCard task={baseTask} />, { wrapper });
    // Should not have data-dnd attributes
    expect(container.querySelector('[data-dnd-draggable]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify baseline**

Run: `cd ui && npx vitest run src/components/TaskCard.test.tsx`
Expected: FAIL (old component has different API)

- [ ] **Step 3: Rewrite TaskCard**

Replace `ui/src/components/TaskCard.tsx` entirely:

```tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PipelineBar } from './PipelineBar';
import { timeAgo } from '../lib/time';
import type { Task, TaskStatus } from '../types';

const riskDotColor: Record<string, string> = {
  low: 'bg-accent-green',
  medium: 'bg-accent-amber',
  high: 'bg-accent-red',
};

const statusBadgeColor: Record<string, string> = {
  backlog: 'bg-bg-tertiary text-text-secondary',
  ready: 'bg-bg-tertiary text-text-secondary',
  blocked: 'bg-accent-amber/15 text-accent-amber',
  failed: 'bg-accent-red/15 text-accent-red',
  needs_plan_review: 'bg-accent-amber/15 text-accent-amber',
  needs_human_review: 'bg-accent-pink/15 text-accent-pink',
  done: 'bg-accent-green/15 text-accent-green',
  cancelled: 'bg-bg-tertiary text-text-tertiary',
};

function leftBorderClass(task: Task): string {
  if (task.status === 'blocked' || task.status === 'needs_plan_review') return 'border-l-accent-amber';
  if (task.status === 'failed') return 'border-l-accent-red';
  if (task.status === 'needs_human_review') return 'border-l-accent-pink';
  return 'border-l-transparent';
}

export const TaskCard: React.FC<{ task: Task }> = ({ task }) => {
  const navigate = useNavigate();
  const isRunning = !!task.claimedBy;

  return (
    <div
      onClick={() => navigate(`/tasks/${task.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/tasks/${task.id}`); } }}
      tabIndex={0}
      role="button"
      aria-label={`Task #${task.id}: ${task.title}, ${task.riskLevel} risk, ${task.status.replace(/_/g, ' ')}`}
      className={`bg-bg-secondary rounded-lg p-3 border border-border-default border-l-[3px] ${leftBorderClass(task)} cursor-pointer transition-all duration-150 animate-fade-in hover:bg-bg-tertiary hover:border-border-hover hover:shadow-md ${isRunning ? 'card-running' : ''}`}
    >
      {/* Title row */}
      <div className="flex items-start gap-1.5 mb-1">
        <span className="text-xs text-text-tertiary font-mono shrink-0">#{task.id}</span>
        <span className="text-sm font-medium text-text-primary line-clamp-2">{task.title}</span>
      </div>

      {/* Description */}
      {task.description && (
        <div className="text-[11px] text-text-tertiary line-clamp-1 mb-2">{task.description}</div>
      )}

      {/* Pipeline progress bar */}
      <div className="mb-2">
        <PipelineBar status={task.status} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusBadgeColor[task.status] || 'bg-accent-purple/15 text-accent-purple'}`}>
          {task.status.replace(/_/g, ' ')}
        </span>
        {task.priority > 0 && (
          <span className="bg-bg-tertiary px-1 py-0.5 rounded text-[10px] font-semibold text-text-secondary">
            P{task.priority}
          </span>
        )}
        <span className={`w-2 h-2 rounded-full ${riskDotColor[task.riskLevel] || 'bg-text-tertiary'}`} aria-hidden="true" />
        <span className="text-text-tertiary">{task.riskLevel}</span>
        <span className="text-text-tertiary ml-auto">{timeAgo(task.updatedAt)}</span>
        {isRunning && (
          <span className="flex items-center text-accent-purple" aria-label="Running">
            <svg className="w-3 h-3 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/components/TaskCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/TaskCard.tsx ui/src/components/TaskCard.test.tsx
git commit -m "feat: rewrite TaskCard for grid layout

Read-only card with pipeline progress bar, status badge,
priority, risk, and timestamp. No drag-and-drop or subtasks."
```

---

## Task 12: Frontend — Create TaskGrid Component

**Files:**
- Create: `ui/src/components/TaskGrid.tsx`
- Test: `ui/src/components/TaskGrid.test.tsx`

- [ ] **Step 1: Write the test**

Create `ui/src/components/TaskGrid.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskGrid } from './TaskGrid';
import type { Task } from '../types';

const makeTasks = (overrides: Partial<Task>[]): Task[] =>
  overrides.map((o, i) => ({
    id: i + 1,
    projectId: 'p1',
    title: `Task ${i + 1}`,
    description: '',
    status: 'backlog' as const,
    riskLevel: 'low' as const,
    priority: 0,
    spec: null,
    blockedReason: null,
    blockedAtStage: null,
    claimedAt: null,
    claimedBy: null,
    chatSessionId: null,
    createdAt: '2026-03-19T10:00:00Z',
    updatedAt: '2026-03-19T10:00:00Z',
    ...o,
  }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe('TaskGrid', () => {
  it('groups tasks by status phase', () => {
    const tasks = makeTasks([
      { status: 'blocked' },
      { status: 'implementing' },
      { status: 'backlog' },
      { status: 'done' },
    ]);
    render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    expect(screen.getByText('Needs Attention')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Queued')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('hides empty groups', () => {
    const tasks = makeTasks([{ status: 'backlog' }]);
    render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    expect(screen.queryByText('Needs Attention')).toBeNull();
    expect(screen.queryByText('Running')).toBeNull();
    expect(screen.getByText('Queued')).toBeTruthy();
  });

  it('shows loading skeleton when loading', () => {
    const { container } = render(<TaskGrid tasks={[]} loading={true} />, { wrapper });
    expect(container.querySelector('.skeleton')).toBeTruthy();
  });

  it('shows empty state when no tasks', () => {
    render(<TaskGrid tasks={[]} loading={false} />, { wrapper });
    expect(screen.getByText(/no tasks/i)).toBeTruthy();
  });

  it('sorts by priority descending within group', () => {
    const tasks = makeTasks([
      { title: 'Low', status: 'backlog', priority: 0 },
      { title: 'High', status: 'backlog', priority: 2 },
      { title: 'Med', status: 'backlog', priority: 1 },
    ]);
    const { container } = render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    const cards = container.querySelectorAll('[role="button"]');
    // First card should be "High" (highest priority)
    expect(cards[0]?.textContent).toContain('High');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/components/TaskGrid.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TaskGrid**

Create `ui/src/components/TaskGrid.tsx`:

```tsx
import React, { useState } from 'react';
import { TaskCard } from './TaskCard';
import { EmptyState } from './EmptyState';
import type { Task, TaskStatus } from '../types';

interface StatusGroup {
  key: string;
  label: string;
  statuses: TaskStatus[];
  accentClass?: string;
  defaultCollapsed?: boolean;
}

const GROUPS: StatusGroup[] = [
  {
    key: 'attention',
    label: 'Needs Attention',
    statuses: ['blocked', 'failed', 'needs_plan_review', 'needs_human_review'],
    accentClass: 'text-accent-amber',
  },
  {
    key: 'active',
    label: 'Running',
    statuses: ['spec_review', 'planning', 'implementing', 'checks', 'code_quality', 'final_review', 'pr_creation'],
    accentClass: 'text-accent-purple',
  },
  {
    key: 'queued',
    label: 'Queued',
    statuses: ['backlog', 'ready'],
  },
  {
    key: 'done',
    label: 'Completed',
    statuses: ['done', 'cancelled'],
    defaultCollapsed: true,
  },
];

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    // Priority descending
    if (b.priority !== a.priority) return b.priority - a.priority;
    // Most recently updated first
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

interface Props {
  tasks: Task[];
  loading: boolean;
}

export const TaskGrid: React.FC<Props> = ({ tasks, loading }) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    Object.fromEntries(GROUPS.filter(g => g.defaultCollapsed).map(g => [g.key, true]))
  );

  if (loading) {
    return (
      <div className="p-6 space-y-6 animate-fade-in">
        {[1, 2, 3].map(i => (
          <div key={i}>
            <div className="skeleton h-6 w-40 rounded mb-3" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2].map(j => <div key={j} className="skeleton h-32 rounded-lg" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <EmptyState
          title="No tasks yet"
          description="Create your first task to get started."
        />
      </div>
    );
  }

  const groupedTasks = GROUPS.map(group => ({
    ...group,
    tasks: sortTasks(tasks.filter(t => group.statuses.includes(t.status))),
  })).filter(g => g.tasks.length > 0);

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {groupedTasks.map(group => (
        <section key={group.key} aria-label={group.label}>
          <button
            onClick={() => toggle(group.key)}
            className="flex items-center gap-2 mb-3 group w-full text-left"
          >
            <span className={`text-[10px] transition-transform duration-150 text-text-tertiary ${collapsed[group.key] ? '' : 'rotate-90'}`}>
              ▶
            </span>
            <h2 className={`text-sm font-semibold ${group.accentClass || 'text-text-primary'}`}>
              {group.label}
            </h2>
            <span className="text-xs text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full tabular-nums">
              {group.tasks.length}
            </span>
          </button>

          {!collapsed[group.key] && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {group.tasks.map(task => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/components/TaskGrid.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/TaskGrid.tsx ui/src/components/TaskGrid.test.tsx
git commit -m "feat: add TaskGrid component

Status-grouped responsive card grid with collapsible sections.
Groups: Needs Attention, Running, Queued, Completed."
```

---

## Task 13: Frontend — Update App.tsx Routing

**Files:**
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/hooks/useTasks.ts`

- [ ] **Step 1: Replace Board import with TaskGrid**

In `ui/src/App.tsx`:
- Remove `import { Board }` (line 3 area)
- Add `import { TaskGrid } from './components/TaskGrid'`
- Replace the `<Board ... />` element in the route (lines 164-179) with:

```tsx
<Route
  path="/"
  element={
    <TaskGrid
      tasks={tasks}
      loading={loading}
    />
  }
/>
```

- [ ] **Step 2: Remove moveTask from App.tsx**

Remove `moveTask` from the `useTasks` destructuring and from props passed to the route.

- [ ] **Step 3: Remove moveTask from useTasks hook**

In `ui/src/hooks/useTasks.ts`, remove the `moveTask` function and its export.

- [ ] **Step 4: Remove subtask filtering from useTasks**

If useTasks filters tasks by `parentTaskId === null` for the board view, remove that filter. All tasks are now top-level.

- [ ] **Step 5: Remove `task:moved` socket event handler**

In useTasks or wherever socket events are handled, remove the `task:moved` listener.

- [ ] **Step 6: Update TopBar — remove references to bulk actions**

In `ui/src/components/TopBar.tsx`, remove any bulk action props or UI that was passed from Board. The TopBar should keep: title, taskCount, search, filters, new task button.

- [ ] **Step 7: Update "Back to Board" text references**

Search UI for "Board" text and rename to "Tasks" where appropriate (e.g., the 404 page "Back to Board" link at App.tsx line 198).

- [ ] **Step 8: Run typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add ui/src/App.tsx ui/src/hooks/useTasks.ts ui/src/components/TopBar.tsx
git commit -m "feat: wire TaskGrid into App routing

Replace Board with TaskGrid on / route. Remove moveTask,
subtask filtering, and task:moved socket handler."
```

---

## Task 14: Frontend — Update TaskPage

**Files:**
- Modify: `ui/src/components/TaskPage.tsx`

- [ ] **Step 1: Remove subtask imports and state**

Remove:
- `import { SubtaskMiniCard }` or `import { SubtaskStages }`
- Any `useState` for `subtasks: Task[]`
- Any `useEffect` that fetches subtasks via API

- [ ] **Step 2: Remove subtask grid section**

Delete the JSX section that renders the subtask grid/list.

- [ ] **Step 3: Add PipelineBar with labels**

Import `PipelineBar` and add it to the header area:

```tsx
import { PipelineBar } from './PipelineBar';

// In the header section, after the status badges:
<div className="mt-3">
  <PipelineBar status={task.status} showLabels />
</div>
```

- [ ] **Step 4: Update PlanReviewPanel to use steps instead of subtasks**

If the plan review panel references `subtasks`, rename to `steps`.

- [ ] **Step 5: Run typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/TaskPage.tsx
git commit -m "refactor: simplify TaskPage — remove subtask grid

Add PipelineBar with labels. Remove subtask fetching and display."
```

---

## Task 15: Full Build Verification and Cleanup

**Files:** Various (fix any remaining issues)

- [ ] **Step 1: Run full backend build**

Run: `npm run build:server`
Expected: PASS

- [ ] **Step 2: Run full frontend build**

Run: `npm run build:ui`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Fix any remaining issues**

Address compile errors, broken tests, or missing imports.

- [ ] **Step 5: Run the combined build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`
- Open `http://localhost:3000`
- Verify: grid layout loads with status groups
- Verify: clicking a card navigates to detail page
- Verify: creating a task works
- Verify: filters work
- Verify: no console errors

- [ ] **Step 7: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: final cleanup for task grid redesign"
```

---

## Summary

| Task | Description | Est. Steps |
|------|------------|-----------|
| 1 | Backend types — remove subtask fields | 7 |
| 2 | DB migration — drop subtask columns | 8 |
| 3 | Backend queries — remove subtask functions | 7 |
| 4 | Worker loop — remove subtask orchestration | 12 |
| 5 | Planner — rename subtasks to steps | 5 |
| 6 | Server routes — remove move endpoint | 7 |
| 7 | Backend build verification | 4 |
| 8 | Frontend types — remove subtask fields | 4 |
| 9 | Remove @dnd-kit and delete old components | 7 |
| 10 | Create PipelineBar component | 5 |
| 11 | Rewrite TaskCard for grid | 5 |
| 12 | Create TaskGrid component | 5 |
| 13 | Update App.tsx routing | 9 |
| 14 | Update TaskPage | 6 |
| 15 | Full build verification | 7 |
| **Total** | | **103 steps** |
