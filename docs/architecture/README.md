# Architecture

## Start Here

| Document | What it covers | When to read |
|----------|---------------|--------------|
| [Agent Orchestration](agent-orchestration.md) | System design, state machine, worker loop, DB schema | Understanding how the system works |
| [Pipeline Stages](../pipeline-stages.md) | Per-stage contracts, tools, prompts, failure modes | Working on or debugging a specific stage |
| [API Routes](../api-routes.md) | REST endpoints, Socket.IO events, request/response shapes | Building UI features or integrations |
| [Source Map](../source-map.md) | Directory structure, entry points, key types | Orienting in the codebase |

## Architecture Decision Records

ADRs capture the "why" behind key choices — context not inferable from code.

| ADR | Decision | Status |
|-----|----------|--------|
| [001-sqlite-wal](001-sqlite-wal.md) | SQLite with WAL mode as sole persistence layer | Accepted |
| [002-polling-worker](002-polling-worker.md) | Poll-based worker loop with event-driven wake-up | Accepted |
| [003-worktree-isolation](003-worktree-isolation.md) | Git worktrees for task isolation | Accepted |
| [004-serial-subtasks](004-serial-subtasks.md) | Serial subtask execution with single parent PR | Accepted |
| [005-model-selection](005-model-selection.md) | Model selection (originally stage-based, now opus everywhere) | Accepted (updated 2026-03-17) |
| [006-claude-code-executor](006-claude-code-executor.md) | Claude Code as child process in non-interactive mode | Accepted |
| [007-superpowers-workflow](007-superpowers-workflow.md) | Superpowers-inspired pipeline rewrite | Accepted |
| [008-ruflo-integration](008-ruflo-integration.md) | Ruflo v3.5 integration for AI agent orchestration | Accepted |

## Related Documentation

- [Decision Log](../decisions.md) — Quick-reference decision diary with links to ADRs
- [Gotchas](../gotchas/) — Failure-backed troubleshooting by subsystem
- [Browser Testing](../browser-testing.md) — Playwright + Lightpanda setup
