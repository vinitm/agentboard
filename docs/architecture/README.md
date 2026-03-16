# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for agentboard.

ADRs capture the "why" behind key architectural choices — context that cannot be inferred from code alone. They follow the format: Context → Decision → Consequences.

## Index

| ADR | Decision | Status |
|-----|----------|--------|
| [001-sqlite-wal](001-sqlite-wal.md) | Use SQLite with WAL mode as the sole persistence layer | Accepted |
| [002-polling-worker](002-polling-worker.md) | Poll-based worker loop with event-driven wake-up | Accepted |
| [003-worktree-isolation](003-worktree-isolation.md) | Git worktrees for task isolation, shared by subtasks | Accepted |
| [004-serial-subtasks](004-serial-subtasks.md) | Serial subtask execution with single parent PR | Accepted |
| [005-model-selection](005-model-selection.md) | Stage-and-risk-driven model selection | Accepted |
| [006-claude-code-executor](006-claude-code-executor.md) | Spawn Claude Code as child process in non-interactive mode | Accepted |
