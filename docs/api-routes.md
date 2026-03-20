# API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/projects` | List registered projects |
| POST | `/api/projects` | Register a project |
| GET | `/api/tasks?projectId=X` | List tasks for a project |
| POST | `/api/tasks` | Create a new task |
| PATCH | `/api/tasks/:id` | Update task (status, spec, etc.) |
| DELETE | `/api/tasks/:id` | Delete a task |
| POST | `/api/tasks/parse` | AI-parse description into structured task |
| POST | `/api/tasks/:id/move` | Reorder task within column |
| POST | `/api/tasks/:id/review` | Submit plan review (approve/reject) |
| POST | `/api/tasks/:id/unblock` | Unblock a task (provide answers) |
| POST | `/api/tasks/:id/cancel` | Cancel a task |
| POST | `/api/tasks/:id/retry` | Retry a failed task |
| GET | `/api/tasks/:id/chat` | Get chat messages |
| POST | `/api/tasks/:id/chat` | Send chat message |
| GET | `/api/tasks/:id/stages` | List stage logs |
| GET | `/api/tasks/:id/stages/:logId/logs` | Stream stage log content |
| GET | `/api/runs?taskId=X` | List runs for a task |
| GET | `/api/artifacts?runId=X` | List artifacts for a run |
| GET | `/api/events?taskId=X` | List events for a task |
| GET | `/api/projects/:id/config` | Get project config |
| PATCH | `/api/projects/:id/config` | Update project config |
| GET | `/api/projects/:id/learning` | Get learning analytics |
| GET | `/api/projects/:id/costs` | Get token cost data |
| GET | `/api/logs/:taskId` | Get task log content |
