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

Pipeline: backlog → ready → spec_review → planning → needs_plan_review → implementing → [per-subtask: implement → checks → code_quality] → final_review → pr_creation → needs_human_review|done
Subtask: backlog → ready → implement → checks → (inline fix) → code_quality → done|failed|blocked

Subtasks execute serially. Parent creates single PR after all succeed.
See [docs/architecture/agent-orchestration.md](docs/architecture/agent-orchestration.md) for full architecture.

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
See `.claude/rules/common/development-workflow.md` for details.
Architectural decisions → [docs/decisions.md](docs/decisions.md)

## Ruflo Integration

Ruflo hooks fire automatically via Claude Code settings.json. No manual steps needed.

### Automatic (via hooks)
- **SessionStart:** Restores session context, checks pretrain freshness
- **UserPromptSubmit:** Routes task to optimal agent + model
- **PostToolUse:** Learns from edit/command outcomes
- **Stop:** Saves session, exports memory, persists patterns
- **PreCompact:** Checkpoints before context compaction

### Before starting work
- `memory_search(query)` — check for existing patterns/gotchas
- `agentdb_hierarchical-recall(namespace)` — recall subsystem-specific knowledge
- `guidance retrieve` — get task-relevant AGENTS.md shards
- `hooks_route(task)` — optimal agent suggestion
- `hooks_model-route(task)` — optimal model (haiku/sonnet/opus)

### After completing work
- `hooks_post-task(taskId, success)` — record outcome for learning
- `analyze_diff(ref)` — risk assessment before PR
- `memory_store(key, value)` — persist new gotchas/patterns
- `aidefence_scan(input)` — scan for security issues in generated code

### For complex tasks
- `workflow_run(template: "feature-implementation")` — full pipeline
- `workflow_run(template: "bug-fix")` — diagnose → fix → verify
- `workflow_run(template: "security-audit")` — full security scan

### Cross-device sync
- `scripts/ruflo-bootstrap.sh` — bootstrap on new device from committed state
- Memory, Q-table, config, and models are committed in `.ruflo/`

## References

- [docs/architecture/](docs/architecture/) — ADRs and orchestration architecture
- [docs/gotchas/](docs/gotchas/) — Known pitfalls by subsystem
- [docs/ruflo-setup.md](docs/ruflo-setup.md) — Complete ruflo setup documentation
- [prompts/](prompts/) — Prompt templates for each pipeline stage
- [src/types/index.ts](src/types/index.ts) — All shared interfaces
