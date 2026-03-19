# Task Grid Redesign

**Date:** 2026-03-19
**Status:** Draft

## Problem

The current kanban board has three compounding issues:

1. **Too many empty columns.** 12+ pipeline stages as columns creates a wide, sparse board. Most columns are empty because the autonomous pipeline moves tasks quickly.
2. **Context switching.** The kanban card is too thin — you must click into `/tasks/:id` to see what's actually happening (stages, logs, plan, PR).
3. **Wrong mental model.** The kanban emphasizes *where* a task is in the pipeline. Users care about *each task as a whole* — its full lifecycle, progress, and artifacts.

## Solution

Replace the kanban board with a **status-grouped card grid**. Remove subtasks as DB entities. Every task is a single row flowing through the pipeline, displayed as a rich card in a responsive grid grouped by status phase.

## Design Decisions

### 1. No Subtask Entities

A task is one row in the database. The planner produces a plan with implementation steps, but those steps are instructions for the implementer — not tracked entities in the DB.

**What this eliminates:**
- `parent_task_id` column and all parent/child relationships
- `column_position` column (no kanban columns to order within)
- Subtask creation in planner stage
- Sibling promotion logic (next subtask -> ready)
- Parent task status rollup
- Subtask-related API endpoints and queries
- `maxSubcardDepth` config option
- `subtaskId` fields on `StageLog` and `StageTransitionEvent` types
- `subtask_id` column on `stage_logs` table
- `idx_tasks_parent_task_id` index
- `PlanningResultMeta.subtaskCount`

#### New Plan Schema

The `PlanningResult` interface changes from subtask-based to step-based:

```typescript
// Before (removed)
interface PlanningResult {
  planSummary: string;
  subtasks: Array<{ title: string; description: string; steps?: string[]; files?: string[] }>;
  assumptions: string[];
  fileMap: string[];
  confidence?: number;
}

// After
interface PlanningResult {
  planSummary: string;
  steps: Array<{
    title: string;
    description: string;
    files?: string[];
  }>;
  assumptions: string[];
  fileMap: string[];      // Keeps existing string[] shape (list of file paths)
  confidence?: number;    // Kept — used by shouldAutoApprovePlan
}
```

Steps are implementation instructions passed to the implementer prompt. They are not tracked entities — no status, no individual completion tracking.

`PlanReviewAction.edits.subtasks` becomes `PlanReviewAction.edits.steps` — humans can still edit step titles/descriptions/ordering during plan review.

Auto-approve heuristic changes from `plan.subtasks.length > 3` to `plan.steps.length > 5` (plans with many steps are riskier and should get human review).

#### Worker Loop: Single-Task Pipeline

The worker loop simplifies from subtask orchestration to a single-task pipeline:

1. **No `processSubtask` pipeline.** The entire `processSubtask` function and its calling code are removed.
2. **Implementer receives the full plan.** The implement stage gets the task's spec + plan (all steps) and executes them in a single Claude invocation. The agent decides how to sequence the steps internally.
3. **Failure = task failure.** If implementation fails, the task goes to `blocked` or `failed`. There are no partial completions or per-step retries. The inline-fix stage (one retry attempt) still applies to the whole task.
4. **No sibling promotion.** The worker loop's `promoteNextSubtask`, `rollupParentStatus`, and recovery of stalled subtask chains are all removed.
5. **Stage progression is linear:** `spec_review` -> `planning` -> `needs_plan_review` -> `implementing` -> `checks` -> `code_quality` -> `final_review` -> `pr_creation` -> `done`.

The recovery module (`src/worker/recovery.ts`) simplifies: remove subtask chain recovery, keep only stale claim recovery for tasks stuck in a stage too long.

#### Chat/Spec Building Flow (Unchanged)

The chat-based spec building flow survives unchanged. "+ New" opens the TaskForm which creates a task in `backlog` with a `chatSessionId`. The brainstorming chat agent builds the spec through conversation. The chat routes (`src/server/routes/chat.ts`), `chat_messages` table, and WebSocket `task:chat` events are all unchanged.

### 2. Status-Grouped Card Grid

The main page (`/`) renders a vertical stack of collapsible sections, each containing a responsive CSS grid of task cards.

#### Status Phase Groups

| Group | Label | Statuses | Default State |
|-------|-------|----------|---------------|
| Attention | "Needs Attention" | `blocked`, `failed`, `needs_plan_review`, `needs_human_review` | Expanded, always first |
| Active | "Running" | `spec_review`, `planning`, `implementing`, `checks`, `code_quality`, `final_review`, `pr_creation` | Expanded |
| Queued | "Queued" | `backlog`, `ready` | Expanded |
| Done | "Completed" | `done`, `cancelled` | Collapsed (count only) |

**Rules:**
- Groups with zero tasks are hidden entirely.
- "Needs Attention" gets an amber/red accent when non-empty.
- Sort within groups: priority descending, then most recently updated first.
- Grid: `grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))`.

### 3. Task Card Design

Each card is a compact, **read-only** status display. Click anywhere navigates to `/tasks/:id`.

```
+------------------------------------------+
| #42  |  Refactor auth middleware         |  <- ID (mono) + Title (max 2 lines)
|                                          |
| Extract JWT validation into shared...    |  <- Description (1 line, muted)
|                                          |
| =======[===---]  5/8 stages             |  <- Pipeline progress bar (segmented)
|                                          |
| * implementing  .  P1  .  high  .  2m   |  <- Status badge, priority, risk, time
+------------------------------------------+
```

**Card elements:**
1. **Title row:** `#id` monospace muted + title (bold, max 2 lines, ellipsis).
2. **Description:** 1 line, `text-tertiary`. Hidden if empty.
3. **Pipeline progress bar:** 7 segments matching the `Stage` type: spec_review, planning, implementing, checks, code_quality, final_review, pr_creation. Green = done, purple + pulse = current, gray = future, red = failed. "N/7 stages" label beside it. Note: `needs_plan_review` is a status pause, not a stage — the planning segment stays "current" (purple) while awaiting human review.
4. **Meta row:** Status as colored pill badge, priority badge (if > 0), risk dot + label, relative timestamp. Running tasks show a spinner.

**Visual accents:**
- Left border (3px): amber for blocked/needs_review, red for failed, transparent otherwise.
- Hover: `bg-bg-elevated` + border shift.
- Cursor pointer (whole card clickable).

**Not on the card:** Action buttons, logs, spec/plan content, cost/tokens, PR link. All on detail page.

### 4. Task Detail Page

`/tasks/:id` is the single deep-dive view. Simplified from current (no subtask grid).

**Layout (top to bottom):**

1. **Header:** Back breadcrumb, `#id`, title, status badge, priority, risk, timing.
2. **Pipeline progress:** Full-width segmented bar with stage labels. Current stage highlighted.
3. **Action panel (contextual):** Only appears when task needs human input:
   - `needs_plan_review`: Approve / Reject buttons
   - `blocked`: Text input to respond to blocker
   - `failed`: Retry button
   - `pr_creation` / `needs_human_review`: PR merge / review actions
   - Otherwise: hidden
4. **Artifacts:** Spec, Plan, PR as sections or tabs. Shown when they exist.
   - Spec: goal, scenarios, criteria
   - Plan: numbered steps (implementation instructions)
   - PR: link, CI status, merge controls
5. **Stage accordion:** One row per pipeline stage. Shows status icon, duration, cost. Expands to show full log output. Currently running stage auto-expanded with streaming logs.
6. **Events timeline:** Chronological log of task state changes.
7. **Cost summary footer:** Total tokens, estimated cost, number of runs.

**Actions on this page:** Approve/reject plan, respond to blocked, retry failed, cancel task, merge/review PR.

### 5. Navigation & Top Bar

**Top bar:**
```
Tasks (23)    [Search... Cmd+K]    [Filters]    [+ New]
```

- Search by title, description, or `#id`.
- Filter by status, risk level, running/idle. Persisted in URL params.
- Keyboard shortcuts: `N` (new task), `Cmd+K` (search), `?` (help).

**Removed from top bar:** View toggle (grid is the only view), bulk action bar.

**Sidebar:** Unchanged — nav links, project selector, connection status.

### 6. Task Status (Unchanged)

```typescript
type TaskStatus =
  | 'backlog' | 'ready'
  | 'spec_review' | 'planning' | 'needs_plan_review'
  | 'implementing' | 'checks' | 'code_quality'
  | 'final_review' | 'pr_creation'
  | 'needs_human_review' | 'done'
  | 'blocked' | 'failed' | 'cancelled';
```

Statuses remain the same. They are a property on the task, not a column placement.

## Removals

### Backend
- `parent_task_id` column from tasks table (and `idx_tasks_parent_task_id` index)
- `column_position` column from tasks table
- `subtask_id` column from `stage_logs` table
- All subtask-related queries in `src/db/queries.ts`
- Subtask creation logic in planner stage
- Sibling promotion logic (`promoteNextSubtask`)
- Parent task status rollup (`rollupParentStatus`)
- Subtask chain recovery in `src/worker/recovery.ts`
- `processSubtask` pipeline in worker loop
- `POST /api/tasks/:id/move` endpoint (see "Action Endpoints" below for replacement)
- `moveToColumn` function from `src/db/queries.ts`
- `maxSubcardDepth` from `AgentboardConfig`
- `PlanningResultMeta` type (remove entirely — `totalFiles` is derivable from `fileMap.length` at render time)
- `subtaskId` field from `StageLog` and `StageTransitionEvent` types
- `PlanningResultMeta.subtaskCount`
- `PlanReviewAction.edits.subtasks` (renamed to `.steps`)
- Parent task guard in `auto-merge.ts` (subtask-based tasks no longer exist, so auto-merge eligibility expands — this is acceptable)

### WebSocket Events
- Remove: `task:moved` (no drag-and-drop)
- Keep: `task:created`, `task:updated`, `task:deleted`, `task:chat`
- No new events needed — `task:updated` covers status changes that move cards between groups

### Frontend Components Deleted
- `Board.tsx` — kanban board (replaced by `TaskGrid.tsx`)
- `Column.tsx` — kanban column
- `SubtaskMiniCard.tsx`
- `SubtaskStages.tsx`
- DnD overlay, sensors, bulk action code

### Frontend Dependencies Removed
- `@dnd-kit/core`

### Frontend Components Modified
- `TaskCard.tsx` — redesigned for grid layout
- `TaskPage.tsx` — remove subtask grid, add artifact sections, cost summary
- `TopBar.tsx` — remove view toggle and bulk actions
- `App.tsx` — route `/` renders `TaskGrid` instead of `Board`

### Worker Stage Modifications
- Planner produces plan blob (steps as instructions), does not create subtask rows
- Implementer works on the whole task, not individual subtasks
- Code quality reviews full task diff, not per-subtask diff
- No sibling promotion after completion

## Action Endpoints

The `POST /api/tasks/:id/move` endpoint currently handles all status transitions (approve, reject, retry, cancel, block response, PR review). Replace it with dedicated action endpoints:

| Endpoint | Purpose | Replaces |
|----------|---------|----------|
| `POST /api/tasks/:id/review-plan` | Approve or reject plan (already exists) | `/move` with `status: implementing` or `planning` |
| `POST /api/tasks/:id/answer` | Respond to blocked task (already exists) | `/move` with `status: ready` + answer |
| `POST /api/tasks/:id/retry` | Retry a failed task (already exists) | `/move` with `status: ready` |
| `POST /api/tasks/:id/cancel` | Cancel a task | `/move` with `status: cancelled` |
| `PUT /api/tasks/:id` | Update task fields (title, description, priority, risk) | General updates |

Most of these endpoints already exist in `src/server/routes/tasks.ts`. The `/move` endpoint is the only one being removed. Any status transitions it handled that don't map to an existing endpoint get a new dedicated route.

## New Components
- `TaskGrid.tsx` — status-grouped responsive card grid with collapsible sections

## Migration

### DB Migration
1. Any task with a non-null `parent_task_id` that is in a non-terminal state (`done`, `failed`, `cancelled`) gets cancelled.
2. Any task with a non-null `parent_task_id` that is in a terminal state gets deleted (its work is already captured in the parent's git branch).
3. Drop `parent_task_id` column (and index) from tasks table.
4. Drop `column_position` column from tasks table.
5. Drop `subtask_id` column from `stage_logs` table.

### Timing
Migration runs on server startup (like existing schema migrations). Safe to run on an empty DB or a DB with no subtasks — the queries are no-ops in that case.

## Keyboard Navigation

- Arrow keys navigate between cards in the grid (focus management).
- `Enter` on a focused card navigates to its detail page.
- `Escape` on detail page returns to grid.
- Tab order follows the visual group order (Attention -> Running -> Queued -> Done).
