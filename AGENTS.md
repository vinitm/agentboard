# Agentboard

Self-hosted Kanban board that orchestrates AI coding agents through a spec-driven pipeline:
PM builds spec conversationally → AI plans → engineer reviews plan → autonomous execution (per-subtask implement → checks → code quality → final review → PR).
Built with TypeScript, Express, SQLite, Socket.IO, React + Tailwind.
See [docs/architecture/agent-orchestration.md](docs/architecture/agent-orchestration.md) for the complete agent orchestration architecture.

## Commands

npm run build          # Compile TypeScript + build React UI
npm run build:server   # TypeScript only
npm run build:ui       # React/Vite UI only
npm run dev            # Watch mode with auto-reload (tsx)
npm start              # Run compiled dist/bin/agentboard.js

### Testing

npm test               # Run backend tests
npm run test:watch     # Watch mode
npm run test:coverage  # Backend tests with coverage report

### CLI (Global)

The CLI is global — commands work from anywhere:

agentboard init        # Initialize .agentboard/config.json in a repo
agentboard up          # Start global server + worker (from anywhere)
agentboard down        # Graceful shutdown (from anywhere)
agentboard doctor      # Verify prerequisites + show registered projects

**Global state:** `~/.agentboard/` stores `server.json` (port, host, concurrency), `agentboard.db` (shared database), `repos.json` (project registry), and `shutdown` (IPC signal).

**Per-project state:** `<repo>/.agentboard/config.json` stores project-specific settings (models, commands, review rules). Stage logs at `.agentboard/logs/{taskId}/{stage}.log` (per-stage) and `.agentboard/logs/{taskId}/subtask-{subtaskId}/{stage}.log` (per-subtask).

**Chat sessions:** Persistent per-task chat sessions via Claude Code `--session-id` / `--resume` instead of replaying full history per message. Session ID stored on `tasks.chat_session_id`. Falls back to history replay if session cannot be resumed.

## Code Style & Conventions

- ES module imports with `.js` extensions (even for .ts files) — see [docs/gotchas/imports.md](docs/gotchas/imports.md)
- `console.log` with bracketed prefixes: `[worker]`, `[http]`, `[recovery]`
- Prepared statements for all DB queries (see src/db/queries.ts)
- snake_case DB columns → camelCase TypeScript via row-conversion functions
- `execFile` (promisified) for shell commands, never `exec`
- Prompt templates in `prompts/` as markdown files
- Follow existing stage patterns in `src/worker/stages/`

## Testing Requirements

- Co-locate tests: `foo.ts` → `foo.test.ts`, `Bar.tsx` → `Bar.test.tsx`
- `createTestDb()` from `src/test/helpers.ts` for in-memory DB per test
- `createTestRepo()` for tests needing real git repos (auto-cleaned)
- `createTestApp()` for API route tests with supertest
- Backend: Node environment. UI: jsdom. E2E: Playwright in `e2e/`
- Run `npm test` before committing

## Development Workflow

Interactive sessions follow the ECC-based workflow in `.claude/rules/common/development-workflow.md`:
Research → Plan → TDD → Review → Docs & Learn → Commit

All learnings are project-scoped. See `.claude/rules/common/learning-scope.md`.
Architectural decisions are recorded in [docs/decisions.md](docs/decisions.md).

## Architecture & Boundaries

3 layers: CLI (`src/cli/`) → Server+Worker (`src/server/`, `src/worker/`) → DB (`src/db/`)

**Global state** (`~/.agentboard/`): Shared SQLite DB across all projects, server config, project registry, shutdown signal.
**Per-project state** (`<repo>/.agentboard/`): Project config, git worktrees, logs, memory, and progress files.

Pipeline: backlog → ready → spec_review → planning → needs_plan_review → implementing → [per-subtask: implement → checks → code_quality] → final_review → pr_creation → needs_human_review|done
Subtask pipeline: backlog → ready → implement → checks → (inline fix) → code_quality → done|failed|blocked

- **Spec authoring** — PM builds spec conversationally via chat UI with persistent session continuity (Claude Code `--session-id` / `--resume`). Brainstorming agent has read-only guardrails (Read, Glob, Grep tools only) and is confined to spec building via role boundaries (no edits, no shell, no code changes). AI assists through a specify→clarify loop, asking follow-up questions to refine requirements. Falls back to history-replay session if resume fails.
- **Spec review** (`src/worker/stages/spec-review.ts`) — after spec is built, AI reviews the spec for completeness, clarity, and feasibility before planning begins.
- **Plan review** — after AI planning, task pauses at `needs_plan_review`. Engineer reviews/edits plan via `POST /api/tasks/:id/review-plan` (approve with optional edits, or reject with required reason). Rejection feedback flows into re-planning context.
- **Task routing** — Clicking a task card on the board navigates to `/tasks/:id` (full page). No inline modal. `TaskPage` has all action panels (BlockedPanel, PRPanel, PlanReviewPanel, move/retry/delete). `TaskDetail.tsx` was removed.
- **Learnings UI** — `/learnings` page displays: extracted skills from `.claude/skills/learned/` (with frontmatter parsing), analytics on pipeline performance (first-pass check rate, avg attempts, common failures), and task history with metrics (duration, tokens, outcome). Backed by `GET /api/projects/:projectId/learning`, `GET /api/projects/:projectId/learning/history`, and `GET /api/projects/:projectId/learning/skills`.
- **Stages** (`src/worker/stages/`) — spec-review, planner, implementer, checks, code-quality, final-review, pr-creator, learner
- **Implementer** (`src/worker/stages/implementer.ts`) — writes code in the worktree. Returns structured status: DONE (implementation complete), NEEDS_CONTEXT (missing information), or BLOCKED (cannot proceed).
- **Inline fix** (`src/worker/inline-fix.ts`) — when checks fail, one targeted fix attempt with failure context. If the fix also fails, task is escalated to human (blocked).
- **Code quality** (`src/worker/stages/code-quality.ts`) — single reviewer that evaluates code quality per subtask after checks pass. Replaces the old 3-reviewer panel.
- **Final review** (`src/worker/stages/final-review.ts`) — runs after all subtasks complete, reviewing the full changeset before PR creation.
- **Auto-merge** (`src/worker/auto-merge.ts`) — skip human review when low risk + reviewer passes + no security-sensitive files.
- **Task logging** (`src/worker/log-writer.ts`, `src/worker/stage-runner.ts`) — stage-wise logs at `.agentboard/logs/{taskId}/{stage}.log` (per-stage) or `.agentboard/logs/{taskId}/subtask-{subtaskId}/{stage}.log` (per-subtask with retries). `StageRunner` wraps each stage execution with DB indexing and Socket.IO broadcasting. New `stage_logs` table tracks stage execution metadata (attempt, duration, tokens, status).
- **Model selection** — simplified: uses opus everywhere for consistent quality across all stages.
- **Learning extraction** (`src/worker/stages/learner.ts`) — after each task reaches a terminal state (done/failed), fire-and-forget `extractLearnings()` spawns `claude --print` with learner prompt to analyze execution and save project-specific patterns to `.claude/skills/learned/`. Non-blocking. Collects quantitative metrics (`recordLearning()`) and qualitative patterns (`extractLearnings()`).

Subtasks execute serially. Parent creates single PR after all succeed.

**Task IDs** — Global auto-incrementing integers (`INTEGER PRIMARY KEY AUTOINCREMENT`), not UUIDs. `Task.id` is `number` throughout. URLs are `/tasks/123`. All FK columns referencing tasks are `INTEGER`. A data-preserving migration in `schema.ts` (`migrateTaskIdsToInteger`) converts old UUID-based DBs at startup.

**Task fields** — See `src/types/index.ts` for all Task interface fields. Key chat-related field: `chatSessionId` (nullable string) stores the persistent Claude Code session ID for conversational spec building.

See [docs/gotchas/subtasks.md](docs/gotchas/subtasks.md) for subtask pipeline pitfalls.
See [docs/architecture/](docs/architecture/) for ADRs. See [docs/gotchas/](docs/gotchas/) for known pitfalls.

## Never Do / Always Ask First

- Don't use `any` — strict TypeScript throughout
- Don't add dependencies without discussion
- Don't modify the worker loop's 5-second polling or stage ordering without understanding the full pipeline
- Don't commit directly to master — agentboard creates feature branches per task
- Don't hardcode model names — use config.modelDefaults and model-selector.ts
- Don't create new DB connections — use `getDatabase()` singleton

## References

- [docs/architecture/](docs/architecture/) — Architecture Decision Records
- [docs/gotchas/](docs/gotchas/) — Known pitfalls by subsystem
- [prompts/](prompts/) — Prompt templates for each pipeline stage
- [src/types/index.ts](src/types/index.ts) — All shared interfaces and type unions
