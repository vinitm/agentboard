---
name: Subtask shared worktree pattern
description: Subtasks share parent's worktree and branch — git ref lookups must fall back to parent, subtasks never create PRs
type: learned
---

# Subtask Shared Worktree Pattern

## Rule
Subtasks do not have their own git worktrees or branches. They execute in the parent task's worktree on the parent's branch. Any git ref lookup for a subtask must fall back to the parent's git ref. Subtasks never create PRs — the parent creates a single PR after all subtasks succeed.

## Key constraints
1. `listGitRefsByTask(subtaskId)` returns nothing — fall back to `listGitRefsByTask(parentId)`
2. Skip PR creation stage entirely for subtasks
3. Subtasks commit to the parent's branch (all changes in one PR)
4. When a subtask fails, cancel remaining backlog siblings to unblock parent resolution

## Origin
2026-03-16: `pr-creator.ts` and `loop.ts` tried to look up git refs by subtask ID, which returned nothing. Fixed by falling back to parent's ref and skipping PR creation for subtasks.

## When to apply
- Any code in `src/worker/stages/pr-creator.ts` that resolves git refs
- Any code in `src/worker/loop.ts` that handles subtask lifecycle
- Adding new stages that interact with git (must check `task.parentId`)
