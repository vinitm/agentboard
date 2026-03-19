# Agentboard

Kanban board orchestrating AI coding agents: spec → plan → review → implement → checks → code quality → final review → PR.
TypeScript, Express, SQLite, Socket.IO, React + Tailwind.

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
npm run test:browser   # Browser tests (Playwright + Lightpanda)
npm run lightpanda:start  # Start Lightpanda headless browser on port 9222

### CLI

agentboard init        # Initialize .agentboard/config.json in a repo
agentboard up          # Start global server + worker
agentboard down        # Graceful shutdown
agentboard doctor      # Verify prerequisites + show registered projects

## Conventions

- ES module imports with `.js` extensions (even for .ts files)
- `console.log` with bracketed prefixes: `[worker]`, `[http]`, `[recovery]`
- Prepared statements for all DB queries via `src/db/queries.ts`
- snake_case DB columns → camelCase TypeScript via row-conversion functions
- `execFile` (promisified) for shell commands, never `exec`
- Prompt templates in `prompts/` as markdown files
- Follow existing stage patterns in `src/worker/stages/`

## Testing

- Co-locate: `foo.ts` → `foo.test.ts`, `Bar.tsx` → `Bar.test.tsx`
- `createTestDb()` from `src/test/helpers.ts` for in-memory DB per test
- `createTestRepo()` for tests needing real git repos (auto-cleaned)
- `createTestApp()` for API route tests with supertest
- Run `npm test` before committing

## Architecture

3 layers: CLI (`src/cli/`) → Server+Worker (`src/server/`, `src/worker/`) → DB (`src/db/`)

See [docs/architecture/agent-orchestration.md](docs/architecture/agent-orchestration.md) for the full system design, pipeline state machine, and stage contracts.

## Available Agents

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| brainstorming | Spec building | PM creating task specs — read-only guardrails (Read, Glob, Grep only) |
| planner | Implementation planning | Complex features, refactoring, multi-file changes |
| architect | System design | Architectural decisions, new subsystems |
| tdd-guide | Test-driven development | New features, bug fixes |
| code-reviewer | Code review | After writing/modifying code (MANDATORY) |
| security-reviewer | Security analysis | Auth, user input, APIs, worker stages, DB queries, shell commands |
| build-error-resolver | Fix build errors | When `npm run build` or `npm test` fails |
| e2e-runner | E2E testing | After implementing user-facing features |
| doc-updater | Documentation | After completing features — update AGENTS.md, architecture docs, gotchas |
| refactor-cleaner | Dead code cleanup | After refactoring — remove unused code |

## Agent Triggers

- Modifying `src/worker/stages/` → planner + architect (pipeline changes are high-risk)
- Modifying `src/db/queries.ts` or `src/db/schema.ts` → security-reviewer (SQL injection risk)
- Modifying `prompts/` → code-reviewer (prompt quality matters)
- Adding new API routes → security-reviewer + code-reviewer in parallel

## Never Do

- Don't add dependencies without discussion
- Don't modify the worker loop's 5-second polling or stage ordering
- Don't commit directly to master — feature branches per task
- Don't hardcode model names — use config.modelDefaults and model-selector.ts
- Don't create new DB connections — use `getDatabase()` singleton

## Workflow

Interactive sessions: Research → Plan → TDD → Review → Docs & Learn → Commit
See [.claude/rules/common/development-workflow.md](.claude/rules/common/development-workflow.md) for the full process.

## References

### Architecture
- [Agent Orchestration](docs/architecture/agent-orchestration.md) — full system design, pipeline state machine, stage contracts, DB schema
- [ADR Index](docs/architecture/README.md) — why key decisions were made (8 ADRs)
- [Decision Log](docs/decisions.md) — quick-reference decision diary (complements ADRs)

### Gotchas (failure-backed)
- [Index](docs/gotchas/README.md) — selection criteria and file list
- [Imports](docs/gotchas/imports.md) | [Worker](docs/gotchas/worker.md) | [Subtasks](docs/gotchas/subtasks.md) | [Database](docs/gotchas/database.md)

### Ruflo (enabled by default)
- [Ruflo Setup](docs/ruflo-setup.md) — hooks, memory, daemon, neural models, debugging
- [Ruflo Replication](docs/ruflo-replication-guide.md) — replicate ruflo to other repos
- Config: `ruflo.enabled` in `.agentboard/config.json` (set `false` to disable)

### Rules (auto-loaded per task)
- [.claude/rules/common/](.claude/rules/common/) — coding style, git, security, testing, workflow, hooks, learning
- [.claude/rules/typescript/](.claude/rules/typescript/) — TS patterns, style, security

### Pipeline
- [prompts/](prompts/) — one prompt template per pipeline stage
- [src/types/index.ts](src/types/index.ts) — all shared interfaces
