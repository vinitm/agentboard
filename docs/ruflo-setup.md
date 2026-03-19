# Ruflo Integration Setup

Complete ruflo v3.5 integration for agentboard. Automatic on every session, cross-device portable, self-documenting.

## What's Configured

### Hooks (`.claude/settings.json`)
All hooks fire automatically via Claude Code settings. No manual steps needed.

| Hook Event | Handler | Purpose |
|------------|---------|---------|
| `SessionStart` | `session-restore` + `auto-memory import` | Restore session context, load memory |
| `UserPromptSubmit` | `route` | Task routing to optimal agent + model |
| `PreToolUse` (Bash) | `pre-bash` | Pre-command validation |
| `PreToolUse` (Write/Edit) | `pre-edit` | Pre-edit learning |
| `PostToolUse` (Write/Edit) | `post-edit` | Post-edit learning |
| `PostToolUse` (Bash) | `post-bash` | Post-command learning |
| `Stop` | `auto-memory sync` | Save session, export memory |
| `PreCompact` | `session-end` + `compact` | Checkpoint before context compaction |
| `SubagentStart` | `status` | Track subagent status |
| `SubagentStop` | `post-task` | Record subagent outcomes |

All hooks: `timeout: 5000-15000ms`, handled by `hook-handler.cjs`.

### Memory (sql.js + HNSW)
- Backend: hybrid (sql.js + HNSW vector index)
- Embeddings: all-MiniLM-L6-v2 (ONNX) with hyperbolic (Poincare ball) projection
- Seeded namespaces: `decisions` (8 entries), `patterns` (2), `causal-links` (3), `gotchas` (4 hierarchical)

### Daemon Workers (12)
| Worker | Interval | Focus |
|--------|----------|-------|
| `audit` | 30min | `src/server/, src/db/, src/worker/` |
| `testgaps` | 30min | `src/worker/stages/` |
| `optimize` | 1h | `src/worker/` |
| `consolidate` | 2h | Memory cleanup, dedup |
| `document` | 1h | `src/worker/, src/server/` |
| `refactor` | 4h | `src/` |
| `ultralearn` | 1h | Deep knowledge acquisition |
| `predict` | 15min | Predictive preloading |
| `preload` | 10min | Cache warming |
| `deepdive` | 4h | `src/worker/stages/` |
| `benchmark` | 6h | Performance benchmarking |
| `map` | 2h | `src/` architecture mapping |

### Neural Models
- `coordination` (MoE): 91.9% accuracy
- `optimization` (classifier): 88.5% accuracy
- `prediction` (transformer): 92.9% accuracy

### Workflow Templates
- `feature-implementation`: route → plan → TDD → implement → review → docs → verify → commit
- `bug-fix`: diagnose → reproduce → fix → verify → learn → commit
- `docs-improvement`: audit → research → edit → verify → commit
- `security-audit`: scan → deps → review → fix → verify

### Guidance
- Compiled AGENTS.md into policy bundle (93/100 score)
- 5 constitution rules, 45 shards, 50 total rules
- `guidance retrieve` serves task-relevant shards

### Security
- AI Defense: prompt injection scanning (<2ms latency)
- Security scan baseline established
- Drift detection configured (threshold: 0.3)

### Swarm
- Topology: hierarchical, specialized strategy
- Max agents: 8
- Consensus: majority

## Bootstrap on New Device

```bash
git clone <repo>
cd agentboard
./scripts/ruflo-bootstrap.sh
```

This imports config, Q-table, neural models, runs pretrain, compiles guidance, starts daemon.

## Debugging

```bash
ruflo doctor              # System diagnostics
ruflo daemon status       # Worker status
ruflo hooks metrics       # Hook performance
ruflo memory stats        # Memory statistics
ruflo neural status       # Model status
ruflo embeddings status   # Embedding index status
ruflo guidance status     # Guidance bundle status
ruflo system health --deep # Full health check
```

## When to Re-run Pretrain

- After significant codebase changes (new stages, major refactors)
- After adding new gotchas or decisions
- After importing memory from another device
- Command: `ruflo hooks pretrain --depth deep`

## Portable State (`.ruflo/`)

| File | Committed? | Purpose |
|------|-----------|---------|
| `q-table.json` | Yes | Q-learning routing decisions |
| `config-export.json` | Yes | Ruflo configuration |
| `models/neural-export.json` | Yes | Trained neural models |
| `session-export.json` | No (.gitignored) | Ephemeral session state |
