# API Routes

> All REST endpoints and real-time events. For architecture context, see [agent-orchestration.md](architecture/agent-orchestration.md).

## Contents

- [Tasks](#tasks)
- [Chat (Spec Building)](#chat-spec-building)
- [Pipeline Data](#pipeline-data)
- [Projects & Config](#projects--config)
- [Analytics](#analytics)
- [Real-Time Events (Socket.IO)](#real-time-events-socketio)

---

## Tasks

| Method | Path | Purpose | Request | Response |
|--------|------|---------|---------|----------|
| GET | `/api/tasks?projectId=X` | List tasks for a project | query: `projectId` | `Task[]` |
| POST | `/api/tasks` | Create a new task | `{ projectId, title, description?, spec? }` | `Task` |
| PATCH | `/api/tasks/:id` | Update task fields | `{ status?, spec?, title?, description?, riskLevel?, priority? }` | `Task` |
| DELETE | `/api/tasks/:id` | Delete a task | — | `204` |
| POST | `/api/tasks/parse` | AI-parse description into structured task | `{ description, projectId }` | `{ title, spec }` |
| POST | `/api/tasks/:id/move` | Reorder task within column | `{ position }` | `200` |
| POST | `/api/tasks/:id/review` | Submit plan review (approve/reject) | `{ approved: boolean, feedback? }` | `Task` |
| POST | `/api/tasks/:id/unblock` | Unblock a blocked task | `{ answers }` | `Task` |
| POST | `/api/tasks/:id/cancel` | Cancel a task | — | `Task` |
| POST | `/api/tasks/:id/retry` | Retry a failed task | — | `Task` |

**Notes:**
- `:id` is an integer (returns `400` for non-numeric IDs)
- `spec` is a JSON string with fields: `goal`, `userScenarios`, `successCriteria`, `constraints`, `outOfScope`, `verificationStrategy`

## Chat (Spec Building)

| Method | Path | Purpose | Request | Response |
|--------|------|---------|---------|----------|
| GET | `/api/tasks/:id/chat` | Get chat message history | — | `ChatMessage[]` |
| POST | `/api/tasks/:id/chat` | Send chat message (SSE stream) | `{ content }` | SSE stream |

**SSE stream format** (`POST /api/tasks/:id/chat`):

```
event: text_delta
data: {"content": "chunk of response text"}

event: spec_updates
data: {"goal": "...", "successCriteria": "...", "isComplete": false}

event: done
data: {"sessionId": "..."}

event: error
data: {"message": "error description"}
```

The chat endpoint uses Claude Code's `--session-id` / `--resume` for session persistence. Session ID is stored on `tasks.chat_session_id`.

## Pipeline Data

### Runs

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| GET | `/api/runs?taskId=X` | List runs for a task | `Run[]` |

Each `Run` records one stage execution: `{ id, taskId, stage, status, attempt, tokensUsed, modelUsed, input, output, startedAt, finishedAt }`.

### Stage Logs

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| GET | `/api/tasks/:id/stages` | List stage executions for a task | `StageLog[]` |
| GET | `/api/tasks/:id/stages/:logId/logs` | Stream stage log content | `text/plain` |

**Stage log entry:**
```typescript
{
  id: string,
  taskId: number,
  stage: string,
  attempt: number,
  status: 'running' | 'completed' | 'failed' | 'skipped',
  summary: string | null,
  tokensUsed: number | null,
  durationMs: number | null,
  startedAt: string,
  completedAt: string | null
}
```

**Log content streaming** supports HTTP Range requests:
```bash
# Full log
curl http://localhost:4200/api/tasks/42/stages/sl-001/logs

# Partial (for tailing)
curl -H "Range: bytes=1000-" http://localhost:4200/api/tasks/42/stages/sl-001/logs
# Returns 206 Partial Content
```

### Artifacts

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| GET | `/api/artifacts?runId=X` | List artifacts for a run | `Artifact[]` |

Artifacts include specs, plans, review results, PR URLs.

### Events

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| GET | `/api/events?taskId=X` | List events for a task | `Event[]` |

## Projects & Config

| Method | Path | Purpose | Request | Response |
|--------|------|---------|---------|----------|
| GET | `/api/projects` | List registered projects | — | `Project[]` |
| POST | `/api/projects` | Register a project | `{ path, name? }` | `Project` |
| GET | `/api/projects/:id/config` | Get project config | — | `AgentboardConfig` |
| PATCH | `/api/projects/:id/config` | Update project config | Partial `AgentboardConfig` | `AgentboardConfig` |

## Analytics

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| GET | `/api/projects/:id/learning` | Learning analytics | Aggregated metrics from `learning-log.jsonl` |
| GET | `/api/projects/:id/costs` | Token cost data | Cost breakdown by stage/model |
| GET | `/api/logs/:taskId` | Legacy task log content | `text/plain` |

---

## Real-Time Events (Socket.IO)

The server broadcasts events via Socket.IO. The UI connects automatically — no polling needed.

### Task Events

| Event | Payload | When |
|-------|---------|------|
| `task:created` | `{ task: Task }` | New task created |
| `task:updated` | `{ taskId, status, ...fields }` | Task status or fields changed |
| `task:event` | `{ type, payload }` | Stage milestones (see event types below) |

### Pipeline Events

| Event | Payload | When |
|-------|---------|------|
| `run:log` | `{ taskId, runId, stage, chunk, timestamp }` | Claude Code output chunks (real-time streaming) |
| `stage:transition` | `{ taskId, stage, status, summary?, durationMs?, tokensUsed? }` | Stage starts (`running`) or completes (`completed`/`failed`) |

### Task Event Types (via `task:event`)

| Type | Meaning |
|------|---------|
| `status_changed` | Task moved to a new pipeline state |
| `spec_generated` | Spec finalized from chat |
| `assumptions_made` | Planner stated assumptions |
| `checks_passed` | All checks passed |
| `checks_failed` | One or more checks failed |
| `inline_fix_applied` | Auto-fix attempted for failed checks |
| `code_quality_passed` | Code quality review passed |
| `code_quality_failed` | Code quality review found issues |
| `final_review_completed` | Final review finished |
| `pr_created` | GitHub PR created |
| `auto_merged` | Auto-merge gate passed |
| `task_error` | Unrecoverable error |
