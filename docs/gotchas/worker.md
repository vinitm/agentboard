# Worker Gotchas

## Recovery resets tasks claimed >30 minutes ago

**Symptom:** A long-running task mysteriously restarts from `ready` after a server restart.

**Cause:** The recovery mechanism (`recoverStaleTasks()` in `src/worker/recovery.ts`, called at startup from `src/cli/up.ts`) resets any task where `claimed_at` is older than 30 minutes, assuming the worker crashed. This is global — restarting `agentboard up` (from anywhere) triggers recovery for all stale tasks in the database.

**Fix:** If debugging long-running tasks, be aware of this timeout. The executor has a separate 300s (5 min) timeout — the 30-minute recovery is for crashed workers, not slow tasks.

## Executor changes affect all agent runs

**Symptom:** Changing `executor.ts` causes unexpected behavior across multiple pipeline stages.

**Cause:** Four stages (planner, implementer, review-spec, review-code) invoke Claude Code through the same `executeClaudeCode()` function in `executor.ts`. A change to spawn arguments, timeout handling, or output parsing affects all four stages.

**Fix:** Test changes to executor.ts against multiple stages, not just the one you're working on. Note: checks and pr-creator do NOT use `executeClaudeCode()` — they run shell commands directly.

## Stage logs are additive; cleanup may leave orphaned files

**Symptom:** After re-running a failed stage, the log file from the previous attempt is still present at `.agentboard/logs/{taskId}/{stage}.log`.

**Cause:** `StageRunner` writes to `{stage}.log` for attempt 1, then `{stage}-2.log`, `{stage}-3.log`, etc. for retries. Log cleanup runs on worker startup and removes files older than 30 days — it does not clean up task-specific logs when a task is manually re-run.

**Fix:** Log cleanup is automatic on startup. If you need to clean logs for a specific task immediately, manually remove `.agentboard/logs/{taskId}`. Be aware that deleting the directory will delete all stages' logs for that task.

## Stage logs and run logs are separate systems

**Symptom:** A stage completes but the UI shows no log content, or `run:log` events are received but the database has no corresponding `stage_logs` record.

**Cause:** `stage_logs` table tracks metadata (start time, duration, status, summary); the actual log file content is written separately. If `StageRunner.execute()` is called with `onOutput` callback but the callback crashes, the DB record may be created but the file might not have content. Conversely, if the DB write fails but the file write succeeds, logs exist on disk but aren't indexed.

**Fix:** Always use `StageRunner.execute()` with proper error handling. The `onOutput` callback should be a simple append operation. For debugging, check both the `stage_logs` table (via `listStageLogsByTask()`) and the actual files in `.agentboard/logs/`.
