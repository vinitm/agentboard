# ADR-003: Git Worktree Isolation

## Status
Accepted

## Context
Multiple tasks may run concurrently. Each needs a clean working directory on its own branch without affecting the main checkout or other tasks.

## Decision
Each top-level task gets a dedicated `git worktree` at `.agentboard/worktrees/<taskId>/` on a new branch (`<branchPrefix><taskId>-<slug>`). Managed in `src/worker/git.ts`.

- The main repo checkout is never modified by task execution
- Subtasks share their parent's worktree and branch (they accumulate commits on the same branch)
- The `git_refs` table tracks worktree path, branch, and status (`local` → `pushed` → `pr_open`)
- Cleanup via `git worktree remove --force` + `git branch -D` (best-effort on failure)

For the full worktree lifecycle and directory layout, see [Agent Orchestration → Git Worktree Isolation](agent-orchestration.md#git-worktree-isolation).

## Consequences

### Positive
- True isolation — multiple tasks run concurrently without interfering
- No stashing/switching on the main checkout
- Each task gets a clean branch from the configured base

### Negative
- Disk usage scales with concurrent tasks (each worktree is a near-full checkout)
- Subtask worktree sharing means concurrent subtasks on the same parent would conflict

### Risks
- Concurrent subtask conflict is mitigated by serial execution (see [ADR-004](004-serial-subtasks.md))
- Worktree cleanup on task failure is best-effort — orphaned worktrees can accumulate
- Subtasks have no `git_refs` of their own — code must fall back to parent's refs via `task.parentTaskId`

See also: [Subtask Gotchas](../gotchas/subtasks.md)
