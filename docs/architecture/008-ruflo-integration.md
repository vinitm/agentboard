# ADR-008: Full Ruflo Integration for AI Agent Orchestration

## Status
Accepted (2026-03-19)

## Context
Agentboard is a single-developer project orchestrating AI coding agents through a multi-stage pipeline. Sessions required manual setup, cross-session learning was limited to `.claude/skills/learned/`, and agent routing was static. Ruflo v3.5 (259 MCP tools, 26 CLI commands, 38 skills, 12 daemon workers) was available as MCP server but unconfigured.

## Decision
Integrate ruflo v3.5 with all features: hooks, daemon workers, memory (sql.js + HNSW), neural training, guidance compilation, AI defense, GitHub integration, browser automation, swarm coordination. Everything automatic on every session.

## Key Design Choices

### Hooks Architecture
All ruflo hooks wired through Claude Code's `settings.json` hook system via a central `hook-handler.cjs` dispatcher. Each hook type maps to a specific handler:
- SessionStart → session-restore (context recovery)
- UserPromptSubmit → route (agent + model selection)
- PostToolUse → post-edit/post-bash (learning)
- Stop → session-end (persistence)

### Memory Strategy
Three-tier seeding:
1. **Hierarchical store** (semantic tier): gotchas by subsystem namespace
2. **Flat vector store** (HNSW-indexed): decisions and patterns with embeddings
3. **Causal links**: relationships between decisions and implementation files

### Cross-Device Portability
Portable state committed in `.ruflo/`: Q-learning table, config, neural models. Session state gitignored. Bootstrap script (`scripts/ruflo-bootstrap.sh`) restores full state on new device.

### Guidance Compilation
AGENTS.md compiled into policy bundle (constitution + shards). `guidance retrieve` serves task-relevant shards instead of loading full file, reducing token overhead.

## Consequences

### Positive
- Zero-manual-effort sessions: hooks fire automatically
- Cross-session learning via HNSW-indexed memory (semantic search)
- Intelligent agent routing via Q-learning + neural models
- 12 background workers for continuous analysis
- AI defense layer for prompt injection protection
- Portable intelligence across devices

### Negative
- `.claude/settings.json` grows significantly with hook config
- `.ruflo/` directory committed for portability
- Ruflo daemon runs in background (lightweight)
- Additional complexity in hook chain

### Risks Mitigated
- `--skip-claude` flag prevents ruflo from overwriting settings.json
- `continueOnError: true` on hooks prevents latency blocking
- Pre-ruflo backup of settings.json maintained
- Existing project tests/build unaffected

## References
- [docs/ruflo-setup.md](../ruflo-setup.md) — Complete setup documentation
- [ADR-007: Superpowers Workflow](007-superpowers-workflow.md) — Pipeline that ruflo hooks enhance
- [ADR-004: Serial Subtasks](004-serial-subtasks.md) — Execution model ruflo coordinates around
