# Global Repo Registry Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register repos globally via `agentboard init` so the server auto-creates projects and the worker uses per-project config.

**Architecture:** `agentboard init` writes to `~/.agentboard/repos.json`. On `agentboard up`, the server reads the registry, syncs projects to the DB, and cleans stale entries. The worker loads per-project config at the top of `processTask()` before any work.

**Tech Stack:** Node.js, TypeScript, SQLite (better-sqlite3), Express, React

**Spec:** `docs/superpowers/specs/2026-03-13-global-repo-registry-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/cli/init.ts` | Modified: register repo in `~/.agentboard/repos.json`, remove `createDatabase()` call |
| `src/cli/up.ts` | Modified: read registry, sync projects to DB, clean stale projects |
| `src/db/schema.ts` | Modified: add UNIQUE index on `projects.path`, deduplicate migration |
| `src/db/queries.ts` | Modified: add `getProjectByPath()` helper |
| `src/worker/loop.ts` | Modified: load per-project config + memory at top of `processTask()`, pass to all callsites |
| `ui/src/App.tsx` | Modified: remove auto-create default project, show "no repos" message |

---

## Chunk 1: Database & Query Layer

### Task 1: Add UNIQUE index on `projects.path` and deduplication migration

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add deduplication migration and UNIQUE index to schema DDL**

In `src/db/schema.ts`, append the following **after** the existing DDL string (before the closing backtick), inside the `DDL` template literal:

```sql
-- Deduplicate projects by path (keep oldest)
DELETE FROM projects WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY path ORDER BY created_at ASC) AS rn
    FROM projects
  ) WHERE rn = 1
);

-- Enforce unique repo paths
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
```

The `DELETE` is safe on first run (no duplicates = no rows deleted) and idempotent on subsequent runs (unique index already exists, no duplicates to delete).

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/user/Personal/agentboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(db): add UNIQUE index on projects.path with dedup migration"
```

---

### Task 2: Add `getProjectByPath` query helper

**Files:**
- Modify: `src/db/queries.ts`

- [ ] **Step 1: Add `getProjectByPath` function**

Add this function after `listProjects` (after line 127 in `src/db/queries.ts`):

```typescript
export function getProjectByPath(
  db: Database.Database,
  path: string
): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToProject(row) : undefined;
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/user/Personal/agentboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat(db): add getProjectByPath query helper"
```

---

## Chunk 2: CLI Changes (init + up)

### Task 3: Update `agentboard init` — register repo globally, remove database creation

**Files:**
- Modify: `src/cli/init.ts`

- [ ] **Step 1: Add global registry write and remove `createDatabase` call**

Replace the entire contents of `src/cli/init.ts` with:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import { detectLanguages } from '../detect/language.js';
import { detectCommands } from '../detect/commands.js';
import type { AgentboardConfig } from '../types/index.js';

interface RegistryEntry {
  path: string;
  name: string;
  registeredAt: string;
}

export default async function init(): Promise<void> {
  const cwd = process.cwd();

  // 1. Verify git repo
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    console.error(
      chalk.red('Error: current directory is not a git repository.')
    );
    process.exit(1);
  }

  const abDir = path.join(cwd, '.agentboard');

  // 2. Create .agentboard/ directory
  if (!fs.existsSync(abDir)) {
    fs.mkdirSync(abDir, { recursive: true });
  }

  // 3. Detect languages
  const languages = detectLanguages(cwd);
  console.log(
    chalk.blue('Detected languages:'),
    languages.length > 0 ? languages.join(', ') : 'none'
  );

  // 4. Detect commands
  const commands = detectCommands(cwd, languages);

  // 5. Build default config
  const config: AgentboardConfig = {
    port: 4200,
    host: '0.0.0.0',
    maxConcurrentTasks: 2,
    maxAttemptsPerTask: 10,
    maxReviewCycles: 3,
    maxSubcardDepth: 2,
    prDraft: true,
    autoMerge: false,
    securityMode: 'lightweight',
    commitPolicy: 'after-checks-pass',
    formatPolicy: 'auto-fix-separate-commit',
    branchPrefix: 'agent/',
    baseBranch: 'main',
    githubRemote: 'origin',
    prMethod: 'gh-cli',
    modelDefaults: {
      planning: 'sonnet',
      implementation: 'opus',
      reviewSpec: 'sonnet',
      reviewCode: 'sonnet',
      security: 'haiku',
    },
    commands,
    notifications: {
      desktop: true,
      terminal: true,
    },
    ruflo: {
      enabled: false,
    },
  };

  // 6. Write config
  const configPath = path.join(abDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(chalk.green('Wrote'), configPath);

  // 7. Ensure .agentboard/ is in .gitignore
  const gitignorePath = path.join(cwd, '.gitignore');
  const gitignoreEntry = '.agentboard/';
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.split('\n').some((line) => line.trim() === gitignoreEntry)) {
      fs.appendFileSync(gitignorePath, `\n${gitignoreEntry}\n`);
      console.log(chalk.green('Added'), gitignoreEntry, 'to .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, `${gitignoreEntry}\n`);
    console.log(chalk.green('Created .gitignore with'), gitignoreEntry);
  }

  // 8. Register repo in global registry (~/.agentboard/repos.json)
  registerRepo(cwd);

  // 9. Done
  console.log(
    chalk.green.bold('\nAgentboard initialized successfully!')
  );
}

/**
 * Register the repo at `repoPath` in ~/.agentboard/repos.json.
 * Idempotent — skips if already registered. Uses atomic write to prevent corruption.
 */
function registerRepo(repoPath: string): void {
  const globalDir = path.join(os.homedir(), '.agentboard');
  const registryPath = path.join(globalDir, 'repos.json');

  // Ensure ~/.agentboard/ exists
  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
  }

  // Read existing registry
  let registry: RegistryEntry[] = [];
  if (fs.existsSync(registryPath)) {
    try {
      registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as RegistryEntry[];
      if (!Array.isArray(registry)) {
        registry = [];
      }
    } catch {
      // Malformed file — start fresh
      registry = [];
    }
  }

  // Check if already registered (by path)
  if (registry.some((entry) => entry.path === repoPath)) {
    console.log(chalk.blue('Repo already registered in global registry'));
    return;
  }

  // Add entry
  const entry: RegistryEntry = {
    path: repoPath,
    name: path.basename(repoPath),
    registeredAt: new Date().toISOString(),
  };
  registry.push(entry);

  // Atomic write: write to temp file, then rename
  const tmpPath = registryPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2) + '\n');
  fs.renameSync(tmpPath, registryPath);

  console.log(chalk.green('Registered repo in'), registryPath);
}
```

Key changes from original:
- Removed `import { createDatabase }` and the `createDatabase()` call (step 7 in original)
- Added `import os from 'node:os'`
- Added `RegistryEntry` interface and `registerRepo()` function
- Step 8 calls `registerRepo(cwd)` before the success message

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/user/Personal/agentboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Manual test**

```bash
cd /tmp && mkdir test-repo && cd test-repo && git init
npx tsx /home/user/Personal/agentboard/bin/agentboard.ts init
cat ~/.agentboard/repos.json
# Should see entry with path /tmp/test-repo
# Should NOT see agentboard.db in /tmp/test-repo/.agentboard/
ls /tmp/test-repo/.agentboard/
# Should contain: config.json (no agentboard.db)
```

- [ ] **Step 4: Verify idempotent re-run**

```bash
cd /tmp/test-repo
npx tsx /home/user/Personal/agentboard/bin/agentboard.ts init
cat ~/.agentboard/repos.json
# Should still have only 1 entry for /tmp/test-repo
```

- [ ] **Step 5: Clean up test and commit**

```bash
rm -rf /tmp/test-repo
git add src/cli/init.ts
git commit -m "feat(init): register repo in global registry, remove per-repo database"
```

---

### Task 4: Update `agentboard up` — sync registry to DB, clean stale projects

**Files:**
- Modify: `src/cli/up.ts`

- [ ] **Step 1: Add registry sync and stale cleanup**

Replace the entire contents of `src/cli/up.ts` with:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import { createDatabase } from '../db/index.js';
import { createServer } from '../server/index.js';
import { createWorkerLoop } from '../worker/loop.js';
import { recoverStaleTasks } from '../worker/recovery.js';
import { getProjectByPath, createProject, listProjects, deleteProject } from '../db/queries.js';
import type { AgentboardConfig } from '../types/index.js';
import type Database from 'better-sqlite3';

interface RegistryEntry {
  path: string;
  name: string;
  registeredAt: string;
}

export default async function up(opts: {
  port?: string;
}): Promise<void> {
  const cwd = process.cwd();
  const abDir = path.join(cwd, '.agentboard');

  // Clean up stale shutdown file from a previous crash
  const staleShutdown = path.join(abDir, 'shutdown');
  if (fs.existsSync(staleShutdown)) {
    fs.unlinkSync(staleShutdown);
  }

  const configPath = path.join(abDir, 'config.json');

  if (!fs.existsSync(configPath)) {
    console.error(
      chalk.red(
        'Error: .agentboard/config.json not found. Run `agentboard init` first.'
      )
    );
    process.exit(1);
  }

  // 1. Load config
  const config: AgentboardConfig = JSON.parse(
    fs.readFileSync(configPath, 'utf-8')
  ) as AgentboardConfig;

  // Override port from CLI flag
  if (opts.port) {
    config.port = parseInt(opts.port, 10);
  }

  // 2. Open database
  const dbPath = path.join(cwd, '.agentboard', 'agentboard.db');
  const db = createDatabase(dbPath);

  // 3. Sync projects from global registry
  syncProjectsFromRegistry(db);

  // 4. Start server
  const { server, io } = createServer(db, config, { configPath });

  // Wait for server to actually start listening (or fail)
  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          chalk.red(`Error: Port ${config.port} is already in use.`),
          chalk.yellow(`\nRun \`agentboard down\` or \`lsof -ti :${config.port} | xargs kill\` to free it.`)
        );
      } else {
        console.error(chalk.red(`Server error: ${err.message}`));
      }
      db.close();
      reject(err);
    });
    server.listen(config.port, config.host, () => resolve());
  });

  console.log(
    chalk.green.bold(
      `Agentboard running at http://${config.host}:${config.port}`
    )
  );

  // 5. Crash recovery: recover stale tasks
  const recovered = recoverStaleTasks(db);
  if (recovered > 0) {
    console.log(chalk.yellow(`Recovered ${recovered} stale task(s) from previous crash`));
  }

  // 6. Start worker loop
  const worker = createWorkerLoop(db, config, io);
  worker.start();

  // 7. Watch for shutdown file
  const shutdownPath = path.join(cwd, '.agentboard', 'shutdown');
  const shutdownInterval = setInterval(() => {
    if (fs.existsSync(shutdownPath)) {
      fs.unlinkSync(shutdownPath);
      console.log(chalk.yellow('\nShutdown signal received.'));
      worker.stop().then(() => {
        server.close();
        db.close();
        clearInterval(shutdownInterval);
        process.exit(0);
      });
    }
  }, 1000);

  // Signal handlers for graceful shutdown
  const gracefulShutdown = (signal: string): void => {
    console.log(chalk.yellow(`\n${signal} received. Shutting down…`));
    worker.stop().then(() => {
      server.close();
      db.close();
      clearInterval(shutdownInterval);
      process.exit(0);
    });
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

/**
 * Read ~/.agentboard/repos.json and sync registered repos into the projects table.
 * Also cleans up stale projects not in the registry and missing from disk.
 */
function syncProjectsFromRegistry(db: Database.Database): void {
  const registryPath = path.join(os.homedir(), '.agentboard', 'repos.json');

  if (!fs.existsSync(registryPath)) {
    console.log(
      chalk.yellow('No repos registered. Run `agentboard init` in a repo to register it.')
    );
    return;
  }

  // Parse registry
  let registry: RegistryEntry[];
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    if (!Array.isArray(raw)) {
      console.warn(chalk.yellow('Warning: repos.json is not an array, skipping registry sync'));
      return;
    }
    registry = raw as RegistryEntry[];
  } catch (err) {
    console.warn(
      chalk.yellow(`Warning: Failed to parse repos.json: ${err instanceof Error ? err.message : err}`)
    );
    return;
  }

  const registryPaths = new Set<string>();

  // Create project records for registered repos
  for (const entry of registry) {
    if (!entry.path || !entry.name) {
      console.warn(chalk.yellow(`Warning: Skipping registry entry with missing path or name`));
      continue;
    }

    registryPaths.add(entry.path);

    const repoConfigPath = path.join(entry.path, '.agentboard', 'config.json');
    if (!fs.existsSync(repoConfigPath)) {
      console.warn(
        chalk.yellow(`Warning: Registered repo ${entry.name} missing config at ${repoConfigPath}, skipping`)
      );
      continue;
    }

    // Check if project already exists in DB
    const existing = getProjectByPath(db, entry.path);
    if (existing) continue;

    // Create project record
    createProject(db, {
      name: entry.name,
      path: entry.path,
      configPath: repoConfigPath,
    });
    console.log(chalk.green(`Registered project: ${entry.name} (${entry.path})`));
  }

  // Clean up stale projects: not in registry AND config missing from disk
  const allProjects = listProjects(db);
  for (const project of allProjects) {
    if (registryPaths.has(project.path)) continue; // In registry — keep

    const configExists = fs.existsSync(
      path.join(project.path, '.agentboard', 'config.json')
    );
    if (configExists) continue; // Config still on disk — keep (manually created)

    // Both conditions met: not in registry AND config gone — delete
    console.log(
      chalk.yellow(`Removing stale project: ${project.name} (${project.path})`)
    );
    deleteProject(db, project.id);
  }
}
```

Key changes from original:
- Added `import os from 'node:os'`
- Added imports from `../db/queries.js`: `getProjectByPath`, `createProject`, `listProjects`, `deleteProject`
- Added `import type Database from 'better-sqlite3'`
- Added `RegistryEntry` interface and `syncProjectsFromRegistry()` function
- Inserted `syncProjectsFromRegistry(db)` call as step 3, between DB open and server start
- All other logic (server start, recovery, worker, shutdown) unchanged

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/user/Personal/agentboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/cli/up.ts
git commit -m "feat(up): sync projects from global registry on startup, clean stale projects"
```

---

## Chunk 3: Worker Per-Project Config & Memory

### Task 5: Load per-project config and memory in `processTask()`

**Files:**
- Modify: `src/worker/loop.ts`
- Import type: `WorkerMemory` from `./memory.js`

This is the most complex change. The worker currently uses:
- A single `config` from the `createWorkerLoop` closure scope
- `memory` and `configDir` as module-level variables (lines 61-62)

We need to load per-project config and memory at the top of `processTask()` and thread them through all callsites. **All sub-steps below must be applied together before compiling** — they are interdependent.

**Important: closure `config` references that should stay as-is (global config):**
- `tick()` line 145: `config.maxConcurrentTasks` — global config, intentionally uses closure
- `loadRufloHooks(hooks, config)` line 58 — hook init happens once at worker creation, uses global config

- [ ] **Step 1: Apply all changes to `src/worker/loop.ts`**

**1a.** Add `fs` import at the top (after `import path from 'node:path'`):

```typescript
import fs from 'node:fs';
```

**1b.** Add `getProjectById` to the imports from `../db/queries.js`. Add `import type { WorkerMemory } from './memory.js'` to the imports. The queries import block becomes:

```typescript
import {
  listTasksByStatus,
  claimTask,
  updateTask,
  unclaimTask,
  createEvent,
  createTask,
  createGitRef,
  getTaskById,
  getProjectById,
  listProjects,
  listGitRefsByTask,
  getSubtasksByParentId,
} from '../db/queries.js';
```

And add this import (the functions are already imported, add the type):

```typescript
import type { WorkerMemory } from './memory.js';
```

**1c.** Delete the module-level memory initialization (lines 61-62):

```typescript
  const configDir = path.join(process.cwd(), '.agentboard');
  const memory = loadMemory(configDir);
```

These are replaced by per-project loading in `processTask()`.

**1d.** Update `makeHookContext` (line 103-105) to accept a config parameter:

From:
```typescript
  function makeHookContext(task: Task, stage: Stage, worktreePath: string): HookContext {
    return { task, stage, worktreePath, config };
  }
```
To:
```typescript
  function makeHookContext(task: Task, stage: Stage, worktreePath: string, taskConfig: AgentboardConfig): HookContext {
    return { task, stage, worktreePath, config: taskConfig };
  }
```

**1e.** Update `runImplementationLoop` signature (line 187-193) to accept `memory` and `configDir`:

From:
```typescript
  async function runImplementationLoop(
    task: Task,
    worktreePath: string,
    config: AgentboardConfig,
    io: Server,
    db: Database.Database
  ): Promise<void> {
```
To:
```typescript
  async function runImplementationLoop(
    task: Task,
    worktreePath: string,
    config: AgentboardConfig,
    io: Server,
    db: Database.Database,
    memory: WorkerMemory,
    configDir: string
  ): Promise<void> {
```

**1f.** Update ALL `makeHookContext` calls inside `runImplementationLoop` to pass `config` as 4th arg. There are 5 calls at approximately these lines:
- Line 205: `makeHookContext(task, 'implementing', worktreePath)` → `makeHookContext(task, 'implementing', worktreePath, config)`
- Line 214: `makeHookContext(task, 'implementing', worktreePath)` → `makeHookContext(task, 'implementing', worktreePath, config)`
- Line 264: `makeHookContext(task, 'checks', worktreePath)` → `makeHookContext(task, 'checks', worktreePath, config)`
- Line 266: `makeHookContext(task, 'checks', worktreePath)` → `makeHookContext(task, 'checks', worktreePath, config)`
- Line 331: `makeHookContext(task, 'implementing', worktreePath)` → `makeHookContext(task, 'implementing', worktreePath, config)` (if present in the error/max-attempts path)

The `memory` and `configDir` references inside `runImplementationLoop` (lines 283-285: `recordFailure(memory, ...)` and `saveMemory(configDir, memory)`) now use the function parameters instead of closure variables — this works because we changed the signature.

**1g.** Update the `runReviewAndPR` call inside `runImplementationLoop` (line 276) to forward `memory` and `configDir`:

From:
```typescript
        await runReviewAndPR(task, worktreePath, config, io, db);
```
To:
```typescript
        await runReviewAndPR(task, worktreePath, config, io, db, memory, configDir);
```

**1h.** Update `runReviewAndPR` signature (line 339-345) to accept `memory` and `configDir`:

From:
```typescript
  async function runReviewAndPR(
    task: Task,
    worktreePath: string,
    config: AgentboardConfig,
    io: Server,
    db: Database.Database
  ): Promise<void> {
```
To:
```typescript
  async function runReviewAndPR(
    task: Task,
    worktreePath: string,
    config: AgentboardConfig,
    io: Server,
    db: Database.Database,
    memory: WorkerMemory,
    configDir: string
  ): Promise<void> {
```

**1i.** Update ALL `makeHookContext` calls inside `runReviewAndPR` to pass `config` as 4th arg. There are 7 calls:
- Line 362: `makeHookContext(task, 'review_spec', worktreePath)` → add `, config`
- Line 364: `makeHookContext(task, 'review_spec', worktreePath)` → add `, config`
- Line 431: `makeHookContext(task, 'review_code', worktreePath)` → add `, config`
- Line 433: `makeHookContext(task, 'review_code', worktreePath)` → add `, config`
- Line 516: `makeHookContext(task, 'pr_creation', worktreePath)` → add `, config`
- Line 518: `makeHookContext(task, 'pr_creation', worktreePath)` → add `, config`
- Line 566: `makeHookContext(task, 'pr_creation', worktreePath)` → add `, config`

The `memory` and `configDir` references inside `runReviewAndPR` (lines 532-533: `recordConvention(memory, ...)` and `saveMemory(configDir, memory)`) now use the function parameters — this works because we changed the signature.

**1j.** Now update `processTask()`. Add per-project config and memory loading **before the subtask early-return check**. The new `processTask()` structure is:

```typescript
  async function processTask(task: Task): Promise<void> {
    let worktreePath: string | undefined;
    let isSubtask = false;
    let repoPath: string | undefined;

    try {
      // Find the project to get the repo path
      const project = getProjectById(db, task.projectId);
      if (!project) {
        throw new Error(`Project not found for task ${task.id}`);
      }
      repoPath = project.path;

      // Load per-project config (MUST happen before subtask check or createWorktree)
      const projectConfigDir = path.join(project.path, '.agentboard');
      let projectConfig: AgentboardConfig;
      try {
        const raw = fs.readFileSync(path.join(projectConfigDir, 'config.json'), 'utf-8');
        projectConfig = JSON.parse(raw) as AgentboardConfig;
      } catch (err) {
        throw new Error(
          `Failed to read per-project config at ${projectConfigDir}/config.json: ${err instanceof Error ? err.message : err}`
        );
      }

      // Load per-project memory
      const memory = loadMemory(projectConfigDir);
```

Note: replaced `listProjects(db) + .find()` with `getProjectById(db, task.projectId)`.

Then the subtask early-return path (previously line 587-597) becomes:

```typescript
      // Check if this is a subtask that should reuse parent's worktree
      if (task.parentTaskId) {
        isSubtask = true;
        const parentGitRefs = listGitRefsByTask(db, task.parentTaskId);
        if (parentGitRefs.length > 0 && parentGitRefs[0].worktreePath) {
          worktreePath = parentGitRefs[0].worktreePath;

          // Skip planning for subtasks — go directly to implementation loop
          await runImplementationLoop(task, worktreePath, projectConfig, io, db, memory, projectConfigDir);
          return;
        }
      }
```

Then `createWorktree` (previously lines 607-613):

```typescript
      const { worktreePath: wtPath, branch } = await createWorktree(
        project.path,
        task.id,
        slug,
        projectConfig.baseBranch,
        projectConfig.branchPrefix
      );
```

Then all subsequent calls in `processTask()` use `projectConfig` instead of `config`:
- `makeHookContext(task, 'planning', worktreePath, projectConfig)` (2 calls)
- `runPlanning(db, task, worktreePath, projectConfig, ...)` (1 call)
- `notify('Task Blocked', ..., projectConfig)` (1 call)
- `runImplementationLoop(task, worktreePath, projectConfig, io, db, memory, projectConfigDir)` (1 call at line 721)

**1k.** The `catch` block and error handling in `processTask()` stay unchanged — they don't reference `config`, `memory`, or `configDir`.

- [ ] **Step 2: Verify the build compiles**

Run: `cd /home/user/Personal/agentboard && npx tsc --noEmit`
Expected: No errors. If there are type errors, they'll likely be from missed `makeHookContext` callsites — add the `config` parameter to any remaining calls.

- [ ] **Step 3: Verify no stale closure references remain**

Search for `makeHookContext` calls that are missing the 4th argument:

```bash
grep -n 'makeHookContext(task,' src/worker/loop.ts | grep -v 'config)'
```

Expected: No matches (all calls should end with `, config)` or `, projectConfig)`).

Search for bare `memory` or `configDir` references outside function parameters:

```bash
grep -n 'configDir\|memory' src/worker/loop.ts
```

Expected: All `memory`/`configDir` references should be either in function signatures, in the `processTask()` local variables, or as parameter usage inside `runImplementationLoop`/`runReviewAndPR`.

- [ ] **Step 4: Commit**

```bash
git add src/worker/loop.ts
git commit -m "feat(worker): load per-project config and memory in processTask"
```

---

## Chunk 4: UI Changes

### Task 6: Remove default project auto-creation, show "no repos" message

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Replace the auto-create fallback with a "no repos" message**

In `ui/src/App.tsx`, replace the `useEffect` block (lines 20-40):

```typescript
  // Load or create default project
  useEffect(() => {
    (async () => {
      try {
        const list = await api.get<Project[]>('/api/projects');
        setProjects(list);
        if (list.length > 0) {
          setProjectId(list[0].id);
        } else {
          // Auto-create a default project
          const p = await api.post<Project>('/api/projects', {
            name: 'Default Project',
            path: '/tmp/agentboard-default',
          });
          setProjects([p]);
          setProjectId(p.id);
        }
      } catch (err) {
        setInitError(err instanceof Error ? err.message : 'Failed to load projects');
      }
    })();
  }, []);
```

with:

```typescript
  // Load projects from server
  useEffect(() => {
    (async () => {
      try {
        const list = await api.get<Project[]>('/api/projects');
        setProjects(list);
        if (list.length > 0) {
          setProjectId(list[0].id);
        }
      } catch (err) {
        setInitError(err instanceof Error ? err.message : 'Failed to load projects');
      }
    })();
  }, []);
```

- [ ] **Step 2: Add "no repos" empty state**

In the JSX section, replace the `!projectId` condition (line 103-104):

```typescript
      ) : !projectId ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
```

with:

```typescript
      ) : !projectId ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No repos registered</div>
          <div style={{ fontSize: 14 }}>
            Run <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>agentboard init</code> in
            a repo to register it, then restart the server.
          </div>
        </div>
```

- [ ] **Step 3: Verify the UI builds**

Run: `cd /home/user/Personal/agentboard/ui && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add ui/src/App.tsx
git commit -m "feat(ui): remove default project fallback, show 'no repos' empty state"
```

---

## Chunk 5: Integration Verification

### Task 7: End-to-end manual verification

- [ ] **Step 1: Full build**

```bash
cd /home/user/Personal/agentboard && npm run build
```
Expected: Both server and UI build successfully

- [ ] **Step 2: Verify init registers the current repo**

```bash
cd /home/user/Personal/agentboard
npx tsx bin/agentboard.ts init
cat ~/.agentboard/repos.json
```
Expected: Entry with `"path": "/home/user/Personal/agentboard"` in the array

- [ ] **Step 3: Verify the project selector shows registered repos**

Start the server and check that the UI shows the registered project(s) instead of "Default Project":

```bash
cd /home/user/Personal/agentboard
npx tsx bin/agentboard.ts up
# Open http://localhost:4200 in browser
# Should see registered project name, NOT "Default Project"
# If no repos registered, should see "No repos registered" message
```

- [ ] **Step 4: Clean up test registry entry if needed**

If you registered `/home/user/Personal/agentboard` as a test, edit `~/.agentboard/repos.json` to remove it and keep only actual repos like `football-manager`.

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: integration fixups for global repo registry"
```
