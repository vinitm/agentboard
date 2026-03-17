---
name: Subtask stale object pattern
description: Always re-fetch tasks from DB after async operations — in-memory task objects go stale during worker loop execution
type: learned
---

# Subtask Stale Object Pattern

## Rule
Never trust in-memory task state after any async operation (stage execution, DB update, git operation). Always re-fetch from DB before making decisions based on task status.

## Example
```typescript
// WRONG: task.status is stale from claim time
await runStage(task);
if (task.status === 'done') { ... } // still 'ready' in memory

// CORRECT: re-fetch after async work
await runStage(task);
const fresh = getTaskById(task.id);
if (fresh.status === 'done') { ... }
```

## Origin
2026-03-16: `checkAndUpdateParentStatus(task)` used stale `task.status` (still `ready` from claim time). The success check always failed, breaking sibling promotion.

## When to apply
- Any code in `src/worker/loop.ts` that reads task status after calling a stage
- Any code that passes a task object through multiple async operations
- Parent/child status resolution logic
