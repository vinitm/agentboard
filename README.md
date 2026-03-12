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

| Field            | Default    | Description                        |
| ---------------- | ---------- | ---------------------------------- |
| `planning`       | `"sonnet"` | Model for the planning stage       |
| `implementation` | `"opus"`   | Model for the implementation stage |
| `reviewSpec`     | `"sonnet"` | Model for spec review              |
| `reviewCode`     | `"sonnet"` | Model for code review              |
| `security`       | `"haiku"`  | Model for security checks          |

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

### Pipeline Stages

Each task flows through a structured pipeline:

```
Backlog -> Ready -> Planning -> Implementing -> Checks -> Review: Spec -> Review: Code -> PR Creation -> Needs Human Review -> Done
```

1. **Backlog**: Tasks waiting to be specified. Add a spec to move to Ready.
2. **Ready**: Tasks queued for the worker to pick up.
3. **Planning**: The agent analyzes the spec, may decompose into subtasks or ask clarifying questions (task becomes Blocked).
4. **Implementing**: The agent writes code in an isolated git worktree.
5. **Checks**: Automated checks run (test, lint, format, typecheck, security). On failure, retries implementation up to `maxAttemptsPerTask` times.
6. **Review: Spec**: Agent reviews implementation against the original spec.
7. **Review: Code**: Agent reviews code quality. If review fails, cycles back to implementation (up to `maxReviewCycles`).
8. **PR Creation**: Agent pushes the branch and creates a GitHub PR.
9. **Needs Human Review**: A human reviews the PR. Click "Mark as Done" to complete.
10. **Done**: Task is complete. Worktree is cleaned up.

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
| GET    | `/api/runs?taskId=...`       | List runs for a task                 |
| GET    | `/api/artifacts?runId=...`   | List artifacts for a run             |
| GET    | `/api/config`                | Get current configuration            |
| PUT    | `/api/config`                | Update configuration (partial merge) |
| GET    | `/api/events?taskId=...`     | List events for a task               |

## How the Agent Pipeline Works

1. **Task Creation**: Create a task in Backlog, write a spec, then move it to Ready.
2. **Planning**: The worker picks up Ready tasks, creates a git worktree, and runs the planning stage. The planner may ask clarifying questions (blocking the task) or decompose into subtasks.
3. **Implementation with Retries**: The agent writes code. If checks fail, it retries with the error output as context, up to `maxAttemptsPerTask` times.
4. **Checks**: After each implementation attempt, automated checks (test, lint, format, typecheck, security) run. Formatting issues can be auto-fixed.
5. **Reviews**: Spec review ensures the implementation matches requirements. Code review checks quality. Failed reviews cycle back to implementation, up to `maxReviewCycles` times.
6. **PR Creation**: The agent pushes the branch and creates a GitHub PR (draft by default).
7. **Human Review**: The task moves to "Needs Human Review". A human reviews the PR on GitHub and marks the task as Done in the UI.

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
