<!-- Context budget: this file + .claude/rules/**/*.md auto-load every session.
     Target: <400 lines. Current: ~400 lines. No duplication, no linter's-job content. -->
# Agentboard

Kanban board orchestrating AI coding agents: spec → plan → review → implement → checks → code quality → final review → PR.
TypeScript, Express, SQLite, Socket.IO, React + Tailwind.

## Quick Reference

| Need to... | Go to |
|------------|-------|
| Understand the system | [Architecture](docs/architecture/agent-orchestration.md) |
| Work on a pipeline stage | [Pipeline Stages](docs/pipeline-stages.md) |
| Build UI / integrations | [API Routes](docs/api-routes.md) (includes Socket.IO events) |
| Orient in the codebase | [Source Map](docs/source-map.md) |
| Understand a past decision | [Decision Log](docs/decisions.md) → [ADR Index](docs/architecture/README.md) |
| Avoid known pitfalls | [Gotchas](docs/gotchas/README.md) |
| Write browser tests | [Browser Testing](docs/browser-testing.md) |

## Commands

```bash
# Build
npm run build            # Compile TypeScript + build React UI
npm run build:server     # TypeScript only
npm run build:ui         # React/Vite UI only
npm run dev              # Watch mode with auto-reload (tsx)
npm start                # Run compiled dist/bin/agentboard.js

# Test
npm test                 # Run backend tests
npm run test:watch       # Watch mode
npm run test:coverage    # Backend tests with coverage report
npm run test:browser     # Functional browser tests (Playwright + Lightpanda)
npm run test:visual      # Visual regression tests (Playwright + Chromium)
npm run test:visual:update  # Update visual baselines after UI changes

# CLI
agentboard init          # Initialize .agentboard/config.json in a repo
agentboard up            # Start global server + worker
agentboard down          # Graceful shutdown
agentboard doctor        # Verify prerequisites + show registered projects

# Browser Automation
npm run lightpanda:start                                        # Start Lightpanda on port 9222
npx agent-browser --cdp 9222 --json open http://localhost:3000  # Open URL
npx agent-browser --cdp 9222 --json snapshot                    # AI-optimized accessibility tree
npx agent-browser --cdp 9222 --json click @e2                   # Click element ref
```

MCP browser tools (`browser_open`, `browser_snapshot`, etc.) use `agent-browser` under the hood. `.mcp.json` sets `AGENT_BROWSER_CDP=9222`. See [browser-testing.md](docs/browser-testing.md).

## Conventions

- ES module imports with `.js` extensions (even for .ts files) — see [gotchas/imports.md](docs/gotchas/imports.md)
- snake_case DB columns → camelCase TypeScript via row-conversion functions
- Prompt templates in `prompts/` as markdown with `{variable}` interpolation
- Follow existing stage patterns in `src/worker/stages/`

## Testing

See [Testing rules](.claude/rules/common/testing.md) for test helpers and conventions. Run `npm test` before committing.

## Architecture

3 layers: CLI (`src/cli/`) → Server+Worker (`src/server/`, `src/worker/`) → DB (`src/db/`)

7-stage pipeline: spec_review → planning → implementing → checks → code_quality → final_review → pr_creation

All stages use **opus**. Learner uses **haiku**. Per-stage tool restrictions enforce read-only vs full-access.

See [Architecture](docs/architecture/agent-orchestration.md) for system design, [Pipeline Stages](docs/pipeline-stages.md) for per-stage contracts.

## Available Agents

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| brainstorming | Spec building | PM creating task specs — read-only tools (Read, Glob, Grep) |
| planner | Implementation planning | Complex features, refactoring, multi-file changes |
| architect | System design | Architectural decisions, new subsystems |
| tdd-guide | Test-driven development | New features, bug fixes |
| code-reviewer | Code review | After writing/modifying code **(MANDATORY)** |
| security-reviewer | Security analysis | Auth, user input, APIs, worker stages, DB queries, shell commands |
| build-error-resolver | Fix build errors | When `npm run build` or `npm test` fails |
| e2e-runner | E2E testing | After implementing user-facing features |
| doc-updater | Documentation | After completing features — update docs, gotchas |
| refactor-cleaner | Dead code cleanup | After refactoring — remove unused code |

## Agent Triggers

| When you modify... | You MUST run... | Why |
|--------------------|----------------|-----|
| `src/worker/stages/` | planner + architect | Pipeline changes are high-risk |
| `src/db/queries.ts` or `src/db/schema.ts` | security-reviewer | SQL injection risk |
| `prompts/` | code-reviewer | Prompt quality matters |
| New API routes | security-reviewer + code-reviewer (parallel) | Input validation + quality |
