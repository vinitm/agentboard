# Learning Scope

## All learnings MUST be project-scoped

This project has its own conventions (console.log prefixes, prepared statements, ralph loop patterns, BufferedWriter for parallel writes, stage contracts) that do not apply to other projects.

### `/everything-claude-code:learn-eval`
ALWAYS save to project scope (`.claude/skills/learned/`), NEVER to global (`~/.claude/skills/learned/`).

### `/everything-claude-code:continuous-learning-v2`
Instincts are auto-scoped by git remote hash — no action needed. They persist in `~/.claude/homunculus/projects/<hash>/`.

### Architectural decisions
Record in `docs/decisions.md` so autonomous pipeline agents (which don't have ECC) can also see them.

### When to capture learnings

At the end of every task:
1. continuous-learning-v2 captures automatically via hooks
2. Run `/everything-claude-code:learn-eval` for significant tasks (new patterns, non-obvious fixes)
3. Update `docs/decisions.md` if you made architectural or design decisions
4. Run `/maintaining-agents-md` if new conventions or boundaries were discovered
