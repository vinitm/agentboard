# Integer Task IDs & Frontend Routing

**Date:** 2026-03-18
**Status:** Approved

## Problem

Task IDs are UUIDs (e.g. `a1b2c3d4-e5f6-...`), making URLs ugly and tasks hard to reference. Clicking a task card on the board opens an inline modal with no URL change, so task views aren't shareable or bookmarkable.

## Decision

Replace UUID task IDs with global auto-incrementing integers. Remove the inline task detail modal — all task views navigate to `/tasks/:id` as a full page.

## Design

### 1. Database Migration

- `tasks.id`: `TEXT PRIMARY KEY` (UUID) → `INTEGER PRIMARY KEY AUTOINCREMENT`
- Update all FK columns referencing tasks:
  - `tasks.parent_task_id`
  - `stage_logs.task_id`
  - `stage_logs.subtask_id` (also stores task IDs)
  - `task_logs.task_id`
  - `chat_messages.task_id`
  - `events.task_id`
  - `runs.task_id`
  - `git_refs.task_id`
- All FK columns change from `TEXT` to `INTEGER`
- IDs are global (one sequence across all projects)
- Migration drops and recreates tables (pre-production, data loss acceptable)
- All other tables (projects, etc.) keep UUIDs — this change is task-specific
- Test helper `createTestDb()` in `src/test/helpers.ts` must be updated to match new schema

### 2. API Changes

- All task API routes use integer params: `/api/tasks/:id` where `:id` is parsed as integer
- **Parsing strategy**: A shared helper `parseTaskId(req.params.id): number` that returns the parsed integer or throws a 400 error for non-numeric values. Used in all route handlers across `tasks.ts`, `chat.ts`, `stage-logs.ts`, and `logs.ts`. Query params (`?taskId=X`) parsed the same way.
- `POST /api/tasks` no longer generates a UUID — uses `lastInsertRowid` from the INSERT result to get the auto-assigned integer ID. Remove `uuidv4()` from task creation.
- All related endpoints (`/chat`, `/stages`, `/move`, `/answer`, `/review-plan`, `/retry`) use integer IDs
- Socket.IO events that reference task IDs emit integers (not strings). Receivers must compare with `===` against number types.
- Frontend `api/client.ts` sends integers in URLs
- Internal helpers like `handleSubtaskTerminal(parentTaskId: string)` and `cleanupTaskWorktree(taskId: string)` change to `number | null` and `number` respectively
- `inFlightTasks` set in `chat.ts` changes from `Set<string>` to `Set<number>`

No new endpoints. Same routes, integer IDs instead of UUIDs.

### 3. UI Routing & Navigation

- Keep `BrowserRouter` — no change to router type
- Remove the inline `TaskDetail` modal from the Board component
- Clicking a `TaskCard` navigates to `/tasks/:id` (full page via existing `TaskPage`)
- **TaskPage must gain all action functionality** currently in the TaskDetail modal: action buttons (Edit, Delete, Retry, Answer, Plan Review) and inline panels (BlockedPanel, PRPanel, PlanReviewPanel). These should be extracted as shared components if not already.
- **Drag-and-drop interaction**: The existing `PointerSensor` with `distance: 5` already distinguishes click from drag. Click navigates, drag moves — no change needed to dnd-kit config. The `as string` casts in `Board.tsx` for `active.id` and `over.id` must change to `as number` (dnd-kit accepts `string | number`). Note: `over.id` may be a column ID (string) or a task ID (number) — handle both cases.
- `TaskPage` parses `:id` as integer
- Task cards display the integer ID visibly (e.g. `#42` prefix on title)
- Back navigation from `TaskPage` returns to board (`/`)
- Subtask clicks navigate to `/tasks/:id` (existing behavior, now with integer)

One way to view a task: full page at `/tasks/:id`. No more modal.

### 4. Type System Changes

- `Task.id`: `string` → `number`
- `Task.parentTaskId`: `string | null` → `number | null`
- `StageLog.subtaskId`: `string | null` → `number | null`
- Frontend type mirrors in `ui/src/types.ts` updated to match
- All function signatures accepting `taskId: string` change to `taskId: number` (across `useTasks` hook callbacks, Board props, Column props, TaskCard props, etc.)
- Row conversion functions updated — integer passthrough, no UUID parsing
- `CreateTaskData` and related interfaces updated to omit `id` (auto-generated)

### 5. Worker & Pipeline Impact

- All worker task ID references become integers
- `execFile` calls that pass task IDs: integers stringified naturally
- Worktree paths, log paths using task ID in directory names: shorter with integers
- Socket.IO event payloads with task IDs become integers
- No change to pipeline logic or stage ordering — purely an ID type change

### 6. Test Updates

- `createTestDb()` in `src/test/helpers.ts` — schema must match new INTEGER PRIMARY KEY
- All test files creating tasks (`tasks.test.ts`, `chat.test.ts`, `stage-logs.test.ts`, `executor.test.ts`, etc.) must use integer IDs
- Test assertions comparing task IDs must expect `number`, not `string`

## Out of Scope

- Changing project IDs (remain UUIDs)
- Changing other table primary keys (runs, artifacts, etc.)
- Any pipeline logic or stage ordering changes
- Data migration of existing tasks (drop and recreate)

## Risks

- **Blast radius**: Touches most files due to ID type change. Mitigated by being a mechanical find-and-replace for most call sites.
- **Data loss**: Existing tasks are dropped. Acceptable for pre-production.
