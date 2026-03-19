---
name: ruflo-seed
description: Seed ruflo memory, workflows, and neural models for the current project
---

# Ruflo Intelligence Seeding

Run this after the ruflo CLI setup completes (either `scripts/ruflo-full-setup.sh` or `scripts/ruflo-setup-for-repo.sh`). This command uses MCP tools to seed project knowledge that the CLI can't handle.

## Steps

### 1. Seed gotchas into hierarchical memory

If `docs/gotchas/` exists, read all `.md` files in it (excluding README.md). For each file, call `agentdb_hierarchical-store` with:
- `key`: `gotchas/<filename-without-extension>` (e.g., `gotchas/imports`)
- `value`: A concise summary of all gotchas in the file
- `tier`: `semantic`

If the directory doesn't exist, skip this step.

### 2. Seed decisions into vector memory

If `docs/decisions.md` exists, read it. For each `## 20XX-XX-XX:` section, call `memory_store` with:
- `key`: `decision-<slug>` (e.g., `decision-execfile-over-exec`)
- `value`: A concise summary of the decision, why, and consequences
- `namespace`: `decisions`
- `tags`: relevant tags (e.g., `["security", "shell"]`)

If the file doesn't exist, skip this step.

### 3. Seed learned patterns

If `.claude/skills/learned/` exists, read all files in it. For each file, call `memory_store` with:
- `key`: `pattern-<slug>`
- `value`: The pattern rule and when to apply it
- `namespace`: `patterns`
- `tags`: relevant tags

If the directory doesn't exist, skip this step.

### 4. Create causal links

If both decisions and implementation files were found, create causal links between them. For key relationships between decisions and the files they affect, call `memory_store` with:
- `namespace`: `causal-links`
- Link decisions to the files they affect

If no decisions were seeded, skip this step.

### 5. Create workflow templates

Call `workflow_create` then `workflow_template(action: "save")` for these 4 workflows:

**feature-implementation** (9 steps): route → plan → TDD → implement → review (parallel: code-reviewer + security-reviewer) → docs → verify → pre-commit → commit

**bug-fix** (6 steps): diagnose → reproduce → fix → verify → learn → commit

**docs-improvement** (5 steps): audit → research (parallel) → edit → verify → commit

**security-audit** (5 steps): scan → deps → review → fix → verify

### 6. Train neural models

Call `neural_train` for:
- `coordination` (modelType: `moe`, epochs: 10)
- `optimization` (modelType: `classifier`, epochs: 10)
- `prediction` (modelType: `transformer`, epochs: 10)

### 7. Initialize swarm

Call `swarm_init` with topology: `hierarchical`, strategy: `specialized`, maxAgents: 8

### 8. Start session

Call `agentdb_session-start` with sessionId based on current date and project name (derived from the current directory name).

### 9. Export state

Run these bash commands:
```bash
mkdir -p .ruflo/models
ruflo route export > .ruflo/q-table.json
ruflo config list --format json > .ruflo/config-export.json
ruflo neural export --output .ruflo/models/neural-export.json
```

### 10. Verify

Call `memory_list` to confirm entries were stored. Report count and namespaces.

## Done

Report summary: entries seeded, workflows created, models trained, swarm initialized.
