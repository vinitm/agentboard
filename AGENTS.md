# Agentboard

Self-hosted Kanban board that orchestrates AI coding agents through a spec-driven pipeline:
PM writes spec (with AI assistance) → AI plans → engineer reviews plan → autonomous execution (ralph loop → review panel → PR).
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

**Per-project state:** `<repo>/.agentboard/config.json` stores project-specific settings (models, commands, review rules).

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

Pipeline: backlog → ready → planning → needs_plan_review → implementing ↔ checks (ralph loop) → review_panel → pr_creation → needs_human_review|done
Subtask pipeline: backlog → ready → ralph loop → done|failed (fully autonomous, no review panel)

- **Spec authoring** — PM writes detailed spec via UI (6 sections: problem, user stories, acceptance criteria, constraints, out of scope, verification). Per-field AI refinement via `POST /api/tasks/refine-field`.
- **Plan review** — after AI planning, task pauses at `needs_plan_review`. Engineer reviews/edits plan via `POST /api/tasks/:id/review-plan` (approve with optional edits, or reject with required reason). Rejection feedback flows into re-planning context.
- **Learnings UI** — `/learnings` page displays: extracted skills from `.claude/skills/learned/` (with frontmatter parsing), analytics on pipeline performance (first-pass check rate, avg attempts, avg review cycles, common failures), and task history with metrics (duration, tokens, outcome). Backed by `GET /api/projects/:projectId/learning`, `GET /api/projects/:projectId/learning/history`, and `GET /api/projects/:projectId/learning/skills`.
- **Stages** (`src/worker/stages/`) — planner, implementer, checks, review-panel, pr-creator, learner
- **Ralph loop** (`src/worker/ralph-loop.ts`) — implement→checks loop with fresh context per iteration. Fallback prompt on 3rd+ failure. Max 5 iterations.
- **Review panel** (`src/worker/stages/review-panel.ts`) — 3 parallel reviewers (Architect, QA, Security). Unanimous pass required.
- **Auto-merge** (`src/worker/auto-merge.ts`) — skip human review when low risk + all reviewers pass + no security-sensitive files.
- **Task logging** (`src/worker/log-writer.ts`) — single append-only log per task. `BufferedWriter` for parallel writes.
- **Model selection** (`src/worker/model-selector.ts`) — maps stages to `config.modelDefaults` keys.
- **Learning extraction** (`src/worker/stages/learner.ts`) — after each task reaches a terminal state (done/failed), fire-and-forget `extractLearnings()` spawns `claude --print` with learner prompt to analyze execution and save project-specific patterns to `.claude/skills/learned/`. Non-blocking; uses configurable `config.modelDefaults.learning` model (default: haiku). Collects quantitative metrics (`recordLearning()`) and qualitative patterns (`extractLearnings()`).

Subtasks execute serially. Parent creates single PR after all succeed.
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
