# Serial Subtask Execution

## Problem

When the planner decomposes a task into subtasks, all subtasks are created with `status: 'ready'`. The worker loop picks up all ready tasks concurrently (up to `maxConcurrentTasks`), so subtasks like "validate requirements", "implement feature", and "write tests" run simultaneously — which is nonsensical since later subtasks depend on earlier ones completing.

## Goal

Subtasks run serially in the order the planner returns them. Only one subtask is active at a time. When it completes (or fails), the next one is promoted.

## Design

### Approach: Backlog promotion

Instead of creating all subtasks as `ready`, create them as `backlog` except the first. When a subtask reaches a terminal state, promote the next sibling.

### Changes

**1. `src/worker/loop.ts` — subtask creation (lines 694-714)**

Currently all subtasks are created with `status: 'ready'`:
```typescript
const childTask = createTask(db, {
  ...
  status: 'ready',
});
```

Change to: only the first subtask (`i === 0`) gets `status: 'ready'`. All others get `status: 'backlog'`.

**2. `src/worker/loop.ts` — `checkAndUpdateParentStatus` (lines 64-97)**

Currently this function only checks if all siblings are terminal and updates the parent. Add logic at the top: when a subtask reaches a terminal state, check if the next backlog sibling exists and promote it to `ready`. If the completed subtask failed, do NOT promote — let the failure propagate to the parent (existing behavior handles this).

Promotion logic:
- If subtask succeeded (`done` or `needs_human_review`): promote next backlog sibling to `ready`
- If subtask failed or was cancelled: do NOT promote — fall through to existing "all terminal" check which marks parent as failed

**3. `src/db/queries.ts` — new query**

Add `getNextBacklogSubtask(db, parentTaskId)`: returns the first subtask with `status = 'backlog'` for the given parent, ordered by `created_at ASC, rowid ASC` (rowid tiebreaker ensures deterministic ordering when subtasks share the same millisecond timestamp). Returns `undefined` if none.

```sql
SELECT * FROM tasks
WHERE parent_task_id = ? AND status = 'backlog'
ORDER BY created_at ASC, rowid ASC
LIMIT 1
```

**4. `src/server/index.ts` (or relevant API route) — status change endpoint**

When a human marks a subtask as `done` (e.g., approving from `needs_human_review`), call `checkAndUpdateParentStatus` so the next sibling gets promoted. Currently `checkAndUpdateParentStatus` is only called from the worker loop's `processTask` paths. The API PATCH endpoint that changes task status must also trigger it for subtasks reaching terminal states.

### No schema changes

The existing `status`, `parent_task_id`, and `created_at` columns are sufficient. No new columns or indexes needed.

### Edge cases

1. **Single subtask**: Created as `ready`, runs normally. No siblings to promote.
2. **Subtask fails**: No promotion. Parent eventually marked `failed` by existing logic.
3. **Subtask cancelled**: Same as failure — no promotion.
4. **Subtask blocked (needs human input)**: Not a terminal state, so `checkAndUpdateParentStatus` is not called. The subtask stays blocked until answered, then resumes normally. On eventual completion, next sibling is promoted.
5. **Parent manually cancelled**: `ON DELETE SET NULL` on `parent_task_id` orphans children. Backlog subtasks become orphaned root-level tasks stuck in `backlog` — invisible to the worker but visible on the board. Acceptable for now; a future cleanup sweep can handle orphans.
6. **Recovery on crash**: `recoverStaleTasks` moves claimed tasks back to `ready`. If a crash happens during the promotion window (subtask N completed but subtask N+1 not yet promoted from `backlog`), the chain stalls. Fix: add a startup recovery check — for any parent in `implementing` with no `ready`/in-progress children but remaining `backlog` children, promote the first `backlog` child to `ready`.
7. **Subtask ordering determinism**: Subtasks created in a tight synchronous loop may share the same `created_at` timestamp. The query uses `rowid ASC` as a tiebreaker — SQLite guarantees monotonically increasing rowid, so creation order is preserved.

## Files to modify

| File | Change |
|------|--------|
| `src/db/queries.ts` | Add `getNextBacklogSubtask` query |
| `src/worker/loop.ts` | Import new query; modify subtask creation to use `backlog`; modify `checkAndUpdateParentStatus` to promote next sibling |
| `src/server/index.ts` (or API routes) | Trigger promotion check when API changes a subtask to a terminal status |
| `src/worker/recovery.ts` | Add stalled-chain recovery for backlog subtasks with no active sibling |
