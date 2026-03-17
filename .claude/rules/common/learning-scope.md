# Learning Scope

## All learnings MUST be project-scoped

This project has its own conventions (console.log prefixes, prepared statements, inline fix patterns, BufferedWriter for parallel writes, stage contracts) that do not apply to other projects.

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

### Learning trigger taxonomy

**Always run `/learn-eval`:**
- After fixing pipeline bugs (worker loop, stages, inline fix)
- After adding new stages to `src/worker/stages/`
- After fixing multi-subtask execution issues
- After modifying DB schema or queries
- After discovering a non-obvious interaction between subsystems

**Always update `docs/decisions.md`:**
- After changing pipeline state transitions (the state machine)
- After changing code quality or final review logic
- After changing auto-merge criteria
- After adding or removing a stage from the pipeline

**Always create a skill file in `.claude/skills/learned/`:**
- When a bug fix reveals a non-obvious pattern (e.g., stale objects, shared worktrees)
- When a new convention is discovered that autonomous agents need to know
- After any production failure in the autonomous pipeline (post-mortem skill)

**Meta-trigger:** Update this taxonomy whenever a new subsystem is added to the project.
