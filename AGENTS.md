# Agentboard

Self-hosted Kanban board that orchestrates AI coding agents through a pipeline:
planning → implementation → checks → review → PR creation.
Built with TypeScript, Express, SQLite, Socket.IO, React + Tailwind.

## Commands

npm run build          # Compile TypeScript + build React UI
npm run build:server   # TypeScript only
npm run build:ui       # React/Vite UI only
npm run dev            # Watch mode with auto-reload (tsx)
npm start              # Run compiled dist/bin/agentboard.js

# CLI
agentboard init        # Initialize .agentboard/ config in a repo
agentboard up          # Start server + worker
agentboard down        # Graceful shutdown
agentboard doctor      # Verify prerequisites (git, gh, node, claude)

## Do

- Use ES module imports with `.js` extensions (even for .ts files)
- Use `console.log` with bracketed prefixes for logging: `[worker]`, `[http]`, `[recovery]`
- Use prepared statements for all DB queries (see src/db/queries.ts)
- Convert DB rows from snake_case to camelCase via row conversion functions
- Use `execFile` (promisified) for shell commands, never `exec`
- Keep prompt templates in `prompts/` as markdown files
- Follow existing stage patterns in `src/worker/stages/` when adding pipeline stages

## Don't

- Don't use `any` — strict TypeScript throughout
- Don't add dependencies without discussion
- Don't modify the worker loop's 5-second polling interval or stage ordering without understanding the full pipeline
- Don't commit directly to master — agentboard creates feature branches per task
- Don't hardcode model names — use config.modelDefaults and model-selector.ts

## Architecture

The system has 3 layers: CLI → Server+Worker → Database.

- **CLI** (`src/cli/`) — Commands: init, up, down, doctor
- **Server** (`src/server/`) — Express API + Socket.IO for real-time UI updates
- **Worker** (`src/worker/loop.ts`) — Polls DB every 5s, claims ready tasks, runs them through 6 stages
- **Stages** (`src/worker/stages/`) — planner, implementer, checks, review-spec, review-code, pr-creator
- **DB** (`src/db/`) — SQLite with WAL mode. Schema in schema.ts, queries in queries.ts
- **UI** (`ui/`) — React + Tailwind + Radix UI + dnd-kit. Vite build, Socket.IO for live updates
- **Types** (`src/types/index.ts`) — All shared interfaces and type unions

### Pipeline flow

backlog → ready → planning → implementing → checks → review_spec → review_code → pr_creation → needs_human_review → done

Subtasks execute serially: first child is `ready`, rest are `backlog`. On completion, next sibling is promoted.

## Gotchas

- Imports MUST use `.js` extension (NodeNext module resolution) even for TypeScript files
- The worker spawns Claude Code via `claude --print --permission-mode acceptEdits` — changes to executor.ts affect all agent runs
- DB uses a singleton pattern (`getDatabase()`) — don't create new connections
- Worktrees live in `.agentboard/worktrees/` — subtasks share their parent's worktree
- Recovery resets tasks claimed >30 minutes ago — keep this in mind when debugging long-running tasks
- No test suite exists yet — verify changes manually via `npm run dev` + `agentboard up`
