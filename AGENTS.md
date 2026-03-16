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

Pipeline: backlog → ready → planning → implementing → checks → review_panel → pr_creation → needs_human_review → done

Subtasks execute serially. First child is `ready`, rest `backlog`. Parent creates single PR after all succeed.

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
