# Subtask Gotchas

## Subtasks have NO git_refs — use parent's

**Symptom:** `git_refs` lookup returns null for a subtask.

**Cause:** Only parent tasks create worktrees and git_refs entries. Subtasks share the parent's worktree. Code that needs a worktree path or branch for a subtask must fall back to `task.parentTaskId`.

**Fix:** Always check `task.parentTaskId` when looking up git_refs: `getGitRefs(task.parentTaskId ?? task.id)`.

## Task object goes stale after claim

**Symptom:** `checkAndUpdateParentStatus` makes wrong decisions based on outdated status.

**Cause:** The `task` object is fetched once at claim time and passed through `processTask → runImplementationLoop → runReviewAndPR`. Its `.status` reflects claim-time state, not current state.

**Fix:** Any function making decisions based on `task.status` must re-fetch from DB: `const fresh = getTask(task.id)`.

## commitChanges() returns empty string when nothing to commit

**Symptom:** Review retry fails or produces confusing logs.

**Cause:** After a review cycle requests changes, the implementer may have already committed the fix in the previous cycle. `commitChanges()` returns `''` (empty string) when there are no staged changes.

**Fix:** Callers must handle the empty-string return gracefully — it's a normal condition, not an error.

## Failed subtask must cancel backlog siblings

**Symptom:** Parent task stuck in `implementing` forever.

**Cause:** `checkAndUpdateParentStatus` only resolves the parent when all children are in terminal states (`done`, `failed`, `cancelled`). `backlog` is non-terminal. If a subtask fails without cancelling its backlog siblings, the parent can never resolve.

**Fix:** On subtask failure, cancel all remaining `backlog` siblings before calling `checkAndUpdateParentStatus`.

## checkAndUpdateParentStatus is async — always await it

**Symptom:** Parent status not updated, PR not created, race conditions.

**Cause:** `checkAndUpdateParentStatus` triggers PR creation for the parent when all subtasks succeed. It's async because PR creation involves git push and `gh pr create`.

**Fix:** Every call site must `await checkAndUpdateParentStatus(...)`.
