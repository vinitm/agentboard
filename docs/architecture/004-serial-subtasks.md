# ADR-004: Serial Subtask Execution

## Status
Accepted

## Context
When the planner breaks a task into subtasks, those subtasks share a worktree and branch (ADR-003). Running them concurrently would cause merge conflicts and unpredictable interactions.

## Decision
Serial execution with automatic promotion.

- First child task starts as `ready`, rest are `backlog`
- On completion, `checkAndUpdateParentStatus()` promotes the next sibling to `ready` and emits `task:ready` to wake the worker immediately
- On failure, remaining `backlog` siblings are cancelled automatically so the parent can resolve to `failed`
- Subtasks skip PR creation — the parent creates a single PR after all subtasks succeed
- `checkAndUpdateParentStatus` always re-fetches the task from DB (the in-memory task object goes stale)

## Consequences

### Positive
- No merge conflicts between subtasks
- Predictable execution order
- Single PR per feature (all subtask commits on one branch)
- Clean failure semantics — one failure cancels the rest

### Negative
- Total wall-clock time is the sum of all subtask durations (no parallelism)
- A single failing subtask blocks all subsequent siblings

### Risks
- Long subtask chains can monopolize a worktree for extended periods
- The stale task object is a persistent source of bugs — any function checking `task.status` for decisions must re-fetch from DB
