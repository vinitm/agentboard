# Agentboard Testing Strategy

**Date:** 2026-03-16
**Status:** Approved

## Overview

Comprehensive testing strategy for agentboard covering backend, frontend, and E2E tests using a vertical-slice approach. Each slice delivers unit + integration + E2E confidence for one area before moving to the next.

**Goals:** Refactoring confidence, regression prevention, developer onboarding (tests as documentation).

## Test Frameworks & Dependencies

| Tool | Purpose |
|------|---------|
| Vitest | Backend + UI test runner |
| @vitest/coverage-v8 | Code coverage |
| supertest | HTTP route testing |
| @testing-library/react | React component testing |
| @testing-library/jest-dom | DOM assertion matchers |
| Playwright | E2E browser tests |

## Project Setup

### Two Vitest Configs

- **Root `vitest.config.ts`** — backend tests in `src/**/*.test.ts`, Node environment, in-memory SQLite and temp git repos per test.
- **`ui/vitest.config.ts`** — frontend tests in `ui/src/**/*.test.tsx`, jsdom environment, React Testing Library.

### Playwright Config

- **`playwright.config.ts`** at root, tests in `e2e/**/*.spec.ts`.

### Test Helpers (`src/test/helpers.ts`)

- `createTestDb()` — fresh in-memory SQLite database with schema applied, isolated per test.
- `createTestRepo()` — temp directory with `git init`, auto-cleaned after test.
- `mockExecutor()` — stubs `executor.ts` to return configurable Claude CLI responses without spawning processes.
- `mockGhCli()` — stubs `gh` command responses.

### npm Scripts

```
"test"           → vitest run
"test:watch"     → vitest watch
"test:ui"        → vitest run --config ui/vitest.config.ts
"test:e2e"       → playwright test
"test:all"       → runs all three
"test:coverage"  → vitest run --coverage
```

### Directory Structure

Tests are co-located with source files:

```
src/
  test/
    helpers.ts              # Shared test utilities
  db/
    queries.test.ts
    schema.test.ts
  worker/
    model-selector.test.ts
    memory.test.ts
    context-builder.test.ts
    executor.test.ts
    git.test.ts
    recovery.test.ts
    hooks.test.ts
    loop.test.ts
    stages/
      planner.test.ts
      implementer.test.ts
      checks.test.ts
      review-spec.test.ts
      review-code.test.ts
      pr-creator.test.ts
  detect/
    language.test.ts
    commands.test.ts
  cli/
    init.test.ts
    doctor.test.ts
    up.test.ts
    down.test.ts
  server/
    ws.test.ts
    routes/
      projects.test.ts
      tasks.test.ts
      runs.test.ts
      artifacts.test.ts
      events.test.ts
      config.test.ts
ui/
  src/
    components/
      Board.test.tsx
      TaskCard.test.tsx
      TaskDetail.test.tsx
      SubtaskCards.test.tsx
e2e/
  pipeline.spec.ts
  subtasks.spec.ts
  board-interactions.spec.ts
  error-handling.spec.ts
  fixtures/
    mock-claude
    mock-gh
  globalSetup.ts
```

## Slice 1: Database Layer

### `src/db/schema.test.ts`

- Schema creates all 7 tables (projects, tasks, runs, artifacts, git_refs, events)
- Indexes exist
- WAL mode is enabled
- Foreign keys are enforced

### `src/db/queries.test.ts`

**Row converters** (8 functions):
- Verify snake_case to camelCase mapping for each entity type (Project, Task, Run, Artifact, GitRef, Event)
- Test with null/optional fields
- Test with all fields populated

**CRUD operations** (24+ query functions, grouped by entity):

- **Projects:** create, get, list, update, delete lifecycle; `getByPath` uniqueness; duplicate path rejection
- **Tasks:** create, get, list, update, delete; `listByStatus` filtering; `claim`/`unclaim` atomicity; `move` column positioning; `getSubtasks` parent-child; `getNextBacklogSubtask` sibling ordering
- **Runs:** create, get, list; `listByTask` filtering; `getLatestByTaskAndStage` ordering; cursor pagination
- **Artifacts:** create, list by run; cascade delete with run
- **GitRefs:** create, get, update status transitions; cleanup
- **Events:** create, list by task/project; cursor pagination; payload JSON round-trip

**Edge cases:**
- Foreign key violations (task referencing non-existent project)
- Concurrent claims (two workers claiming same task)
- Empty result sets
- Large payloads in JSON fields

Each test gets a fresh in-memory database via `createTestDb()`.

## Slice 2: Worker Pipeline

### Pure logic (no mocks)

**`src/worker/model-selector.test.ts`:**
- Each stage maps to correct default model
- High-risk tasks override review stages to opus
- Unknown stages fall back gracefully

### Filesystem tests (temp dirs)

**`src/worker/memory.test.ts`:**
- Load from empty/missing file returns defaults
- Save + load round-trip preserves data
- Record failure appends to patterns list

### Real DB, mocked artifacts

**`src/worker/context-builder.test.ts`:**
- Assembles task packet with spec, file hints, failure summary
- Includes user answers from events
- Handles missing/empty planning artifacts

### Mocked process spawning

**`src/worker/executor.test.ts`:**
- Captures stdout/stderr correctly
- Timeout kills process after configured duration
- Parses token usage from Claude output
- Handles non-zero exit codes

### Real git repos in temp dirs

**`src/worker/git.test.ts`:**
- `createWorktree()` creates directory and branch
- `cleanupWorktree()` removes worktree and branch
- `commitChanges()` stages and commits files
- Handles already-existing branch names

### Real DB, mocked time

**`src/worker/recovery.test.ts`:**
- Tasks claimed >30 min ago get unclaimed
- Tasks claimed <30 min ago are untouched
- Stalled subtask chains promote next sibling

### Hook execution

**`src/worker/hooks.test.ts`:**
- Hooks execute in order (beforeStage, stage, afterStage)
- onError hook fires on stage failure
- Missing hooks are no-ops

### Stage tests (`src/worker/stages/*.test.ts`) — real DB, mocked executor

- **planner:** Loads prompt template, parses JSON output, creates run + artifacts
- **implementer:** Includes failure summary on retry, uses opus model
- **checks:** All 8 secret patterns detected; test/lint/format commands executed; auto-fix creates commit
- **review-spec:** Parses pass/fail + issues list
- **review-code:** High-risk tasks use opus; parses verdict
- **pr-creator:** Constructs correct `gh pr create` args; adds labels

### Worker loop

**`src/worker/loop.test.ts`** — real DB, mocked executor + git:
- Claims ready task and advances through stages
- Skips when no ready tasks
- Subtask promotion: child done, next sibling ready
- Parent marked done when all children terminal
- Failed child stops sibling promotion

## Slice 3: API Routes & Server

**Approach:** Vitest + supertest for real HTTP requests against Express, backed by in-memory SQLite. Socket.IO broadcasts are spied on.

**Test helper:** `createTestApp()` — spins up Express + Socket.IO with fresh test DB, returns `{ app, io, db }`.

### Route tests

**`src/server/routes/projects.test.ts`:**
- `POST /` creates project, returns it, broadcasts event
- `GET /` lists all projects
- `GET /:id` returns project; 404 for unknown ID
- `PUT /:id` updates fields, broadcasts event
- Duplicate path returns 400

**`src/server/routes/tasks.test.ts`:**
- `POST /` creates task with valid project, broadcasts event
- `GET /` lists tasks filtered by projectId and optional status
- `GET /:id` returns task with subtasks; 404 for unknown
- `PUT /:id` updates status, broadcasts event
- `DELETE /:id` removes task
- Subtask terminal status: promote sibling, update parent
- `POST /parse` — mocked Claude response returns parsed task fields

**`src/server/routes/runs.test.ts`:**
- List runs by task
- Get run detail with artifacts

**`src/server/routes/artifacts.test.ts`:**
- List artifacts by run

**`src/server/routes/events.test.ts`:**
- List events with cursor pagination
- Filter by project

**`src/server/routes/config.test.ts`:**
- Returns config JSON

### WebSocket tests

**`src/server/ws.test.ts`:**
- `broadcast()` emits to all connected clients
- `broadcastLog()` streams chunked output

## Slice 4: Detection Logic

**`src/detect/language.test.ts`** — real temp directories with fixture files:
- Detects TypeScript when `tsconfig.json` exists
- Detects Python when `requirements.txt` or `pyproject.toml` exists
- Detects Go when `go.mod` exists
- Detects multiple languages simultaneously
- Returns empty for bare directory

**`src/detect/commands.test.ts`** — real temp directories with fixture `package.json`:
- Extracts test command from `package.json` scripts
- Extracts lint, format, typecheck, security commands
- Falls back to defaults (eslint, prettier) when scripts are absent
- Handles missing `package.json` gracefully

## Slice 5: CLI

**`src/cli/init.test.ts`** — real temp git repos:
- Creates `.agentboard/` directory structure
- Generates `config.json` with detected languages and commands
- Fails gracefully outside a git repo
- Skips re-init if `.agentboard/` already exists

**`src/cli/doctor.test.ts`** — mocked `which`/`execFile` lookups:
- Reports all green when git, gh, node, claude are present
- Reports specific missing tool with actionable message

**`src/cli/up.test.ts` and `src/cli/down.test.ts`** — lighter coverage:
- `up` starts server and worker
- `down` sends graceful shutdown, waits for in-flight tasks

## Slice 6: React UI Components

**Framework:** Vitest + React Testing Library + jsdom.

**`ui/src/components/Board.test.tsx`:**
- Renders columns for each pipeline status
- Displays tasks in correct columns
- Drag-and-drop moves task between columns (mock dnd-kit events)

**`ui/src/components/TaskCard.test.tsx`:**
- Renders title, status, risk level
- Click opens task detail
- Shows subtask count badge when subtasks exist
- Copy button copies task ID

**`ui/src/components/TaskDetail.test.tsx`:**
- Renders full task info (description, spec, runs, artifacts)
- Status transitions via buttons
- Displays run history with stage labels

**`ui/src/components/SubtaskCards.test.tsx`:**
- Renders mini-cards for each subtask
- Shows failure state visually
- Links to subtask detail

**Socket.IO integration:**
- Mock `socket.io-client` — verify components update on incoming events
- Board re-renders when task status changes arrive via websocket

**API calls:**
- Mock `fetch` — verify correct endpoints called on user actions
- Loading and error states render correctly

## Slice 7: E2E Tests with Playwright

**Setup:** Real agentboard server against temp SQLite, Claude CLI and `gh` mocked via stub scripts on `$PATH`.

**`e2e/pipeline.spec.ts`:**
- Create a project, verify it appears on the board
- Create a task, verify it lands in backlog column
- Move task to ready, worker picks it up and progresses through stages
- Verify stage transitions visible in real-time via Socket.IO
- Task reaches `needs_human_review`, verify PR link displayed
- Mark done, task moves to done column

**`e2e/subtasks.spec.ts`:**
- Create parent task with subtasks
- First subtask activates, rest stay in backlog
- Complete subtask, next sibling promotes
- All subtasks done, parent status updates

**`e2e/board-interactions.spec.ts`:**
- Drag task between columns
- Open task detail panel
- Copy buttons work

**`e2e/error-handling.spec.ts`:**
- Stage failure shows failed state with error details
- Recovery after stale claim

**Test infrastructure:**
- `e2e/fixtures/mock-claude` — shell script returning canned JSON per stage
- `e2e/fixtures/mock-gh` — shell script faking PR creation
- `globalSetup.ts` — starts server, seeds test project, tears down after suite

## CLAUDE.md Updates

Add a `## Testing` section:

```markdown
## Testing

npm test               # Run backend tests
npm run test:watch     # Watch mode
npm run test:ui        # Run React component tests
npm run test:e2e       # Run Playwright E2E tests
npm run test:all       # Run all test suites
npm run test:coverage  # Backend tests with coverage report

### Writing tests

- Co-locate tests with source: `foo.ts` → `foo.test.ts`, `Bar.tsx` → `Bar.test.tsx`
- Use `createTestDb()` from `src/test/helpers.ts` for a fresh in-memory database per test
- Use `createTestRepo()` for tests needing real git repos (auto-cleaned)
- Use `mockExecutor()` to stub Claude CLI responses
- Use `mockGhCli()` to stub GitHub CLI responses
- Backend tests run in Node environment, UI tests in jsdom
- E2E tests live in `e2e/` and use Playwright with mock CLI scripts
- Always run `npm test` before committing to verify nothing is broken
```

## Implementation Order

| Priority | Slice | Area | Dependencies |
|----------|-------|------|-------------|
| 1 | Infrastructure | Vitest configs, helpers, npm scripts | vitest, supertest, RTL, Playwright |
| 2 | Slice 1 | Database (schema + queries) | Infrastructure |
| 3 | Slice 2 | Worker pipeline | Infrastructure + Slice 1 patterns |
| 4 | Slice 3 | API routes + Socket.IO | Infrastructure + Slice 1 patterns |
| 5 | Slice 4 | Detection logic | Infrastructure |
| 6 | Slice 5 | CLI commands | Infrastructure + Slice 4 |
| 7 | Slice 6 | React UI components | UI vitest config |
| 8 | Slice 7 | E2E flows | All backend slices |
| 9 | Docs | CLAUDE.md testing section | After all slices |
