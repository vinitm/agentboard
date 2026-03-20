# Agent Orchestration Architecture

> System-level design for agentboard. For per-stage details, see [pipeline-stages.md](../pipeline-stages.md). For API endpoints, see [api-routes.md](../api-routes.md).

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Agentboard (Global)                         │
│                      ~/.agentboard/                                  │
│  ┌──────────┐   ┌──────────────┐   ┌──────────┐   ┌────────────┐  │
│  │ React UI │◄──│ Socket.IO WS │◄──│  Express  │──▶│  SQLite DB │  │
│  │ (Kanban) │   │  (real-time) │   │  API      │   │ (WAL mode) │  │
│  └──────────┘   └──────┬───────┘   └──────────┘   └─────┬──────┘  │
│                        │                                  │         │
│                        ▼                                  │         │
│              ┌─────────────────┐                         │         │
│              │   Worker Loop   │◄────────────────────────┘         │
│              │  (5s polling)   │                                    │
│              └────────┬────────┘                                    │
│                       │                                             │
│         ┌─────────────┼────────────────────┐                        │
│         ▼             ▼             ▼      ▼                        │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│    │Project A │  │Project B │  │Project C │  │Project N │         │
│    └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
│         ▼             ▼             ▼            ▼                  │
│    ┌─────────────────────────────────────────────────┐              │
│    │         Claude Code Executor (per task)          │              │
│    │        spawn('claude', ['--print', ...])         │              │
│    └──────────────────┬──────────────────────────────┘              │
│         ┌─────────────┼─────────────┐                               │
│         ▼             ▼             ▼                                │
│    ┌─────────┐  ┌─────────┐  ┌─────────┐                           │
│    │Worktree │  │Worktree │  │Worktree │  (per task, per project)  │
│    │  /task-a│  │  /task-b│  │  /task-c│                           │
│    └─────────┘  └─────────┘  └─────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
```

## Global vs Per-Project State

### Global (`~/.agentboard/`)

| File | Purpose |
|------|---------|
| `agentboard.db` | Single SQLite database (WAL mode) — all projects' tasks, runs, artifacts, events |
| `server.json` | Server config (port, host, maxConcurrentTasks, notifications) |
| `repos.json` | Registry of initialized projects |
| `shutdown` | IPC signal file for `agentboard down` |

The worker polls the database every 5 seconds, dispatching tasks across projects up to `maxConcurrentTasks`.

### Per-Project (`<repo>/.agentboard/`)

| File/Dir | Purpose |
|----------|---------|
| `config.json` | Models, commands, review rules, PR settings, branch/remote config |
| `worktrees/` | Git worktrees per task (cleaned up after completion) |
| `logs/` | Per-stage log files (30-day retention) |
| `memory.json` | Failure patterns + project conventions |

Config is loaded at task processing time from each project's `.agentboard/config.json`.

## Task State Machine

```
                                    ┌──────────┐
                                    │ cancelled│
                                    └──────────┘
                                         ▲
                                         │ (user cancels)
┌─────────┐    ┌───────┐    ┌───────────┐    ┌──────────┐
│ backlog │───▶│ ready │───▶│spec_review│───▶│ planning │
└─────────┘    └───────┘    └───────────┘    └────┬─────┘
                                                   │
                                              ┌────▼─────────────┐
                                              │needs_plan_review │
                                              └────┬─────────────┘
                                                   │ (engineer approves)
                                              ┌────▼─────────────┐
                                              │  implementing    │
                                              └────┬─────────────┘
                                              ┌────▼─────────────┐
                                              │    checks        │
                                              └────┬─────────────┘
                                          ┌────────┼────────┐
                                          │ pass   │ fail   │
                                          │        ▼        │
                                          │  (inline fix →  │
                                          │   re-check)     │
                                          ▼                 ▼
                                 ┌────────────────┐  ┌─────────┐
                                 │  code_quality  │  │blocked/ │
                                 └────────┬───────┘  │failed   │
                                          │          └─────────┘
                                 ┌────────▼─────────┐
                                 │  final_review    │
                                 └────────┬─────────┘
                                 ┌────────▼─────────┐
                                 │  pr_creation     │
                                 └────────┬─────────┘
                                   ┌──────┼──────┐
                                   ▼             ▼
                          ┌─────────────┐  ┌──────┐
                          │needs_human_ │  │ done │
                          │review       │  └──────┘
                          └──────┬──────┘
                                 ▼
                            ┌──────┐
                            │ done │
                            └──────┘
```

**14 states:** `backlog`, `ready`, `spec_review`, `planning`, `needs_plan_review`, `implementing`, `checks`, `code_quality`, `final_review`, `pr_creation`, `needs_human_review`, `done`, `blocked`, `failed`, `cancelled`

## Worker Loop

**File:** `src/worker/loop.ts`

```
every 5 seconds:
  → Poll DB for tasks in actionable states
  → Claim up to maxConcurrentTasks (atomic DB update prevents double-pickup)
  → For each claimed task:
      Run stages sequentially (see pipeline-stages.md)
      Broadcast stage:transition events via Socket.IO
  → Recover stale tasks (claimed >30 min ago)
```

Tasks are dispatched globally across all registered projects. The claim mechanism uses a conditional DB update — only the first worker to set `claimed_by` wins.

## Git Worktree Isolation

**File:** `src/worker/git.ts`

Each task gets an isolated git worktree:

```
<repo>/.agentboard/worktrees/
├── task-42/     ← branch: agentboard/42-add-auth
├── task-43/     ← branch: agentboard/43-fix-login
└── task-44/     ← branch: agentboard/44-refactor-db
```

- Created from `config.baseBranch` before first implementation attempt
- Shared across all stage transitions for the same task
- Cleaned up on task completion (`git worktree remove --force`)
- Stale worktrees pruned on worker startup

## Model Selection

**File:** `src/worker/model-selector.ts`

All stages use **opus** for consistent quality. The old multi-model strategy (sonnet for reviews, opus for implementation) was replaced in the superpowers workflow rewrite.

Exception: the learner stage uses **haiku** by default (configurable via `config.modelDefaults.learning`).

See [ADR-005](005-model-selection.md) for decision history.

## Database Schema

**File:** `src/db/schema.ts` — **Location:** `~/.agentboard/agentboard.db`

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `projects` | Registered repos | path, name, config_path |
| `tasks` | Task state + spec | id (int), project_id, status, spec (JSON), claimed_by, chat_session_id |
| `runs` | Stage execution records | task_id, stage, status, attempt, tokens_used, model_used, input, output |
| `stage_logs` | Per-stage metadata | task_id, stage, attempt, file_path, status, summary, duration_ms |
| `artifacts` | Structured outputs | run_id, type, name, content |
| `git_refs` | Branch tracking | task_id, branch, worktree_path, status |
| `events` | Lifecycle events | task_id, type, payload |
| `task_logs` | Log file metadata | task_id, path, size |
| `chat_messages` | Spec building chat | task_id, role, content |

**Access patterns:**
1. **Express API** — read-heavy (UI queries)
2. **Worker loop** — read-write (serialized via SQLite locking)
3. **Socket.IO broadcaster** — write (event emission)

All queries use prepared statements via `src/db/queries.ts`. Row conversion functions handle `snake_case` → `camelCase`.

## Key Architectural Patterns

| Pattern | Where | Why |
|---------|-------|-----|
| Inline fix on failure | Implementer + checks | Fixes in-flow, not numbered retry iterations |
| Structured implementer status | `DONE/NEEDS_CONTEXT/BLOCKED` | Graceful edge case handling |
| Single model (opus) | All stages | Consistent quality, simpler config |
| Per-stage tool restrictions | `stage-tools.ts` | Principle of least privilege |
| Append-only logs | Log writer, learning log | Safe concurrent writes |
| Atomic task claiming | Worker loop | Conditional DB update prevents double-pickup |
| Event-driven UI | Socket.IO | No frontend polling |
| Immutable task updates | Worker loop | Re-fetch after mutations to avoid stale objects |
| Session persistence | Chat endpoint | `--session-id`/`--resume` for conversational state |

## Recovery & Crash Handling

**File:** `src/worker/recovery.ts`

On worker startup, `recoverStaleTasks()` resets any task claimed >30 minutes ago in an agent-controlled status back to `ready` with claims cleared. This handles worker crashes — slow tasks are not affected (executor timeout is 300s/600s, well under 30 min).

## Worker Memory

**File:** `src/worker/memory.ts`

Persistent per-project memory at `.agentboard/memory.json`:

```typescript
{
  failurePatterns: [
    { pattern: "ESLint: no-unused-vars", resolution: "Remove unused imports", count: 5 }
  ],
  conventions: [
    { key: "import-style", value: "ES modules with .js extensions" }
  ]
}
```

Loaded at task processing time and included in stage prompts to improve future agent performance.

## Related Documentation

- [Pipeline Stages](../pipeline-stages.md) — per-stage contracts, tools, prompts, failure modes
- [API Routes](../api-routes.md) — REST endpoints + Socket.IO events
- [Source Map](../source-map.md) — directory structure + key types
- [ADR Index](README.md) — architecture decision records
- [Decision Log](../decisions.md) — quick-reference decision diary
- [Gotchas](../gotchas/) — failure-backed troubleshooting
