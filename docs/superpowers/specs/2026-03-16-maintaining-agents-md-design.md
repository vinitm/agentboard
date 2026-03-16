# Design Spec: maintaining-agents-md Skill

**Date:** 2026-03-16
**Status:** Approved
**Approach:** Core skill + reference files (Approach 2)

## Summary

A personal Claude Code skill at `~/.claude/skills/maintaining-agents-md/` that owns the full lifecycle of AGENTS.md files: creation, updating, hierarchy enforcement, self-improvement after tasks, and migration. It enforces the Hierarchical Nested AGENTS.md Standard with strict hierarchy management and automatic conflict detection.

## Decisions

| Question | Answer |
|----------|--------|
| Skill location | Personal: `~/.claude/skills/maintaining-agents-md/` |
| File scope | AGENTS.md only |
| Self-update behavior | Fully automatic — proposes after every task |
| Hierarchy handling | Strict enforcement with conflict warnings |
| Global layer | Create and manage `~/.claude/AGENTS.md` |

## File Structure

```
~/.claude/skills/maintaining-agents-md/
  SKILL.md              # Core skill (~300 words) — commands, flowchart, rules
  hierarchy-rules.md    # Merge algorithm, conflict detection, precedence logic
  file-template.md      # Canonical AGENTS.md skeleton + section guidelines
```

## Frontmatter

```yaml
---
name: maintaining-agents-md
description: Use when creating, updating, or reviewing AGENTS.md files, when starting work in a new directory, or after completing tasks that revealed new commands, conventions, or boundaries
---
```

## Activation Triggers

These are **instructions the agent should follow**, not event-driven hooks. Skills are passive instruction documents — the agent checks these conditions as part of its workflow.

- User says "update AGENTS.md", "create AGENTS.md", "show merged AGENTS.md", "migrate AGENTS.md"
- After completing any task, the agent should consult this skill to evaluate self-update proposals
- When the agent notices a project has no AGENTS.md, it should offer to initialize one
- When working in a subdirectory that could benefit from a nested AGENTS.md

## CLAUDE.md Relationship

This skill manages AGENTS.md files only. It does **not** create or manage CLAUDE.md files. However:

- **Bootstrap source:** When initializing AGENTS.md in a project that has CLAUDE.md but no AGENTS.md, the skill reads CLAUDE.md content as input to generate the initial AGENTS.md draft. The existing CLAUDE.md is left untouched — the user decides whether to keep, symlink, or remove it.
- **No symlink management:** The skill does not create or manage CLAUDE.md → AGENTS.md symlinks. That is a project-level decision for the user.
- **No migration:** The skill does not rename or delete CLAUDE.md files. It only proposes AGENTS.md content.

## Core Skill Logic — Four Modes

The SKILL.md contains a decision flowchart selecting between four modes:

### Mode 1: Create
Walk the directory tree, identify where a new AGENTS.md is needed (root vs nested package), generate from template in `file-template.md`, enforce hierarchy rules before writing.

### Mode 2: Update / Migrate
Read existing file, propose diff with one-sentence justification, wait for approval (conversational — present diff and ask in natural language, user responds in next message; if user ignores the proposal and asks something else, drop the proposal silently). For migration: restructure to match the canonical skeleton while preserving content using the following section mapping:

**Migration mapping from common existing formats:**
| Existing Section | Maps To |
|-----------------|---------|
| Commands, Scripts, Build | Commands |
| About, Overview, Description | Project Context |
| Do, Style, Conventions, Formatting | Code Style & Conventions |
| Tests, Testing, Test, Coverage | Testing Requirements |
| Architecture, Structure, Modules, Gotchas | Architecture & Boundaries |
| Don't, Never, Forbidden, Warnings | Never Do / Always Ask First |
| Docs, Links, See Also | References |
| (unmapped sections) | Best-fit canonical section, or Architecture & Boundaries as fallback |

### Mode 3: Self-Update Loop
After task completion, ask: "Did I learn a new command, convention, or boundary?" If yes → generate diff against nearest AGENTS.md, present with justification, wait for explicit approval, re-validate hierarchy after write.

### Mode 4: Initialize
On first encounter with a project lacking AGENTS.md, offer to create root file. Also offer `~/.claude/AGENTS.md` if it doesn't exist yet. Bootstraps from existing project files (CLAUDE.md, package.json, Makefile, etc.).

### Hard Rules (always enforced)
- Never write without explicit user approval
- Every AGENTS.md must follow the canonical section order (Commands first)
- Files must stay under 150 lines
- No redundant content between parent and child files

## Hierarchy Enforcement

### Merge Algorithm

```
~/.claude/AGENTS.md           (outermost — personal defaults)
  └── project/AGENTS.md      (project root)
       └── packages/ui/AGENTS.md   (nested — most specific, wins)
```

### Precedence Rules
1. Deeper file overrides conflicting sections from parent
2. "Never Do" / "Always" lists are **appended** across all levels (deduplicated)
3. Commands are **merged** — child adds to parent's commands, doesn't replace
4. Per-section merge behavior is determined by section type: "Never Do / Always Ask First" and "Commands" always append; other sections override. No frontmatter directives are used — this avoids polluting AGENTS.md files with metadata that other tools wouldn't understand

### Conflict Detection
The skill actively checks for:
- Child file repeating rules already stated in parent → warns "redundant, remove from child"
- Child file contradicting parent → warns "conflict detected — reconcile or add comment explaining the override"
- Files exceeding 150 lines → warns with suggestions to split or use references
- Missing required sections (Commands section must always be present; an empty Commands section is valid — it signals "no project-specific commands, inherit from parent")

### Nesting Depth
Arbitrary depth is supported. The merge walks from `~/.claude/AGENTS.md` through every ancestor directory's AGENTS.md down to the nearest one. In practice, most projects need at most 2-3 levels (global → root → package).

### Show Merged Command
When user asks to see the merged view, the skill walks from `~/.claude/AGENTS.md` → root → nearest, applies the merge algorithm, and outputs the fully resolved AGENTS.md for the current working directory. Read-only output, never written to disk.

## Canonical AGENTS.md Template

Every AGENTS.md must follow this skeleton:

```markdown
## Commands
<build, test, lint, deploy — verbatim copy-pasteable commands>

## Project Context
<what this project/package is, one paragraph max>

## Code Style & Conventions
<language, formatting, naming, import rules>

## Testing Requirements
<how to test, what frameworks, coverage expectations>

## Architecture & Boundaries
<key modules, data flow, what not to touch>

## Never Do / Always Ask First
<guardrails — append-merged across hierarchy>

## References
<pointers to docs/, READMEs, external resources — progressive disclosure>
```

### Section Rules
- **Commands** is always first and always required
- **References** replaces inline detail; reference external docs instead of duplicating
- Sections can be omitted if not applicable (except Commands)
- No section should exceed ~30 lines; extract to reference doc if it does
- Referenced filesystem paths are checked for existence; missing references flagged; existing ones get one-line summary. URLs are not validated.

## Self-Update Loop

### Trigger
After every successful task completion in an interactive session. In non-interactive mode (`claude --print`), skip self-update proposals entirely — the agent cannot wait for approval. Non-interactive agents should instead append learned conventions as comments in their PR description for human review.

### Sequence
1. Ask: "Did I learn a new command, convention, or boundary?"
2. If no → done
3. If yes → identify nearest AGENTS.md
4. Generate diff
5. Check hierarchy for conflicts/redundancy
6. Adjust diff if needed
7. Present diff + one-sentence justification
8. Wait for user approval
9. If approved → write changes → re-validate hierarchy
10. If declined → do not re-propose same change in this session

### What Counts as "Learned Something"
- Discovered a build/test/lint command not in Commands section
- Hit a convention not documented (import style, naming pattern, forbidden pattern)
- Found an architectural boundary (module X should never import from Y)
- Encountered a gotcha that would trip up future agents

### Presentation Format
```
AGENTS.md update proposal (packages/ui/AGENTS.md)
Reason: Discovered `pnpm build:ui --filter=ui` is needed for isolated UI builds

 ## Commands
+pnpm build:ui --filter=ui   # Build UI package in isolation

Approve? (y/n)
```

## Global Layer

### ~/.claude/AGENTS.md (Global Defaults)
The global layer lives at `~/.claude/AGENTS.md` (inside the Claude Code config directory, not `~/.config/` which is for XDG app directories). On first activation in any project, check for this file. If missing, offer to create it.

### Default Global Contents
```markdown
## Commands
<empty — project-specific>

## Code Style & Conventions
<populated from observed patterns if available, otherwise minimal>

## Never Do / Always Ask First
- Never commit secrets, credentials, or .env files
- Never force-push to main/master without asking
- Always ask before deleting data or dropping tables
```

### First-Use in Project Without AGENTS.md
1. Read existing CLAUDE.md, package.json, Makefile, etc. for commands and context
2. Generate draft following canonical skeleton
3. Present draft for approval before writing
