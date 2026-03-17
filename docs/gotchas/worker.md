# Worker Gotchas

## Recovery resets tasks claimed >30 minutes ago

**Symptom:** A long-running task mysteriously restarts from `ready` after a server restart.

**Cause:** The recovery mechanism (`recoverStaleTasks()` in `src/worker/recovery.ts`, called at startup from `src/cli/up.ts`) resets any task where `claimed_at` is older than 30 minutes, assuming the worker crashed. This is global — restarting `agentboard up` (from anywhere) triggers recovery for all stale tasks in the database.

**Fix:** If debugging long-running tasks, be aware of this timeout. The executor has a separate 300s (5 min) timeout — the 30-minute recovery is for crashed workers, not slow tasks.

## Executor changes affect all agent runs

**Symptom:** Changing `executor.ts` causes unexpected behavior across multiple pipeline stages.

**Cause:** Four stages (planner, implementer, review-spec, review-code) invoke Claude Code through the same `executeClaudeCode()` function in `executor.ts`. A change to spawn arguments, timeout handling, or output parsing affects all four stages.

**Fix:** Test changes to executor.ts against multiple stages, not just the one you're working on. Note: checks and pr-creator do NOT use `executeClaudeCode()` — they run shell commands directly.
