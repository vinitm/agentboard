# ADR-002: Polling Worker Loop

## Status
Accepted

## Context
Need a mechanism to pick up `ready` tasks and process them through the pipeline. Options: message queue (Redis/RabbitMQ), database polling, filesystem watches, pub/sub.

## Decision
Poll the DB every 5 seconds via a `setTimeout`-based loop in `src/worker/loop.ts`.

- Tasks are atomically claimed via `claimTask()` — a conditional UPDATE on `claimed_at IS NULL` (optimistic locking)
- An `activeTasks` counter enforces `config.maxConcurrentTasks`
- Event-driven wake-up: the loop listens for `task:ready` events on an `EventEmitter`, allowing immediate subtask promotion without waiting for the next poll
- Graceful shutdown: `stop()` sets `running = false`, then polls up to 30s waiting for `activeTasks` to drain

For the full worker architecture, concurrency model, and task processing flow, see [Agent Orchestration → System Overview](agent-orchestration.md#system-overview).

## Consequences

### Positive
- No external dependencies (no Redis, no RabbitMQ)
- Simple to reason about and debug
- Graceful shutdown with drain timeout
- Event-driven wake-up eliminates most of the polling latency for subtask chains

### Negative
- 0–5s latency between a task becoming `ready` and being claimed (mitigated by wake-up events)
- Polling interval is a tuning parameter — too fast wastes CPU, too slow delays tasks

### Risks
- The 5-second interval is hardcoded (`POLL_INTERVAL_MS = 5_000`) — changing it requires understanding the full pipeline's timing assumptions

See also: [Worker Gotchas](../gotchas/worker.md)
