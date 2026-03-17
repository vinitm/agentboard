# Agentboard

A self-hosted Kanban board that orchestrates AI coding agents through a structured pipeline — from planning through implementation, checks, reviews, and PR creation.

## Installation

```bash
git clone <repo-url> && cd agentboard
npm install
cd ui && npm install && cd ..
npm run build
```

## Quickstart

```bash
# Navigate to your project repository
cd /path/to/your-project

# Initialize Agentboard (creates .agentboard/ with config + DB)
agentboard init

# Start the server + worker loop
agentboard up

# Open http://localhost:4200 in your browser
```

## CLI Commands

| Command            | Description                                              |
| ------------------ | -------------------------------------------------------- |
| `agentboard init`  | Detect languages/commands, create `.agentboard/` config  |
| `agentboard up`    | Start the API server, UI, and worker loop                |
| `agentboard down`  | Gracefully stop a running Agentboard instance            |
| `agentboard doctor`| Verify prerequisites (git, Node, gh CLI, API keys, etc.) |

### Options

- `agentboard up --port <number>` — Override the configured port

## Configuration Reference

`agentboard init` generates `.agentboard/config.json` with auto-detected values. All fields:

| Field                | Type     | Default                    | Description                                          |
| -------------------- | -------- | -------------------------- | ---------------------------------------------------- |
| `port`               | number   | `4200`                     | HTTP server port                                     |
| `host`               | string   | `"localhost"`              | HTTP server bind address                             |
| `maxConcurrentTasks`  | number   | `2`                        | Max tasks processed in parallel by the worker        |
| `maxAttemptsPerTask`  | number   | `10`                       | Max implementation + checks retry cycles per task    |
| `maxReviewCycles`     | number   | `3`                        | Max spec/code review cycles before forcing PR        |
| `maxSubcardDepth`     | number   | `2`                        | Max nesting depth for subtask decomposition          |
| `prDraft`             | boolean  | `true`                     | Create PRs as drafts                                 |
| `autoMerge`           | boolean  | `false`                    | Auto-merge PRs after human approval                  |
| `securityMode`        | string   | `"lightweight"`            | Security scanning mode                               |
| `commitPolicy`        | string   | `"after-checks-pass"`      | When to commit code changes                          |
| `formatPolicy`        | string   | `"auto-fix-separate-commit"` | How to handle formatting fixes                     |
| `branchPrefix`        | string   | `"agent/"`                 | Prefix for branches created by the agent             |
| `baseBranch`          | string   | `"main"`                   | Base branch for worktrees and PRs                    |
| `githubRemote`        | string   | `"origin"`                 | Git remote name for pushing branches                 |
| `prMethod`            | string   | `"gh-cli"`                 | Method used to create PRs                            |
| `modelDefaults`       | object   |                            | Model selection per stage (see below)                |
| `commands`            | object   |                            | Check commands (see below)                           |
| `notifications`       | object   |                            | Notification settings                                |
| `ruflo`               | object   |                            | Ruflo integration settings                           |

### `modelDefaults`

All stages currently use `opus` by default. The config fields are retained for future per-stage tuning:

| Field            | Default    | Description                        |
| ---------------- | ---------- | ---------------------------------- |
| `planning`       | `"opus"`   | Model for the planning stage       |
| `implementation` | `"opus"`   | Model for the implementation stage |
| `review`         | `"opus"`   | Model for code quality and final review |
| `security`       | `"opus"`   | Model for security checks          |
| `learning`       | `"haiku"`  | Model for post-task learning extraction |

### `commands`

Auto-detected check commands. Set to `null` to disable a check.

| Field        | Description                              |
| ------------ | ---------------------------------------- |
| `test`       | Run tests (e.g., `npm test`)             |
| `lint`       | Run linter (e.g., `npm run lint`)        |
| `format`     | Check formatting (e.g., `prettier --check .`) |
| `formatFix`  | Auto-fix formatting                      |
| `typecheck`  | Run type checker (e.g., `npx tsc --noEmit`) |
| `security`   | Run security audit                       |

### `notifications`

| Field      | Type    | Default | Description                   |
| ---------- | ------- | ------- | ----------------------------- |
| `desktop`  | boolean | `true`  | Desktop notifications         |
| `terminal` | boolean | `true`  | Terminal output notifications |

## Architecture Overview

For the complete agent orchestration architecture — state machine, stage details, context flow, review panel, auto-merge gate, and recovery — see [docs/architecture/agent-orchestration.md](docs/architecture/agent-orchestration.md).

### Pipeline Stages

Each task flows through a structured pipeline:

```
Backlog → Ready → Spec Review → Planning → Plan Review → Implementing
  [per-subtask: Implement → Checks → Code Quality]
  → Final Review → PR Creation → Needs Human Review → Done
```

1. **Backlog**: PM builds spec conversationally via chat UI. AI asks clarifying questions and drafts spec.
2. **Ready**: PM moves task to Ready when spec is finalized.
3. **Spec Review**: Automated gate checks spec completeness, testability, and scope.
4. **Planning**: Agent breaks the task into bite-sized TDD subtasks. Automated plan review validates before human sees it.
5. **Plan Review**: Engineer reviews and approves the plan (with optional edits) or rejects it.
6. **Implementing**: Per-subtask execution — each subtask goes through implement → checks → code quality.
7. **Code Quality**: Single reviewer checks code quality, test quality, security, and architecture per subtask.
8. **Final Review**: Holistic review of all changes with spec compliance check.
9. **PR Creation**: Agent pushes the branch and creates a GitHub PR.
10. **Needs Human Review**: A human reviews the PR. Click "Mark as Done" to complete.
11. **Done**: Task is complete. Worktree is cleaned up.

Tasks can also be **Blocked** (waiting for human input), **Failed** (max retries exhausted), or **Cancelled**.

### System Components

- **Express API Server** — REST endpoints for tasks, runs, projects, config, and events
- **WebSocket (Socket.IO)** — Real-time updates pushed to the UI
- **SQLite Database** — Persistent storage for tasks, runs, artifacts, git refs, and events
- **Worker Loop** — Background process that polls for ready tasks and orchestrates the pipeline
- **React Kanban UI** — Drag-and-drop board with task details, settings, and log viewing
- **Git Worktrees** — Each task gets an isolated worktree for parallel development

## API Routes

| Method | Route                        | Description                          |
| ------ | ---------------------------- | ------------------------------------ |
| GET    | `/api/health`                | Health check                         |
| GET    | `/api/projects`              | List projects                        |
| POST   | `/api/projects`              | Create project                       |
| GET    | `/api/tasks?projectId=...`   | List tasks for project               |
| POST   | `/api/tasks`                 | Create task                          |
| GET    | `/api/tasks/:id`             | Get task by ID                       |
| PUT    | `/api/tasks/:id`             | Update task                          |
| DELETE | `/api/tasks/:id`             | Delete task                          |
| POST   | `/api/tasks/:id/move`        | Move task to column                  |
| POST   | `/api/tasks/:id/answer`      | Answer a blocked task's questions    |
| POST   | `/api/tasks/:id/retry`       | Retry a failed task                  |
| POST   | `/api/tasks/:id/chat/stream` | SSE streaming chat for spec building |
| GET    | `/api/tasks/:id/chat/messages` | Get chat history for task          |
| GET    | `/api/runs?taskId=...`       | List runs for a task                 |
| GET    | `/api/artifacts?runId=...`   | List artifacts for a run             |
| GET    | `/api/config`                | Get current configuration            |
| PUT    | `/api/config`                | Update configuration (partial merge) |
| GET    | `/api/events?taskId=...`     | List events for a task               |

## How the Agent Pipeline Works

1. **Spec Building**: PM opens a new task and chats with AI. The AI asks clarifying questions one at a time, proposes approaches, and drafts the spec from the conversation.
2. **Spec Review**: Automated gate validates the spec is complete, testable, and well-scoped before planning begins.
3. **Planning**: The agent breaks the task into bite-sized TDD subtasks with exact file paths and code snippets. An automated plan reviewer validates before the engineer sees it.
4. **Plan Review**: Engineer reviews the plan, approves (with optional edits) or rejects (with feedback for re-planning).
5. **Per-Subtask Execution**: Each subtask gets a single implementation attempt. If checks fail, one inline fix attempt. If that fails, the task is blocked for human intervention.
6. **Code Quality Review**: After each subtask passes checks, a single reviewer evaluates code quality, test quality, security, and architecture.
7. **Final Review**: After all subtasks complete, a holistic review checks cross-file consistency, integration, and spec compliance.
8. **PR Creation**: The agent pushes the branch and creates a GitHub PR (draft by default).
9. **Human Review**: The task moves to "Needs Human Review". A human reviews the PR on GitHub and marks the task as Done in the UI.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes
4. Run checks: `npm run build && cd ui && npm run typecheck`
5. Submit a pull request

### Development

```bash
# Start the backend in dev mode (auto-reload)
npm run dev

# Start the UI dev server (in a separate terminal)
cd ui && npm run dev
```

The UI dev server proxies API requests to `localhost:4200`.
