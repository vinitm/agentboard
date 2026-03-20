# Source Map

> Quick orientation for agents and developers. Start with entry points, then drill into the layer you need.

## Entry Points

| Command | What runs | Entry file |
|---------|-----------|------------|
| `agentboard up` | Start server + worker | `bin/agentboard.ts` → `src/cli/up.ts` |
| `agentboard init` | Register project | `bin/agentboard.ts` → `src/cli/init.ts` |
| `agentboard down` | Graceful shutdown | `bin/agentboard.ts` → `src/cli/down.ts` |
| `agentboard doctor` | Health check | `bin/agentboard.ts` → `src/cli/doctor.ts` |
| `npm run dev` | Dev mode (tsx watch) | `bin/agentboard.ts` |
| Browser UI | React SPA | `ui/src/main.tsx` → `ui/src/App.tsx` |

## Architecture Layers

```
CLI (bin/, src/cli/)     — parse commands, start/stop server
    ↓
Server (src/server/)     — Express REST API + Socket.IO real-time events
Worker (src/worker/)     — 5s poll loop, 7-stage pipeline, Claude Code executor
    ↓
DB (src/db/)             — SQLite WAL, prepared statements, row converters
```

## Directory Structure

### `src/cli/` — CLI Commands
| File | Purpose |
|------|---------|
| `up.ts` | Start Express server + worker loop, recovery on startup |
| `down.ts` | Write shutdown signal file |
| `init.ts` | Register project in `repos.json`, scaffold `.agentboard/config.json` |
| `doctor.ts` | Verify prerequisites (git, claude, gh), list projects |
| `prune.ts` | Clean stale git worktrees |
| `paths.ts` | Resolve `~/.agentboard/` directories |

### `src/db/` — Database Layer
| File | Purpose |
|------|---------|
| `schema.ts` | DDL, 8 migration functions, `createDatabase()` |
| `queries.ts` | 150+ prepared statements for tasks, runs, events, git_refs, artifacts |
| `chat-queries.ts` | Chat message CRUD |
| `cost-queries.ts` | Token cost tracking queries |
| `stage-log-queries.ts` | Stage log CRUD + listing |
| `index.ts` | `getDatabase()` singleton factory |

### `src/server/` — HTTP + WebSocket
| File | Purpose |
|------|---------|
| `index.ts` | Express app factory, middleware, route mounting |
| `ws.ts` | Socket.IO broadcast helpers (`broadcastTaskUpdate`, `broadcastRunLog`) |
| `routes/projects.ts` | `GET/POST /api/projects` |
| `routes/tasks.ts` | Full task CRUD + state transitions (claim, review, retry, cancel) |
| `routes/chat.ts` | Chat message send + SSE streaming for spec building |
| `routes/stage-logs.ts` | Per-stage log listing + content streaming (Range support) |
| `routes/runs.ts` | Pipeline run records |
| `routes/artifacts.ts` | Generated outputs per run |
| `routes/events.ts` | Task event stream |
| `routes/config.ts` | Per-project config load/save |
| `routes/learning.ts` | Learning analytics |
| `routes/costs.ts` | Token cost data |
| `routes/logs.ts` | Legacy task log content |
| `routes/git-refs.ts` | Branch tracking |

### `src/worker/` — Autonomous Pipeline
| File | Purpose |
|------|---------|
| `loop.ts` | Main event loop (5s poll, task dispatch, stage transitions, error recovery) |
| `executor.ts` | Spawn `claude --print --json` subprocess, stream output |
| `stage-runner.ts` | Wrap stage execution (DB record, log file, Socket.IO broadcast) |
| `stage-tools.ts` | Per-stage tool presets (read-only vs full-access) |
| `context-builder.ts` | Build task packet (spec + plan + failure context) for prompts |
| `git.ts` | Worktree create/cleanup, commit, push |
| `inline-fix.ts` | Auto-fix failed checks, re-run (max 2 retries) |
| `auto-merge.ts` | Evaluate PR merge gate criteria |
| `model-selector.ts` | Stage → model mapping via config |
| `log-writer.ts` | Append-only per-stage log files |
| `recovery.ts` | Reset stale claimed tasks on startup (>30 min threshold) |
| `memory.ts` | Per-project learning memory (failure patterns, conventions) |
| `notifications.ts` | Desktop/terminal alerts |
| `hooks.ts` | Ruflo hook integration |
| `config-compat.ts` | Normalize per-project config defaults |

### `src/worker/stages/` — Pipeline Stages
| File | Stage | Tools | Purpose |
|------|-------|-------|---------|
| `spec-review.ts` | `spec_review` | Read-only | Validate spec completeness and feasibility |
| `planner.ts` | `planning` | Read-only | Generate implementation plan with steps |
| `implementer.ts` | `implementing` | Full-access | Write code in isolated worktree |
| `checks.ts` | `checks` | Full-access | Secrets scan + test/lint/format/typecheck |
| `code-quality.ts` | `code_quality` | Read-only | Single-reviewer code quality evaluation |
| `final-review.ts` | `final_review` | Read-only | Full changeset validation vs spec |
| `pr-creator.ts` | `pr_creation` | Full-access | Push branch, create GitHub PR |
| `learner.ts` | (post-task) | Read-only | Metrics collection + pattern extraction |

See [pipeline-stages.md](pipeline-stages.md) for full stage contracts.

### `src/types/index.ts` — Shared Types

```typescript
// 14 task states
type TaskStatus = 'backlog' | 'ready' | 'spec_review' | 'planning'
  | 'needs_plan_review' | 'implementing' | 'checks' | 'code_quality'
  | 'final_review' | 'pr_creation' | 'needs_human_review' | 'done'
  | 'blocked' | 'failed' | 'cancelled'

// 7 pipeline stages
type Stage = 'spec_review' | 'planning' | 'implementing' | 'checks'
  | 'code_quality' | 'final_review' | 'pr_creation'

type RiskLevel = 'low' | 'medium' | 'high'
type ImplementerStatus = 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_CONTEXT' | 'BLOCKED'
type AutoMergeMode = 'off' | 'draft-only' | 'low-risk' | 'all'
```

**Core interfaces:** `Task`, `Run`, `Artifact`, `GitRef`, `AgentboardConfig`, `PlanningResult`, `SpecReviewResult`, `CodeQualityResult`, `FinalReviewResult`

### `src/test/` — Test Helpers
| Helper | Purpose |
|--------|---------|
| `createTestDb()` | In-memory SQLite per test |
| `createTestRepo()` | Real git repo, auto-cleaned |
| `createTestApp()` | Express app with supertest |

### `ui/src/` — React + Tailwind UI
| File | Purpose |
|------|---------|
| `App.tsx` | Router + layout (Board, TaskPage, Settings, Activity, Costs, Learnings) |
| `main.tsx` | React entry point |
| `components/TaskGrid.tsx` | Kanban board (status columns) |
| `components/TaskCard.tsx` | Individual task card in column |
| `components/TaskPage.tsx` | Detail view with tabs (Activity, Stages, Chat, Artifacts, Costs) |
| `components/TaskForm.tsx` | New task creation + spec editing |
| `components/TaskSidebar.tsx` | Detail sidebar (claim, priority, risk) |
| `components/StageAccordion.tsx` | Expandable per-stage results with logs |
| `components/PipelineBar.tsx` | Visual stage progress indicator |
| `components/LogViewer.tsx` | Real-time log streaming |
| `components/ChatHistory.tsx` | Spec building chat messages |
| `components/PlanReviewPanel.tsx` | Engineer approves/edits plan |
| `components/BlockedPanel.tsx` | Blocked task details + actions |
| `components/CostDashboard.tsx` | Token usage analytics |
| `components/Learnings.tsx` | Extracted patterns + feedback |
| `components/ActivityFeed.tsx` | Global task activity stream |
| `components/Settings.tsx` | Config editor |
| `hooks/useTasks.ts` | Task state management |
| `hooks/useSocket.ts` | Socket.IO connection + event listeners |
| `api/client.ts` | `fetch()` wrapper for `/api` routes |

### `prompts/` — Prompt Templates
| File | Stage | Variables |
|------|-------|-----------|
| `brainstorming-system.md` | Chat system prompt | (none — static) |
| `brainstorming.md` | Chat user prompt | `{chatHistory}` |
| `spec-review.md` | Spec review | `{taskSpec}` |
| `planner-v2.md` | Planning | `{taskSpec}`, `{goal}` |
| `plan-review.md` | Plan self-review | `{plan}` |
| `implementer-v2.md` | Implementation | `{taskSpec}`, `{plan}`, `{failureSummary}` |
| `inline-fix.md` | Inline fix | `{failureOutput}`, `{taskSpec}` |
| `code-quality.md` | Code quality | `{diff}`, `{taskSpec}` |
| `final-review.md` | Final review | `{diff}`, `{taskSpec}`, `{plan}` |
| `learner.md` | Learning | `{executionSummary}` |

## Pipeline State Machine

```
backlog → ready → spec_review → planning → needs_plan_review → implementing → checks → code_quality → final_review → pr_creation → done
                                                                     │                        │                │
                                                                     ↓                        ↓                ↓
                                                                  blocked                   failed        needs_human_review
```

- **Auto-approval:** Low-risk tasks with high planner confidence skip `needs_plan_review`
- **Inline fix:** When `checks` fail, an inline fix is attempted before blocking
- **Quality cycles:** Up to 2 code_quality → implement fix cycles before failing
- **Final review cycles:** Up to 2 final_review → implement fix cycles before failing

## Global vs Per-Project State

| Location | Contents |
|----------|----------|
| `~/.agentboard/agentboard.db` | Shared SQLite database (all projects) |
| `~/.agentboard/server.json` | Server config (port, host, maxConcurrentTasks) |
| `~/.agentboard/repos.json` | Registry of initialized projects |
| `<repo>/.agentboard/config.json` | Per-project settings (models, commands, PR config) |
| `<repo>/.agentboard/worktrees/` | Git worktrees per task |
| `<repo>/.agentboard/logs/` | Per-stage log files |
| `<repo>/.agentboard/memory.json` | Failure patterns + conventions |
