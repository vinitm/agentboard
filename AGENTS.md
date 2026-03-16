# Agentboard

Self-hosted Kanban board that orchestrates AI coding agents through an autonomous pipeline:
spec → planning → ralph loop (implement ↔ checks) → multi-role review panel → auto-merge gate → PR creation.
Built with TypeScript, Express, SQLite, Socket.IO, React + Tailwind.

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

### CLI

agentboard init        # Initialize .agentboard/ config in a repo
agentboard up          # Start server + worker
agentboard down        # Graceful shutdown
agentboard doctor      # Verify prerequisites (git, gh, node, claude)

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

## Architecture & Boundaries

3 layers: CLI (`src/cli/`) → Server+Worker (`src/server/`, `src/worker/`) → DB (`src/db/`)

Pipeline: backlog → ready → spec → planning → implementing ↔ checks (ralph loop) → review_panel → pr_creation → needs_human_review|done
Subtask pipeline: backlog → ready → ralph loop → done|failed (fully autonomous, no intermediate states, no review panel)

- **Stages** (`src/worker/stages/`) — spec-generator, planner, implementer, checks, review-panel, pr-creator, learner
- **Spec generation** (`src/worker/stages/spec-generator.ts`) — produces machine-verifiable acceptance criteria, file scope, out-of-scope list, and risk assessment before planning begins.
- **Ralph loop** (`src/worker/ralph-loop.ts`) — wraps implement→checks in a fresh-context-per-iteration loop. Progress persists in git + `.agentboard-progress.md`. Switches to fallback prompt on 3rd+ failure. Configurable via `config.maxRalphIterations` (default: 5).
- **Review panel** (`src/worker/stages/review-panel.ts`) — runs 3 reviewers in parallel (Architect, QA, Security) via `Promise.allSettled`. All must pass (unanimous). On failure, combined per-role feedback cycles back to the implementer. Reviewer role prompts live in `prompts/review-{architect,qa,security}.md`.
- **Auto-merge** (`src/worker/auto-merge.ts`) — evaluates whether to skip human review: requires `config.autoMerge` enabled, low risk, all reviewers pass with zero issues, no security-sensitive files touched.
- **Learning** (`src/worker/stages/learner.ts`) — records task metrics (tokens, duration, attempts, review cycles) to `.agentboard/learning-log.jsonl` after every task completes. API: `GET /api/projects/:id/learning`.
- **Model selection** (`src/worker/model-selector.ts`) — maps stages to `config.modelDefaults` keys. Review panel uses `modelDefaults.review` (Opus override for high-risk tasks).

Subtasks execute serially. First child is `ready`, rest `backlog`. Parent creates single PR after all succeed.

### Subtask pipeline gotchas

- **Subtasks are fully autonomous** — they go `ready → ralph loop → done|failed` with no intermediate states, no review panel, no auto-merge, and no human input.
- Subtasks reuse the parent's worktree and branch — they have NO git_refs of their own
- Subtasks skip PR creation — the parent creates a single PR after all subtasks complete
- Subtasks cannot be manually moved (except to cancelled), retried, or answered via the API
- The `task` object passed through the pipeline is fetched ONCE at claim time. Its `.status` becomes stale as the pipeline progresses. Functions that check `task.status` for decisions must re-fetch from DB.
- `commitChanges()` returns empty string (no-op) when there are no staged changes. Callers must handle this gracefully.
- When a subtask fails, remaining `backlog` siblings are cancelled automatically so the parent can resolve to `failed`.
- `checkAndUpdateParentStatus` is async — it triggers PR creation for the parent when all subtasks succeed. All call sites must `await` it.

See [docs/architecture/](docs/architecture/) for ADRs on key design decisions.
See [docs/gotchas/](docs/gotchas/) for known pitfalls by subsystem.

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
