# Architecture

## System Architecture

**[Agent Orchestration](agent-orchestration.md)** — the single comprehensive architecture document covering:
- System overview (UI → API → Worker → Executor → Worktrees)
- Task state machine (14 states, subtask pipeline)
- All 9 pipeline stages (spec-review → planning → per-subtask implementation → code-quality → final-review → PR creation → auto-merge → learner)
- Claude Code executor (spawn model, streaming, token tracking)
- Model selection (stage-to-model mapping)
- Git worktree isolation
- Context flow between stages (task packet)
- Real-time Socket.IO event model
- Task logging format
- Recovery & crash handling
- Worker memory
- Database schema

Start here for understanding how agentboard works.

## Architecture Decision Records

ADRs capture the "why" behind key choices — context not inferable from code. Each links back to the relevant section of the orchestration doc for full detail.

| ADR | Decision | Status |
|-----|----------|--------|
| [001-sqlite-wal](001-sqlite-wal.md) | Use SQLite with WAL mode as the sole persistence layer | Accepted |
| [002-polling-worker](002-polling-worker.md) | Poll-based worker loop with event-driven wake-up | Accepted |
| [003-worktree-isolation](003-worktree-isolation.md) | Git worktrees for task isolation, shared by subtasks | Accepted |
| [004-serial-subtasks](004-serial-subtasks.md) | Serial subtask execution with single parent PR | Accepted |
| [005-model-selection](005-model-selection.md) | Stage-and-risk-driven model selection | Superseded (opus everywhere) |
| [006-claude-code-executor](006-claude-code-executor.md) | Spawn Claude Code as child process in non-interactive mode | Accepted |
| [007-superpowers-workflow](007-superpowers-workflow.md) | Superpowers-inspired pipeline rewrite | Accepted |

## Related Documentation

- [Gotchas](../gotchas/) — Failure-backed troubleshooting by subsystem
- [Decision Log](../decisions.md) — Quick-reference decision diary (complements ADRs)
