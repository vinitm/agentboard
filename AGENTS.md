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
npm run test:browser   # Functional browser tests (Playwright + Lightpanda)
npm run test:visual    # Visual regression tests (Playwright + Chromium)
npm run test:visual:update  # Update visual baselines after UI changes
npm run lightpanda:start  # Start Lightpanda headless browser on port 9222

### CLI

agentboard init        # Initialize .agentboard/config.json in a repo
agentboard up          # Start global server + worker
agentboard down        # Graceful shutdown
agentboard doctor      # Verify prerequisites + show registered projects

### Browser Automation (agent-browser → Lightpanda CDP)

npm run lightpanda:start                                    # Start Lightpanda on port 9222
npx agent-browser --cdp 9222 --json open http://localhost:3000  # Open URL
npx agent-browser --cdp 9222 --json snapshot                # AI-optimized accessibility tree
npx agent-browser --cdp 9222 --json click @e2               # Click element ref

MCP browser tools (`browser_open`, `browser_snapshot`, etc.) use `agent-browser` under the hood.
`.mcp.json` sets `AGENT_BROWSER_CDP=9222` and adds `node_modules/.bin` to PATH.
See [docs/browser-testing.md](docs/browser-testing.md) for full setup.

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
- Don't commit directly to master — feature branches per task (enforced by pre-bash hook)
- Don't hardcode model names — use config.modelDefaults and model-selector.ts
- Don't create new DB connections — use `getDatabase()` singleton
- Don't skip workflow steps without explicit user approval
- Don't commit without `npm test` and `npm run build` passing
- Don't skip learning capture after significant tasks

## Workflow (Mandatory)

Every task follows: **Research → Plan → Branch → TDD → Review → Learn → Commit**
Branch creation is deferred to implementation — no branch during research/planning.
Commits to master are blocked by hook. See [development-workflow.md](.claude/rules/common/development-workflow.md) for full details (auto-loaded).

### Quick Checklist
- [ ] Searched for existing solutions (codebase, npm, GitHub)
- [ ] Plan created and user-approved (use **planner** agent)
- [ ] Feature branch created before first code change (`agentboard/<task-slug>`)
- [ ] Tests written first, all passing (`npm test`)
- [ ] **code-reviewer** agent run (MANDATORY)
- [ ] **security-reviewer** run if touching auth/APIs/DB/worker
- [ ] Build passes (`npm run build`)
- [ ] Patterns captured (`agentdb_pattern_store`, skill files)
- [ ] Decision log updated if architectural choices made

### Backpressure — Stop and Ask When:
- Change touches >5 unexpected files
- Adding a new dependency
- Modifying worker loop polling or stage ordering
- Tests fail after 3 attempts
- Changing the pipeline state machine

## References

### Architecture
- [Agent Orchestration](docs/architecture/agent-orchestration.md) — full system design, pipeline state machine, stage contracts, DB schema
- [ADR Index](docs/architecture/README.md) — why key decisions were made (8 ADRs)
- [Decision Log](docs/decisions.md) — quick-reference decision diary (complements ADRs)

### Codebase Reference (load on demand)
- [Source Map](docs/source-map.md) — directory structure, key types, pipeline state machine
- [API Routes](docs/api-routes.md) — all REST endpoints

### Gotchas (failure-backed)
- [Index](docs/gotchas/README.md) — selection criteria and file list
- [Imports](docs/gotchas/imports.md) | [Worker](docs/gotchas/worker.md) | [Subtasks](docs/gotchas/subtasks.md) | [Database](docs/gotchas/database.md)

### Ruflo (enabled by default)
- [Ruflo Setup](docs/ruflo-setup.md) — hooks, memory, daemon, neural models, debugging
- Config: `ruflo.enabled` in `.agentboard/config.json` (set `false` to disable)

### Rules (auto-loaded per task)
- [.claude/rules/common/](.claude/rules/common/) — coding style, git, security, testing, workflow, hooks, learning
- [.claude/rules/typescript/](.claude/rules/typescript/) — TS patterns, style, security

### Pipeline
- [prompts/](prompts/) — one prompt template per pipeline stage
- [src/types/index.ts](src/types/index.ts) — all shared interfaces
