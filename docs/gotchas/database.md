# Database Gotchas

## Global database at ~/.agentboard/agentboard.db

**Symptom:** Confusion about where the database is stored when working with multiple projects.

**Cause:** All projects share a single SQLite database at `~/.agentboard/agentboard.db` (not per-project). The `projects` table indexes which repo each task belongs to.

**Note:** Per-project state (config, logs, worktrees, memory) stays in each repo's `.agentboard/` directory. Only the database is global.

## Singleton connection — don't create new ones

**Symptom:** Database locked errors or data not visible between components.

**Cause:** The DB uses a singleton pattern via `getDatabase()`. Creating a second connection to the same SQLite file can cause WAL contention or see stale data.

**Fix:** Always use `getDatabase()` — never construct a new `Database()` instance.

## Snake_case in DB, camelCase in TypeScript

**Symptom:** Property undefined when accessing a DB row directly.

**Cause:** SQLite columns use `snake_case` (`parent_task_id`), but TypeScript interfaces use `camelCase` (`parentTaskId`). Raw query results have snake_case keys.

**Fix:** Always use row-conversion functions (`rowToTask`, `rowToProject`, etc.) from `queries.ts`. Never access raw row properties directly.
