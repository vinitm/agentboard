# Ruflo Replication Guide

Set up ruflo intelligence for any repo using this project as a source. No global installs needed — everything runs from this repo.

## What Ruflo Does

Ruflo adds an intelligence layer to Claude Code sessions:

| Capability | What It Does |
|-----------|--------------|
| **Hooks** | Automatic event handlers (session restore, task routing, edit learning, security scanning) |
| **Memory** | Hybrid vector + SQL memory with hierarchical recall, causal links, pattern search |
| **Pretrain** | Deep codebase analysis (complexity, circular deps, architecture mapping) |
| **Daemon** | Background workers for auditing, test gap detection, optimization, documentation |
| **Workflows** | Reusable pipelines (feature-implementation, bug-fix, security-audit, docs) |
| **Neural** | Trained models for coordination, optimization, and prediction |
| **Guidance** | AGENTS.md compiled into retrievable policy shards |
| **Swarm** | Multi-agent orchestration with hierarchical topology |

## Two-Part Setup Process

### Part 1: CLI Setup (automated)

The script installs ruflo runtime, configures memory/embeddings, runs pretrain, starts daemon, and exports portable state.

```bash
# From the agentboard repo root:
./scripts/ruflo-setup-for-repo.sh /path/to/other-repo
```

This:
1. Backs up any existing `.claude/settings.json`
2. Initializes ruflo runtime with embeddings
3. Configures hybrid memory backend
4. Runs static analysis + deep pretrain on the target codebase
5. Generates agent configs and compiles guidance
6. Runs security scan, starts daemon
7. Exports portable state to `.ruflo/`
8. Copies the `/ruflo-seed` command and bootstrap script to the target repo
9. Updates `.claudeignore` and `.gitignore`

### Part 2: MCP Seeding (via Claude Code)

After the CLI script completes, open the target repo in Claude Code and run:

```
/ruflo-seed
```

This uses MCP tools to seed project-specific knowledge that the CLI can't handle:
- Gotchas from `docs/gotchas/` into hierarchical memory
- Decisions from `docs/decisions.md` into vector memory
- Learned patterns from `.claude/skills/learned/`
- Causal links between decisions and implementation
- Workflow templates (feature, bug-fix, docs, security-audit)
- Neural model training (coordination, optimization, prediction)
- Swarm initialization

## Using Claude to Replicate

You can ask Claude (while in this agentboard project) to set up ruflo for another repo:

> "Set up ruflo for /home/user/Projects/my-other-repo"

Claude will:
1. Run `./scripts/ruflo-setup-for-repo.sh /home/user/Projects/my-other-repo`
2. Advise you to open that repo in Claude Code and run `/ruflo-seed`

## What's Customized Per-Project vs Generic

### Generic (same for every repo)
- Hook handler structure (`.claude/helpers/hook-handler.cjs`)
- Hook event wiring in `.claude/settings.json`
- MCP server config in `.mcp.json`
- Workflow templates (feature-implementation, bug-fix, etc.)
- Neural model types (coordination, optimization, prediction)
- Bootstrap script (`scripts/ruflo-bootstrap.sh`)
- `/ruflo-seed` command

### Customized per-project
- **Pretrain data** — derived from the target codebase's actual files
- **Guidance shards** — compiled from the target repo's AGENTS.md / CLAUDE.md
- **Memory entries** — seeded from the target repo's `docs/gotchas/`, `docs/decisions.md`
- **Daemon focus paths** — set to the target repo's source directories
- **Agent configs** — generated based on the target repo's structure
- **Q-table routing** — trained on the target repo's patterns

## File Layout After Setup

```
target-repo/
├── .claude/
│   ├── commands/
│   │   └── ruflo-seed.md        # MCP seeding command
│   ├── helpers/
│   │   └── hook-handler.cjs     # Hook dispatcher (created by ruflo init)
│   └── settings.json            # Hooks + permissions (created by ruflo init)
├── .mcp.json                    # MCP server config (created by ruflo init)
├── .claudeignore                # Files to exclude from Claude context
├── .ruflo/                      # Portable state (committed)
│   ├── q-table.json
│   ├── config-export.json
│   └── models/
│       └── neural-export.json
├── .agents/                     # Runtime state (gitignored)
├── .claude-flow/                # Runtime state (gitignored)
└── scripts/
    └── ruflo-bootstrap.sh       # Bootstrap on new device
```

## Troubleshooting

### `ruflo: command not found`
Ruflo is installed via `npx @claude-flow/cli`. Ensure Node.js 18+ is available. The scripts use `ruflo` directly — if not on PATH, install globally:
```bash
npm install -g @claude-flow/cli
```

### Hook handler errors on session start
The hook handler (`hook-handler.cjs`) expects to be in `.claude/helpers/`. If ruflo init didn't create it, check `ruflo doctor` output.

### Pretrain fails or hangs
Pretrain analyzes all source files. For large repos, it can take minutes. If it fails:
```bash
# Check what source directory it's scanning
ls src/ || ls .
# Run pretrain manually with reduced depth
ruflo hooks pretrain --depth shallow
```

### Memory seeding reports zero entries
Ensure the target repo has the expected files:
- `docs/gotchas/*.md` — for gotcha seeding
- `docs/decisions.md` — for decision seeding
- `.claude/skills/learned/*.md` — for pattern seeding

If none exist, that's fine — `/ruflo-seed` will skip those steps gracefully.

### Settings.json conflicts
The script backs up existing settings to `.claude/settings.json.pre-ruflo`. If ruflo's hooks conflict with existing hooks, merge manually:
```bash
diff .claude/settings.json .claude/settings.json.pre-ruflo
```

### Cross-device bootstrap
On a new machine after cloning, run:
```bash
./scripts/ruflo-bootstrap.sh
```
This imports the committed `.ruflo/` state (Q-table, config, neural models) and runs pretrain.
