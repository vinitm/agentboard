# Global Repo Registry

**Date:** 2026-03-13
**Status:** Approved

## Problem

The agent doesn't know which repo to work in. When `agentboard up` starts, the UI auto-creates a "Default Project" with `path: '/tmp/agentboard-default'`, so the worker creates worktrees in an empty directory. The agent sees no source files and can't do useful work.

The root cause: `agentboard init` sets up a repo locally but doesn't register it anywhere the server can find. The server has no way to know which repos exist.

## Solution

Introduce a global registry at `~/.agentboard/repos.json`. `agentboard init` registers each repo there. On `agentboard up`, the server reads the registry and auto-creates project records in the database for each registered repo.

## Design

### 1. Global Registry File

**Location:** `~/.agentboard/repos.json`

**Format:**
```json
[
  {
    "path": "/home/user/Personal/football-manager",
    "name": "football-manager",
    "registeredAt": "2026-03-13T10:00:00.000Z"
  }
]
```

**Managed by `agentboard init`:**
- After creating `.agentboard/config.json` in the repo, write/append to `~/.agentboard/repos.json`
- Derive `name` from the directory basename
- If the repo path is already in the registry, skip (idempotent)
- Create `~/.agentboard/` directory if it doesn't exist

### 2. Schema Change — UNIQUE Constraint on `projects.path`

**Changes to `src/db/schema.ts`:**

Add a UNIQUE index on the `path` column to enforce idempotent project creation at the DB level:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
```

This prevents duplicate project records for the same repo path even under concurrent inserts. The `getProjectByPath` query is an application-level check; the UNIQUE constraint is the safety net.

**Migration safety:** If duplicate `path` values already exist in the `projects` table (e.g., from the UI auto-creating default projects), the index creation will fail. Before adding the index, deduplicate: for each set of rows sharing the same `path`, keep the oldest (by `created_at`) and delete the rest. The stale cleanup in Section 3 will also help — it runs before the UNIQUE index is enforced, cleaning up `/tmp/agentboard-default` entries that won't be in the registry.

### 3. Server Startup — Auto-Create Projects from Registry

**Changes to `agentboard up` (src/cli/up.ts):**

On startup, after the DB is opened and before the worker starts:
1. Read `~/.agentboard/repos.json`
2. For each registered repo:
   - Validate it still exists: check that `<path>/.agentboard/config.json` is present
   - Check if a project with that `path` already exists in the DB via `getProjectByPath(db, path)`
   - If not, create a project record with `name` and `path` from the registry, `configPath` derived as `<path>/.agentboard/config.json`
3. Skip invalid/missing repos with a console warning (don't crash)

`agentboard up` continues to run from inside a repo dir (it reads the local `.agentboard/config.json` for server-level config like port/host). The registry adds project awareness on top of this.

**Stale project cleanup:** On startup, after syncing from the registry, query all existing projects from the DB. For any project whose `path` is NOT in the current registry AND whose config file no longer exists on disk, delete the project record. This prevents accumulation of stale projects from repos that were moved or removed. Projects whose path is missing from the registry but whose config file still exists are left untouched (the user may have manually created them).

### 4. Fix the Default Project Fallback

**Changes to `ui/src/App.tsx`:**

Remove the auto-create fallback that creates a project with `path: '/tmp/agentboard-default'`. Instead, when no projects exist, show a message: "No repos registered. Run `agentboard init` in a repo to register it, then restart the server."

### 5. Worker — Use Per-Project Config

**Changes to `src/worker/loop.ts`:**

Currently `createWorkerLoop` takes a single `AgentboardConfig` from the cwd. With multiple repos, each has its own config.

When the worker picks up a task and resolves its project, **at the very top of `processTask()` before any other work** — before the subtask early-return path, before `createWorktree`, before anything:
1. Look up the project via `getProjectById(db, task.projectId)`
2. Read and parse `project.configPath` as the per-project `AgentboardConfig`
3. If the per-project config file can't be read, fail the task immediately with a clear error
4. Use the per-project config for all subsequent operations in that task — including the subtask path (`runImplementationLoop`) and parent task path (`createWorktree`, `runPlanning`, etc.)

This means the per-project config variable replaces the closure-scoped `config` for all calls within `processTask()`: `runImplementationLoop(task, worktreePath, projectConfig, ...)`, `createWorktree(...)`, `makeHookContext(task, stage, worktreePath)` (which currently captures the global `config` — it must accept the per-project config as a parameter instead).

**Config split:**
- Per-project config: `baseBranch`, `branchPrefix`, `modelDefaults`, `commands`, `maxAttemptsPerTask`, `maxReviewCycles`, `maxSubcardDepth`, `prDraft`, `autoMerge`, `securityMode`, `commitPolicy`, `formatPolicy`, `githubRemote`, `prMethod`
- Global config (passed to `createWorkerLoop`): `port`, `host`, `maxConcurrentTasks`, `notifications`

**Memory module fix:** The memory module currently loads from `process.cwd()`:
```typescript
const configDir = path.join(process.cwd(), '.agentboard');
const memory = loadMemory(configDir);
```
This must change to load per-project. Move `loadMemory` into `processTask()`, using `path.dirname(projectConfig.configPath)` (i.e., `<repoPath>/.agentboard`) as the config directory. Each repo gets its own memory.

### 6. Stop Creating Per-Repo Databases in `init`

**Changes to `src/cli/init.ts`:**

Currently `agentboard init` creates a per-repo database at `.agentboard/agentboard.db`. This database is **never used by the server** — `agentboard up` opens its own database (in the cwd's `.agentboard/`). Remove the `createDatabase()` call from `init`. The only database is the one managed by `agentboard up`.

### 7. Edge Cases

1. **Duplicate `init`** — running `agentboard init` twice in the same repo is idempotent. Registry entry matched by path, not duplicated.
2. **Moved/deleted repos** — on startup, if a registered repo's config file is missing, log a warning and skip. Don't create a project record. Don't remove from registry (the repo may reappear).
3. **Registry file missing** — if `~/.agentboard/repos.json` doesn't exist on `agentboard up`, log a warning: "No repos registered. Run `agentboard init` in a repo." Continue startup with whatever projects exist in the DB already.
4. **Multiple servers** — registry is read-only at startup, so concurrent servers reading it is safe. Project creation is idempotent (UNIQUE constraint on `projects.path` prevents duplicates).
5. **Per-project config missing at task time** — if the worker can't read `project.configPath` when processing a task, fail the task with a clear error rather than silently falling back to the global config.
6. **Concurrent `init` writes** — two `agentboard init` commands running simultaneously could race on `repos.json`. Use atomic write (write to temp file, then rename) to prevent corruption. The registry is small and writes are infrequent, so this is sufficient without file locking.
7. **configPath derivation** — `configPath` is always `<path>/.agentboard/config.json`, derived from the repo `path`. This derivation happens in one place: `up.ts` when creating project records. `init.ts` writes the config file but does not store `configPath` in the registry — the registry only stores `path` and `name`.
8. **Malformed registry file** — if `repos.json` exists but contains invalid JSON or entries with missing required fields (`path`, `name`), log a warning with the parse error and skip the registry entirely. Don't crash the server. Continue with whatever projects exist in the DB.
9. **Stale project cleanup cascades** — deleting a project record cascades to tasks, runs, artifacts, git_refs, and events via `ON DELETE CASCADE` in the schema. This data loss is intentional: if the repo is gone and not in the registry, the task history is no longer meaningful. The cleanup only triggers when BOTH conditions are met (not in registry AND config file missing on disk).

## Files to Modify

| File | Change |
|------|--------|
| `src/cli/init.ts` | After local setup, register repo in `~/.agentboard/repos.json`. Remove `createDatabase()` call. |
| `src/cli/up.ts` | On startup, read registry and auto-create project records. Clean up stale projects. |
| `src/db/schema.ts` | Add `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path)` |
| `src/db/queries.ts` | Add `getProjectByPath(db: Database.Database, path: string): Project \| undefined` helper |
| `src/worker/loop.ts` | Load per-project config at top of `processTask()`. Move `loadMemory` into per-task scope. |
| `ui/src/App.tsx` | Remove `/tmp/agentboard-default` fallback, show "no repos" message |

## Non-Goals

- Auto-discovery by filesystem scan (can be added later)
- Decoupling `agentboard up` from running inside a repo (server config still comes from local `.agentboard/config.json`)
- UI for managing the registry (manage via CLI only)
- Removing repos from the registry (manual edit of `repos.json` for now)
