# Development Workflow

> This file extends [common/git-workflow.md](./git-workflow.md) with the full feature development process that happens before git operations.
> It is auto-loaded by Claude Code for every session.

The Feature Implementation Workflow describes the development pipeline: research, planning, branch creation, TDD, code review, learning, and then committing to git.

**Key principle:** Branch creation is deferred to implementation. Research and planning happen on whatever branch you're on (even master) since they produce no code changes. This eliminates stale branches from abandoned research/planning.

## Feature Implementation Workflow

### 0. Research & Reuse _(mandatory before any new implementation)_

No branch needed — this step is read-only.

- **GitHub code search first:** Run `gh search repos` and `gh search code` to find existing implementations, templates, and patterns before writing anything new.
- **Library docs second:** Use Context7 or primary vendor docs to confirm API behavior, package usage, and version-specific details before implementing.
- **Check package registries:** Search npm before writing utility code. Prefer battle-tested libraries over hand-rolled solutions.
- **Search for adaptable implementations:** Look for open-source projects that solve 80%+ of the problem and can be forked, ported, or wrapped.
- Prefer adopting or porting a proven approach over writing net-new code when it meets the requirement.


### 1. Plan First

No branch needed — planning happens in conversation.

- Use **planner** agent to create implementation plan
- Identify dependencies and risks
- Break down into phases
- WAIT for user confirmation before proceeding


### 2. Branch _(create before first code change)_

Create a feature branch only after research and planning are complete and the user has approved the plan. The pre-bash hook blocks commits to master/main, so you'll get a clear error if you forget.

```bash
git checkout -b agentboard/<task-slug>
```

- Branch naming: `agentboard/<task-id>-<slug>` or `agentboard/<task-slug>`
- One PR per top-level task (subtasks share the parent's branch)
- Never commit directly to master — enforced by `.claude/helpers/hook-handler.cjs`
- Abandoned research/planning? No branch to clean up.

### 3. TDD Approach

- Use **tdd-guide** agent
- Write tests first (RED) using project helpers: `createTestDb()`, `createTestRepo()`, `createTestApp()`
- Co-locate tests: `foo.ts` → `foo.test.ts`, `Bar.tsx` → `Bar.test.tsx`
- Implement to pass tests (GREEN)
- Refactor (IMPROVE)
- Verify 80%+ coverage


### 4. Code Review

- Use **code-reviewer** agent immediately after writing code (MANDATORY)
- Use **security-reviewer** agent when touching auth, user input, APIs, worker stages, DB queries, or shell commands
- Address CRITICAL and HIGH issues before proceeding
- Fix MEDIUM issues when possible


### 5. Learn & Capture Patterns

After completing a significant task:
1. Update `docs/decisions.md` if architectural choices were made
2. Update `docs/gotchas/` if you hit a recurring trap
3. Create `.claude/skills/learned/<pattern>.md` for non-obvious discoveries

### 6. Commit & Push

- Feature branch, never master (hook-enforced)
- Run `npm test` and `npm run build` before committing
- Detailed commit messages following conventional commits format
- See [git-workflow.md](./git-workflow.md) for commit message format


## Autonomous Pipeline Agents

This workflow is for interactive Claude Code sessions only. Autonomous pipeline agents follow the stage sequence defined in `src/worker/stages/`. Do not deviate from the stage contract.
