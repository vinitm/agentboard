# Agent Orchestration Architecture

This document describes how agentboard orchestrates AI coding agents through its autonomous pipeline — from conversational spec building through planning, implementation with inline fixes, code quality review, and PR creation.

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

A task moves through the pipeline stages below. The happy path is linear; failures, blocked status, and human input create branches.

```
                                    ┌──────────┐
                                    │ cancelled│
                                    └──────────┘
                                         ▲
                                         │ (user cancels or
                                         │  sibling fails)
                                         │
┌─────────┐    ┌───────┐    ┌───────────┐    ┌──────────┐
│ backlog │───▶│ ready │───▶│spec_review│───▶│ planning │
└─────────┘    └───────┘    └───────────┘    └────┬─────┘
                                                   │
                                              ┌────▼─────────────┐
                                              │needs_plan_review │
                                              └────┬─────────────┘
                                                   │ (engineer approves)
                                                   ▼
                                              ┌──────────────┐
                                              │ implementing │
                                              └──────┬───────┘
                                                     │
                                                     │
                                              ┌──────▼───────┐
                                              │   implement  │
                                              └──────┬───────┘
                                                     │
                                              ┌──────▼───────┐
                                              │    checks    │
                                              └──────┬───────┘
                                                     │
                                          ┌──────────┼──────────┐
                                          │ pass     │ fail     │
                                          │          ▼          │
                                          │   (inline fix →     │
                                          │    re-check)        │
                                          │                     │
                                          ▼                     ▼
                                 ┌────────────────┐     ┌────────┐
                                 │  code_quality  │     │blocked/│
                                 │ (single review)│     │failed  │
                                 └────────┬───────┘     └────────┘
                                          │
                                          ▼
                              ┌──────────────────┐
                              │  final_review    │ (full changeset review)
                              └────────┬─────────┘
                                       │
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


## Pipeline Stages

Each stage is an async function with the contract:

```typescript
(db: Database, task: Task, worktreePath: string, config: AgentboardConfig) → Promise<Result>
```

Every stage spawns a fresh Claude Code subprocess, records a `Run` in the database, and streams output to the UI via Socket.IO.

### Stage 1: Conversational Spec Building

Spec authoring happens conversationally via the chat UI. The PM describes the task and AI assists through a specify→clarify loop, asking follow-up questions to refine requirements. The result is a structured specification with acceptance criteria, file scope, out-of-scope items, and risk assessment.

**Chat Session Persistence:** Conversational state persists across messages via Claude Code native session management (`--session-id` on first message, `--resume` on subsequent). Session ID stored on `tasks.chat_session_id`. If session resume fails, graceful fallback replays full chat history from `chat_messages` table to seed a fresh session.

**Brainstorming Agent Guardrails:**
- **Tool restrictions:** Read-only tools only (Read, Glob, Grep). No file writes, no shell commands.
- **Role boundaries:** System prompt (`prompts/brainstorming-system.md`) enforces conversation-only mode. Agent may read codebase for context but never suggests code changes or edits.
- **Completion:** Sets `isComplete: true` when all 3 spec fields substantive + at least 2 clarifying questions asked, or user explicitly says "done".

### Stage 2: Spec Review

**File:** `src/worker/stages/spec-review.ts`
**Model:** opus

Reviews the finalized spec for completeness, clarity, and feasibility before planning begins. Catches ambiguities and missing requirements early.

### Stage 3: Planning

**File:** `src/worker/stages/planner.ts`
**Prompt:** `prompts/planner-v2.md`
**Model:** opus

Analyzes the spec and produces an implementation plan:

```typescript
{
  planSummary: string;                                    // High-level approach
  confidence: number;                                     // 0-1 confidence score
  steps: Array<{ title: string; description: string; files?: string[] }>; // Implementation steps
  assumptions: string[];                                  // Stated assumptions
  fileMap: string[];                                      // All files across all steps
}
```

Steps are implementation guidance for the task, not separate tasks. The planner decomposes the work into logical steps that the implementer follows sequentially within a single task.

If the planner has clarifying questions, the task moves to `blocked` and the user answers via the UI.

### Stage 4: Implementation (Implement → Checks → Inline Fix)

**Stages:** `src/worker/stages/implementer.ts`, `src/worker/stages/checks.ts`

Each task goes through implement → checks in sequence. There is no separate retry loop orchestrator (the old "ralph loop" has been removed).

#### Implementer

**Prompt:** `prompts/implementer-v2.md`
**Model:** opus

The implementer writes code directly in the worktree using Claude Code's file editing capabilities. It returns a structured status:

- **DONE** — implementation is complete, proceed to checks
- **DONE_WITH_CONCERNS** — implementation complete but with noted concerns
- **NEEDS_CONTEXT** — missing information needed to continue
- **BLOCKED** — cannot proceed due to an external dependency or issue

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

#### Inline Fix

When checks fail, the implementer is re-invoked with failure context to fix the issues inline. This replaces the old ralph loop's separate iteration mechanism — fixes happen within the same flow rather than as numbered retry iterations.

### Stage 5: Code Quality Review

**File:** `src/worker/stages/code-quality.ts`
**Model:** opus

A single reviewer evaluates code quality for each task after checks pass. This replaces the old 3-reviewer panel (Architect, QA, Security) that required unanimous approval. The code quality reviewer covers design, testing, and security concerns in a single pass.

### Stage 6: Final Review

**File:** `src/worker/stages/final-review.ts`
**Model:** opus

After code quality passes, a final review examines the full changeset holistically — providing holistic verification against the spec before PR creation.

### Stage 7: PR Creation

**File:** `src/worker/stages/pr-creator.ts`
**Model:** opus

1. Push branch to `config.githubRemote`
2. Create labels: `agentboard`, `risk:{level}`
3. Build PR body (summary, assumptions, acceptance criteria, check results, code quality + final review results)
4. Run `gh pr create` (draft if `config.prDraft`)
5. Store PR URL and number as artifacts

### Stage 8: Auto-Merge Gate

**File:** `src/worker/auto-merge.ts`

Evaluates whether the task can skip human review. **All criteria must pass:**

1. `config.autoMerge` is enabled
2. `task.riskLevel === 'low'`
3. No security-sensitive files touched (`.env`, `secret`, `credential`, `auth`, `password`, `token`, `.pem`, `.key`)
4. Code quality and final review passed with no blocking issues

If the gate passes → task moves directly to `done`.
Otherwise → task moves to `needs_human_review`.

### Stage 9: Learner

**File:** `src/worker/stages/learner.ts`

Runs after every task completion (success or failure). Collects metrics:

```typescript
{
  totalTokensUsed: number;
  implementationAttempts: number;
  checksPassedFirst: boolean;
  failedCheckNames: string[];
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

## Stage Logs API

**File:** `src/server/routes/stage-logs.ts`

New REST endpoints for stage-wise log viewing:

### GET /api/tasks/:id/stages

Lists all stages executed for a task:

```typescript
{
  stages: [
    {
      id: "sl-001",
      taskId: 1,
      stage: "spec_review",
      attempt: 1,
      status: "completed",
      summary: "Spec validated: 4 acceptance criteria...",
      tokensUsed: 1234,
      durationMs: 7000,
      startedAt: "2026-03-17T10:00:01Z",
      completedAt: "2026-03-17T10:00:08Z"
    },
    {
      id: "sl-002",
      taskId: 1,
      stage: "planning",
      attempt: 1,
      status: "completed",
      summary: "Created implementation plan with 3 steps...",
      tokensUsed: 2100,
      durationMs: 8000,
      startedAt: "2026-03-17T10:00:10Z",
      completedAt: "2026-03-17T10:00:18Z"
    },
    {
      id: "sl-003",
      taskId: 1,
      stage: "implement",
      attempt: 1,
      status: "completed",
      summary: null,
      tokensUsed: 4567,
      durationMs: 70000,
      startedAt: "2026-03-17T10:00:20Z",
      completedAt: "2026-03-17T10:01:30Z"
    }
  ]
}
```

Sorted by `startedAt`.

### GET /api/tasks/:id/stages/:stageLogId/logs

Streams the log file content for a specific stage execution. Supports HTTP Range requests for efficient tailing:

```bash
curl "http://localhost:3000/api/tasks/task-abc123/stages/sl-001/logs"
curl -H "Range: bytes=1000-2000" "http://localhost:3000/api/tasks/task-abc123/stages/sl-001/logs"
```

Returns:
- **200 OK** with full log content
- **206 Partial Content** if Range header provided
- **404** if stage log not found

## Model Selection

**File:** `src/worker/model-selector.ts`

Simplified: all stages use **opus** for consistent quality. The old multi-model strategy (sonnet for planning/review, opus for implementation) has been replaced with a single-model approach.

```
┌──────────────────┬─────────┐
│ Stage            │ Model   │
├──────────────────┼─────────┤
│ spec_review      │ opus    │
│ planning         │ opus    │
│ implementing     │ opus    │
│ checks           │ opus    │
│ code_quality     │ opus    │
│ final_review     │ opus    │
│ pr_creation      │ opus    │
│ learner          │ opus    │
└──────────────────┴─────────┘
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
| `run:log` | `{ taskId, runId, stage, chunk, timestamp }` | Claude output chunks (now with stage context) |
| `stage:transition` | `{ taskId, stage, status, summary, durationMs, tokensUsed }` | Stage lifecycle (running → completed/failed) |

**Task Event Types:** `status_changed`, `spec_generated`, `assumptions_made`, `checks_passed`, `checks_failed`, `inline_fix_applied`, `code_quality_passed`, `code_quality_failed`, `final_review_completed`, `pr_created`, `auto_merged`, `task_error`

## Task Logging & Stage Runner

**Files:** `src/worker/log-writer.ts`, `src/worker/stage-runner.ts`

### Per-Stage Log Files

Each stage execution writes to its own log file:
- **Stage logs:** `.agentboard/logs/{taskId}/{stage}.log` (e.g., `spec_review.log`)
- **Retries:** Attempts > 1 append to `{stage}-{attempt}.log` (e.g., `implementing-2.log`)

Example structure:
```
.agentboard/logs/
└── {taskId}/
    ├── spec_review.log
    ├── planning.log
    ├── implementing.log
    ├── implementing-2.log     # Retry after quality fix
    ├── checks.log
    ├── inline_fix.log
    ├── code_quality.log
    ├── final_review.log
    └── pr_creation.log
```

### StageRunner Lifecycle

**File:** `src/worker/stage-runner.ts`

Wraps each stage execution with:
1. **Stage log creation** — record in `stage_logs` DB table with metadata (stage, attempt, filePath, startedAt)
2. **onOutput streaming** — append to log file + broadcast `run:log` event with stage context
3. **Stage transition** — broadcast `stage:transition` event when stage starts/completes
4. **Metadata capture** — optionally extract summary and token usage via `summarize()` callback

```typescript
const runner = createStageRunner({ taskId, projectId, io, db, logsDir, projectRoot });
const result = await runner.execute(
  'implement',
  (onOutput) => implementStage(onOutput),
  { attempt: 1, summarize: (result) => ({ summary, tokensUsed }) }
);
```

### Database Indexing

New `stage_logs` table provides fast stage lookup:

```sql
CREATE TABLE stage_logs (
  id TEXT PRIMARY KEY,
  task_id INTEGER,
  project_id TEXT,
  run_id TEXT,
  stage TEXT,
  attempt INTEGER,
  file_path TEXT,
  status TEXT,           -- 'running' | 'completed' | 'failed' | 'skipped'
  summary TEXT,
  tokens_used INTEGER,
  duration_ms INTEGER,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT
);
```

Enables **stage-wise log streaming** in UI: list all stages for a task, click to view per-stage logs.

Log retention: 30 days (cleaned on worker startup).

## Recovery & Crash Handling

**File:** `src/worker/recovery.ts`

On worker startup:

1. **Stale task recovery** — tasks claimed >30 minutes ago in an agent-controlled status (`spec_review`, `planning`, `implementing`, `checks`, `code_quality`, `final_review`) are reset to `ready` with claims cleared

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
| `tasks` | Task state, spec, ownership (cross-project) |
| `runs` | Stage execution records (model, tokens, input/output, timing) |
| `artifacts` | Structured outputs (specs, plans, review results, PR URLs) |
| `stage_logs` | Per-stage execution metadata (stage, attempt, file path, status, duration, tokens) — enables stage-wise log streaming in UI |
| `git_refs` | Branch and worktree tracking per task |
| `events` | Task lifecycle events for timeline reconstruction |
| `task_logs` | Log file metadata (path, size) |
| `chat_messages` | Conversational spec building messages (role, content, task_id) |

All queries use prepared statements via `src/db/queries.ts`. Row conversion functions handle `snake_case` DB columns to `camelCase` TypeScript.

The database is accessed by:
1. **Express API** — for UI queries (read-heavy)
2. **Worker loop** — for task processing (read-write, serialized via SQLite locking)
3. **Socket.IO broadcaster** — for real-time updates

## Key Architectural Patterns

| Pattern | Where | Why |
|---------|-------|-----|
| **Inline fix on failure** | Implementer + checks | Fixes happen in-flow rather than numbered retry iterations; simpler orchestration |
| **Structured implementer status** | Implementer | DONE/NEEDS_CONTEXT/BLOCKED enables graceful handling of edge cases |
| **Full-changeset final review** | Final review stage | Holistic verification against the spec before PR creation |
| **Single model (opus)** | All stages | Consistent quality, simpler configuration |
| **Append-only logs** | Log writer, learning log | Safe concurrent writes without locking |
| **Atomic task claiming** | Worker loop | Conditional DB update prevents double-pickup |
| **Event-driven UI** | Socket.IO | No frontend polling; all state changes broadcast immediately |
| **Immutable task updates** | Worker loop | New DB records, re-fetch after mutations to avoid stale objects |

## Related ADRs

- [001-sqlite-wal](001-sqlite-wal.md) — Why SQLite with WAL mode
- [002-polling-worker](002-polling-worker.md) — Poll-based loop with event-driven wake-up
- [003-worktree-isolation](003-worktree-isolation.md) — Git worktrees for task isolation
- [004-serial-subtasks](004-serial-subtasks.md) — Serial subtask execution with single parent PR
- [005-model-selection](005-model-selection.md) — Stage-and-risk-driven model selection
- [006-claude-code-executor](006-claude-code-executor.md) — Claude Code as child process
