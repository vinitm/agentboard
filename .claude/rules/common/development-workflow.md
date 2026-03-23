# Development Workflow

> Extends [git-workflow.md](./git-workflow.md). Auto-loaded every session.

## Key Principle: Deferred Branching

Research and planning happen on whatever branch you're on (even master) since they produce no code changes. Create a feature branch only when the user approves the plan and you're about to write code. This eliminates stale branches from abandoned research/planning.

## Before First Code Change

```bash
git checkout -b agentboard/<task-slug>
```

The pre-bash hook blocks commits to master/main — you'll get a blocking error if you forget.

## Learning Triggers

After completing a significant task:

| Trigger | Action |
|---------|--------|
| Architectural choices made | Update `docs/decisions.md` |
| Hit a non-obvious trap | Update `docs/gotchas/` |
| Pattern future agents need | Create `.claude/skills/learned/<pattern>.md` |
| New build commands or conventions | Update AGENTS.md |

## Autonomous Pipeline Agents

This workflow is for interactive Claude Code sessions only. Autonomous pipeline agents follow the stage sequence defined in `src/worker/stages/`. Do not deviate from the stage contract.
