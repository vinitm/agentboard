# Agent Orchestration Architecture

This document describes how agentboard orchestrates AI coding agents through its autonomous pipeline — from task creation through spec generation, planning, implementation, review, and PR creation.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Agentboard (Global)                         │
│                      ~/.agentboard/                                  │
│  ┌──────────┐   ┌──────────────┐   ┌──────────┐   ┌────────────┐  │
│  │ React UI │◄──│ Socket.IO WS │◄──│  Express  │──▶│  SQLite DB │  │
│  │ (Kanban) │   │  (real-time) │   │  API      │   │ (WAL, WG)  │  │
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
│    │ (Repo 1) │  │ (Repo 2) │  │ (Repo 3) │  │ (Repo N) │         │
│    └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
│         │             │             │            │                  │
│         ▼             ▼             ▼            ▼                  │
│    ┌─────────────────────────────────────────────────┐              │
│    │  Per-Project State (.agentboard/ per repo)      │              │
│    │  ├─ config.json (project-specific settings)    │              │
│    │  ├─ worktrees/ (git worktrees per task)        │              │
│    │  ├─ logs/ (task execution logs)                │              │
│    │  └─ memory.json (project-scoped learning)      │              │
│    └──────────────┬────────────────────────────────┘              │
│                   │                                                 │
│                   ▼                                                 │
│    ┌─────────────────────────────────────┐                         │
│    │   Claude Code Executor (per task)   │                         │
│    │  spawn('claude', ['--print', ...])  │                         │
│    └─────────────────────────────────────┘                         │
│         │            │            │                                 │
│         ▼            ▼            ▼                                 │
│    ┌─────────┐  ┌─────────┐  ┌─────────┐                          │
│    │Worktree │  │Worktree │  │Worktree │   (per task, per project)│
│    │  /task-a│  │  /task-b│  │  /task-c│                          │
│    └─────────┘  └─────────┘  └─────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

## Global vs Per-Project State

Agentboard is designed to orchestrate multiple projects from a single server instance.

### Global State (~/.agentboard/)

Shared across all projects:
- **`agentboard.db`** — Single SQLite database (WAL mode) storing all projects' tasks, runs, artifacts, and events
- **`server.json`** — Server-level configuration (port, host, maxConcurrentTasks, notifications)
- **`repos.json`** — Registry of all initialized projects
- **`shutdown`** — IPC signal file created by `agentboard down` to trigger graceful shutdown

The worker loop polls this database every 5 seconds and dispatches tasks across registered projects up to `maxConcurrentTasks`.

### Per-Project State (<repo>/.agentboard/)

Unique to each project:
- **`config.json`** — Project-specific settings (models, commands, review rules, PR settings, branch/remote config)
- **`worktrees/`** — Git worktrees for task isolation (one per task, cleaned up after completion)
- **`logs/`** — Task execution logs (one append-only file per task, retention: 30 days)
- **`memory.json`** — Persistent project memory (failure patterns, conventions)
- **Progress files** — `.agentboard-progress.md` in worktree during task execution

Per-project config is loaded at task processing time from each project's `.agentboard/config.json`.

### CLI Execution from Anywhere

`agentboard up` and `agentboard down` work from any directory because they operate on global state:
- `agentboard up` creates/connects to the global database, loads server config, and starts the worker loop
- `agentboard down` writes to the `shutdown` signal file, triggering graceful shutdown
- `agentboard init <repo>` registers a project (adds entry to `repos.json`)
- `agentboard doctor` shows registered projects and verifies prerequisites

## Task State Machine

A task moves through 14 possible states. The happy path is linear; failures and human input create branches.

```
                                    ┌──────────┐
                                    │ cancelled│
                                    └──────────┘
                                         ▲
                                         │ (user cancels or
                                         │  sibling fails)
                                         │
┌─────────┐    ┌───────┐    ┌──────┐    │    ┌──────────┐
│ backlog │───▶│ ready │───▶│ spec │────┼───▶│ planning │
└─────────┘    └───────┘    └──────┘    │    └────┬─────┘
                                        │         │
                                        │    ┌────▼─────┐
                                        │    │ blocked  │ (clarifying questions)
                                        │    └────┬─────┘
                                        │         │ (user answers)
                                        │         ▼
                              ┌─────────┼───────────────────────────┐
                              │         │    Ralph Loop              │
                              │         │                            │
                              │    ┌────▼────────┐   ┌────────┐    │
                              │    │implementing │──▶│ checks │    │
                              │    └─────▲───────┘   └───┬────┘    │
                              │          │               │          │
                              │          └───────────────┘          │
                              │       (retry on failure,            │
                              │        max 5 iterations)            │
                              └─────────┬───────────────────────────┘
                                        │
                                        ▼
                              ┌──────────────┐
                              │ review_panel │ (3 parallel reviewers)
                              └──────┬───────┘
                                     │
                         ┌───────────┼────────────┐
                         │           │            │
                         ▼           ▼            ▼
                    (all pass)  (any fail)   (max cycles)
                         │           │            │
                         │      back to       ┌───▼───┐
                         │    implementing    │failed │
                         │                    └───────┘
                         ▼
                  ┌─────────────┐
                  │ pr_creation │
                  └──────┬──────┘
                         │
              ┌──────────┼──────────┐
              │                     │
              ▼                     ▼
    ┌───────────────────┐     ┌──────┐
    │needs_human_review │────▶│ done │
    └───────────────────┘     └──────┘
              │
              ▼ (auto-merge gate passes)
          ┌──────┐
          │ done │
          └──────┘
```

### Subtask Pipeline

Subtasks follow a simplified pipeline — no spec, no review panel:

```
backlog → ready → implementing ↔ checks (ralph loop) → done | failed
```

- Subtasks execute serially (first = `ready`, rest = `backlog`)
- On completion, the next backlog sibling is promoted to `ready`
- On failure, remaining backlog siblings are cancelled
- Parent creates a single PR after all subtasks complete

## Pipeline Stages

Each stage is an async function with the contract:

```typescript
(db: Database, task: Task, worktreePath: string, config: AgentboardConfig) → Promise<Result>
```

Every stage spawns a fresh Claude Code subprocess, records a `Run` in the database, and streams output to the UI via Socket.IO.

### Stage 1: Spec Generation

**File:** `src/worker/stages/spec-generator.ts`
**Prompt:** `prompts/spec-generator.md`
**Model:** `config.modelDefaults.planning`

Transforms the user's task description into a structured specification:

```typescript
{
  acceptanceCriteria: string[];   // What "done" looks like
  fileScope: string[];            // Files likely to be touched
  outOfScope: string[];           // Explicitly excluded work
  riskAssessment: string;         // Low/medium/high with reasoning
}
```

Stored as an artifact (`type='spec'`) and attached to the task.

### Stage 2: Planning

**File:** `src/worker/stages/planner.ts`
**Prompt:** `prompts/planner.md`
**Model:** `config.modelDefaults.planning`

Analyzes the spec and produces an implementation plan:

```typescript
{
  planSummary: string;                                    // High-level approach
  subtasks: Array<{ title: string; description: string }>;// Decomposition (max 10)
  assumptions: string[];                                  // Stated assumptions
  fileHints: string[];                                    // Files to examine
}
```

If subtasks are returned, the worker creates child tasks. The first gets status `ready`; the rest get `backlog` for serial execution. The parent waits for all subtasks to complete.

If the planner has clarifying questions, the task moves to `blocked` and the user answers via the UI.

### Stage 3: Ralph Loop (Implement ↔ Checks)

**File:** `src/worker/ralph-loop.ts`
**Stages:** `src/worker/stages/implementer.ts`, `src/worker/stages/checks.ts`

The core retry loop that writes and validates code:

```
for iteration = 1 to maxRalphIterations (default 5):
    1. Run implementer (fallback prompt if iteration >= 3)
    2. Run checks (secrets → test → lint → format → typecheck → security)
    3. If all checks pass → commit → return success
    4. If checks fail → commit WIP → feed failures into next iteration
```

**Key design: fresh sessions per iteration.** Each iteration spawns a new Claude Code subprocess. Context between iterations is carried by:

- **Git commits** — partial work is committed each iteration
- **`.agentboard-progress.md`** — append-only log in the worktree
- **Task packet** — includes "Previous Failure" section with error output

**Fallback strategy:** On iteration 3+, switches from `implementer.md` to `implementer-fallback.md`, instructing the agent to try a fundamentally different approach.

#### Implementer

**Prompt:** `prompts/implementer.md` (or `implementer-fallback.md`)
**Model:** `config.modelDefaults.implementation` (typically `opus`)

Free-form implementation — no structured JSON output. The agent writes code directly in the worktree using Claude Code's file editing capabilities. Success is determined by exit code.

#### Checks

**Prompt:** None (runs shell commands directly)

Executes project check commands in order:

| Check | Command Source | Behavior on Failure |
|-------|---------------|-------------------|
| Secret detection | Built-in regex scan | Immediate fail, never committed |
| Test | `config.commands.test` | Fail |
| Lint | `config.commands.lint` | Fail |
| Format | `config.commands.format` | Auto-fix if `formatPolicy = 'auto-fix-separate-commit'` |
| Typecheck | `config.commands.typecheck` | Fail |
| Security | `config.commands.security` | Fail |

Secret detection scans the git diff for patterns like AWS keys (`AKIA...`), PEM markers, `sk-` prefixes, and generic `password|secret|token = "..."` assignments.

### Stage 4: Review Panel

**File:** `src/worker/stages/review-panel.ts`
**Prompts:** `prompts/review-architect.md`, `review-qa.md`, `review-security.md`
**Model:** `config.modelDefaults.review` (or `opus` if `riskLevel === 'high'`)

Three specialized reviewers run **in parallel** via `Promise.allSettled`:

| Reviewer | Focus |
|----------|-------|
| **Architect** | Design patterns, modularity, API contracts, technical debt |
| **QA Engineer** | Test coverage, edge cases, error handling, acceptance criteria |
| **Security** | Injection, secrets, auth, input validation, OWASP Top 10 |

Each returns:
```typescript
{ passed: boolean; feedback: string; issues: string[] }
```

**Unanimous pass required.** If any reviewer fails:
1. Feedback is formatted and attached to the task
2. Task cycles back to `implementing` with review feedback as context
3. Ralph loop runs again with the feedback
4. Up to `config.maxReviewCycles` attempts (default 3)

Each reviewer's output is captured by a `BufferedWriter` to prevent log interleaving, then flushed sequentially to the task log.

### Stage 5: PR Creation

**File:** `src/worker/stages/pr-creator.ts`
**Model:** `config.modelDefaults.implementation`

1. Push branch to `config.githubRemote`
2. Create labels: `agentboard`, `risk:{level}`
3. Build PR body (summary, assumptions, acceptance criteria, check results, review panel results)
4. Run `gh pr create` (draft if `config.prDraft`)
5. Store PR URL and number as artifacts

For parent tasks with subtasks, a single PR is created after all subtasks complete.

### Stage 6: Auto-Merge Gate

**File:** `src/worker/auto-merge.ts`

Evaluates whether the task can skip human review. **All criteria must pass:**

1. `config.autoMerge` is enabled
2. `task.riskLevel === 'low'`
3. No security-sensitive files touched (`.env`, `secret`, `credential`, `auth`, `password`, `token`, `.pem`, `.key`)
4. All 3 reviewers passed with zero total issues
5. Task is not a parent with subtasks

If the gate passes → task moves directly to `done`.
Otherwise → task moves to `needs_human_review`.

### Stage 7: Learner

**File:** `src/worker/stages/learner.ts`

Runs after every task completion (success or failure). Collects metrics:

```typescript
{
  totalTokensUsed: number;
  implementationAttempts: number;
  reviewCycles: number;
  checksPassedFirst: boolean;
  failedCheckNames: string[];
  reviewerFeedbackThemes: string[];
}
```

Appended to `.agentboard/learning-log.jsonl`. Aggregated analytics available via `/api/projects/:projectId/learning`.

## Claude Code Executor

**File:** `src/worker/executor.ts`

All AI-powered stages use a single executor function:

```typescript
executeClaudeCode(options: {
  prompt: string;
  worktreePath: string;
  model: string;
  timeout?: number;          // Default 300s
  onOutput?: (chunk) => void; // Real-time streaming
}): Promise<{
  output: string;
  exitCode: number;
  tokensUsed: number;
  duration: number;
}>
```

Spawns: `claude --print --model <model> --permission-mode acceptEdits`

- `--print` — non-interactive mode
- `--permission-mode acceptEdits` — agent can write files without prompting
- `cwd` is the worktree path — agent operates in the task's isolated checkout
- Prompt piped to `stdin`; `stdout`/`stderr` streamed chunk-by-chunk
- Chunks broadcast to UI via Socket.IO (`run:log` event)
- Token usage parsed from output via regex; fallback: `output.length / 4`

## Model Selection

**File:** `src/worker/model-selector.ts`

```
┌────────────────┬──────────────────────┬──────────────────────────┐
│ Stage          │ Config Key           │ Default                  │
├────────────────┼──────────────────────┼──────────────────────────┤
│ spec           │ modelDefaults.planning│ sonnet                  │
│ planning       │ modelDefaults.planning│ sonnet                  │
│ implementing   │ modelDefaults.implementation│ opus              │
│ checks         │ modelDefaults.implementation│ opus              │
│ review_panel   │ modelDefaults.review │ sonnet                  │
│ pr_creation    │ modelDefaults.implementation│ opus              │
└────────────────┴──────────────────────┴──────────────────────────┘

Exception: high-risk tasks + review_panel → always opus
```

## Git Worktree Isolation

**File:** `src/worker/git.ts`

Each task gets an isolated git worktree:

```
.agentboard/worktrees/
├── task-abc123/     ← branch: agentboard/abc123-add-auth
├── task-def456/     ← branch: agentboard/def456-fix-login
└── task-ghi789/     ← branch: agentboard/ghi789-refactor-db
```

- Created from `config.baseBranch` at task start
- Subtasks share the parent's worktree (serial execution ensures no conflicts)
- Cleaned up on task completion (`git worktree remove --force`)
- Stale worktrees pruned on worker startup

## Context Flow Between Stages

Each stage builds a **task packet** (`src/worker/context-builder.ts`) that provides context to the Claude Code agent:

```
┌─────────────────────────────────────────────────┐
│ Task Packet                                      │
│                                                  │
│ ## Task                                          │
│ Title, description, spec                         │
│                                                  │
│ ## File Hints       ← from planner output        │
│ src/auth.ts, src/db/users.ts                     │
│                                                  │
│ ## Plan Summary     ← from planner output        │
│ "Create auth middleware using JWT..."             │
│                                                  │
│ ## Previous Failure ← from last failed run       │
│ "TypeError: Cannot read property..."             │
│ (truncated to 2000 chars)                        │
│                                                  │
│ ## User Answers     ← from blocked→answered flow │
│ Q: "Should we use OAuth2 or JWT?"                │
│ A: "JWT with refresh tokens"                     │
└─────────────────────────────────────────────────┘
```

This packet is interpolated into the stage's prompt template via `{taskSpec}` and `{failureSummary}` placeholders.

## Real-Time Update Flow

```
Claude Code ──(stdout chunks)──▶ onOutput callback
                                       │
                                       ▼
                              Worker broadcasts via
                              Socket.IO (run:log event)
                                       │
                                       ▼
                              React UI updates live
                              log viewer + task status
```

**Socket.IO Events:**

| Event | Payload | Trigger |
|-------|---------|---------|
| `task:created` | `{ task }` | New task created |
| `task:updated` | `{ taskId, status }` | Status change |
| `task:event` | `{ type, payload }` | Stage milestones |
| `run:log` | `{ taskId, runId, chunk, timestamp }` | Claude output chunks |

**Task Event Types:** `status_changed`, `spec_generated`, `assumptions_made`, `subtasks_created`, `ralph_iteration_passed`, `ralph_iteration_failed`, `ralph_loop_completed`, `review_panel_completed`, `review_panel_failed`, `pr_created`, `auto_merged`, `task_error`

## Task Logging

**File:** `src/worker/log-writer.ts`

Each task gets a single append-only log file at `.agentboard/logs/{taskId}.log`:

```
════════════════════════════════════════════════════════
TASK: Add user authentication
ID: abc123 | Risk: medium | Started: 2026-03-17T10:00:00Z
════════════════════════════════════════════════════════

── STAGE: spec (run: spec-abc123, attempt: 1) ──────────
[10:00:01] [start] model=sonnet-4
[10:00:05] Extracted 4 acceptance criteria...
[10:00:08] [end] status=success tokens=1234 duration=7000ms

── STAGE: planning (run: plan-abc123, attempt: 1) ──────
[10:00:10] [start] model=sonnet-4
[10:00:15] Decomposed into 3 subtasks...
[10:00:18] [end] status=success tokens=2100 duration=8000ms

── SUBTASK 1/3: Create JWT middleware (sub-001) ────────

  ── STAGE: implementing (run: impl-sub001, attempt: 1) ──
  [10:00:20] [start] model=opus
  ...

  ── REVIEWER: Architect ────────────────────────────────
    [10:02:00] [start] model=sonnet-4
    [10:02:10] [end] status=passed
  ── REVIEWER: QA Engineer ──────────────────────────────
    [10:02:00] [start] model=sonnet-4
    [10:02:12] [end] status=passed
  ── REVIEWER: Security ─────────────────────────────────
    [10:02:00] [start] model=sonnet-4
    [10:02:15] [end] status=passed
```

Subtask logs are indented under the parent. Parallel reviewers use `BufferedWriter` to prevent interleaving.

Log retention: 30 days (cleaned on worker startup).

## Recovery & Crash Handling

**File:** `src/worker/recovery.ts`

On worker startup:

1. **Stale task recovery** — tasks claimed >30 minutes ago in an agent-controlled status (`spec`, `planning`, `implementing`, `checks`, `review_panel`) are reset to `ready` with claims cleared
2. **Stalled subtask chain recovery** — parents in `implementing` with backlog children but no active children get their next backlog child promoted to `ready`

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

Tracks recurring failure patterns and project conventions to improve future agent performance.

## Database Schema

**File:** `src/db/schema.ts`
**Location:** `~/.agentboard/agentboard.db` (shared, global)

| Table | Purpose |
|-------|---------|
| `projects` | Registered project repositories (for multi-project indexing) |
| `tasks` | Task state, spec, ownership, parent-child relationships (cross-project) |
| `runs` | Stage execution records (model, tokens, input/output, timing) |
| `artifacts` | Structured outputs (specs, plans, review results, PR URLs) |
| `git_refs` | Branch and worktree tracking per task |
| `events` | Task lifecycle events for timeline reconstruction |
| `task_logs` | Log file metadata (path, size) |

All queries use prepared statements via `src/db/queries.ts`. Row conversion functions handle `snake_case` DB columns to `camelCase` TypeScript.

The database is accessed by:
1. **Express API** — for UI queries (read-heavy)
2. **Worker loop** — for task processing (read-write, serialized via SQLite locking)
3. **Socket.IO broadcaster** — for real-time updates

## Key Architectural Patterns

| Pattern | Where | Why |
|---------|-------|-----|
| **Fresh sessions per iteration** | Ralph loop | Prevents context buildup; progress persists via git + files |
| **Unanimous review** | Review panel | All 3 reviewers must pass to prevent low-quality merges |
| **Append-only logs** | Log writer, learning log | Safe concurrent writes without locking |
| **Atomic task claiming** | Worker loop | Conditional DB update prevents double-pickup |
| **Cascading subtask execution** | Worker loop | Serial execution via promote-on-complete without extra orchestration |
| **Buffered parallel output** | Review panel | Prevents log interleaving from concurrent reviewers |
| **Event-driven UI** | Socket.IO | No frontend polling; all state changes broadcast immediately |
| **Immutable task updates** | Worker loop | New DB records, re-fetch after mutations to avoid stale objects |

## Related ADRs

- [001-sqlite-wal](001-sqlite-wal.md) — Why SQLite with WAL mode
- [002-polling-worker](002-polling-worker.md) — Poll-based loop with event-driven wake-up
- [003-worktree-isolation](003-worktree-isolation.md) — Git worktrees for task isolation
- [004-serial-subtasks](004-serial-subtasks.md) — Serial subtask execution with single parent PR
- [005-model-selection](005-model-selection.md) — Stage-and-risk-driven model selection
- [006-claude-code-executor](006-claude-code-executor.md) — Claude Code as child process
