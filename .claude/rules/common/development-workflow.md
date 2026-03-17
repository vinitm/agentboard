# Development Workflow

> This file extends [common/git-workflow.md](./git-workflow.md) with the full feature development process that happens before git operations.

The Feature Implementation Workflow describes the development pipeline: research, planning, TDD, code review, and then committing to git.

## Feature Implementation Workflow

0. **Research & Reuse** _(mandatory before any new implementation)_
   - **GitHub code search first:** Run `gh search repos` and `gh search code` to find existing implementations, templates, and patterns before writing anything new.
   - **Library docs second:** Use Context7 or primary vendor docs to confirm API behavior, package usage, and version-specific details before implementing.
   - **Check package registries:** Search npm before writing utility code. Prefer battle-tested libraries over hand-rolled solutions.
   - **Search for adaptable implementations:** Look for open-source projects that solve 80%+ of the problem and can be forked, ported, or wrapped.
   - Prefer adopting or porting a proven approach over writing net-new code when it meets the requirement.

1. **Plan First**
   - Use **planner** agent to create implementation plan
   - Identify dependencies and risks
   - Break down into phases
   - WAIT for user confirmation before proceeding

2. **TDD Approach**
   - Use **tdd-guide** agent
   - Write tests first (RED) using project helpers: `createTestDb()`, `createTestRepo()`, `createTestApp()`
   - Co-locate tests: `foo.ts` → `foo.test.ts`, `Bar.tsx` → `Bar.test.tsx`
   - Implement to pass tests (GREEN)
   - Refactor (IMPROVE)
   - Verify 80%+ coverage

3. **Code Review**
   - Use **code-reviewer** agent immediately after writing code
   - Use **security-reviewer** agent when touching auth, user input, APIs, worker stages, DB queries, or shell commands
   - Address CRITICAL and HIGH issues before proceeding
   - Fix MEDIUM issues when possible

4. **Docs & Learning**
   - Use **doc-updater** agent to update AGENTS.md, architecture docs, gotchas
   - Run `/everything-claude-code:learn-eval` to extract reusable patterns (project-scoped only)
   - Update `docs/decisions.md` if architectural decisions were made
   - Learning capture checklist:
     - [ ] Created skill file in `.claude/skills/learned/` if a non-obvious pattern was discovered
     - [ ] Updated `docs/decisions.md` if architectural choices were made
     - [ ] Ran `/learn-eval` for significant tasks (see trigger taxonomy in `learning-scope.md`)
     - [ ] Verified skill file is project-scoped (not global)

5. **Commit & Push**
   - Feature branch, never master
   - Detailed commit messages following conventional commits format
   - See [git-workflow.md](./git-workflow.md) for commit message format

## Agentboard-Specific Backpressure

Stop and ask the user when:
- The change touches >5 files you did not expect
- You need to add a new dependency
- You are modifying the worker loop's 5-second polling or stage ordering
- Tests fail after 3 attempts to fix them
- The task description is ambiguous or contradicts existing code
- You are changing the pipeline state machine (backlog → ready → spec → ... → done)

## Backpressure Commands

Run after every implementation step:
- `npm test` — all tests must pass
- `npm run build` — must compile cleanly
- If build fails → use **build-error-resolver** agent before manual fixes

## Autonomous Pipeline Agents

This workflow is for interactive Claude Code sessions only. Autonomous pipeline agents follow the stage sequence defined in `src/worker/stages/`. Do not deviate from the stage contract.
