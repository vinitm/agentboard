---
paths:
  - ".claude/skills/**"
  - "docs/decisions.md"
---

# Learning Scope

## All learnings MUST be project-scoped

This project has its own conventions (console.log prefixes, prepared statements, inline fix patterns, BufferedWriter for parallel writes, stage contracts) that do NOT apply to other projects.

## When to capture learnings

At the end of every significant task:

1. **Decisions** → update `docs/decisions.md` if you made architectural or design choices
2. **Gotchas** → update `docs/gotchas/` if you hit a non-obvious trap
3. **Skills** → create `.claude/skills/learned/<pattern>.md` for patterns future agents need
4. **AGENTS.md** → update if new build commands, conventions, or test helpers were discovered

## Learning triggers

| Trigger | Action |
|---------|--------|
| Pipeline bugs (worker loop, stages) | Create skill file in `.claude/skills/learned/` |
| DB schema or query changes | Create skill file + run security-reviewer agent |
| Multi-subtask execution issues | Create skill file |
| New subsystem added | Update AGENTS.md + create skill file |
| Production failure | Create post-mortem skill + decision log entry |

## NEVER save learnings globally

ALWAYS save to project scope (`.claude/skills/learned/`), NEVER to global (`~/.claude/skills/learned/`).
