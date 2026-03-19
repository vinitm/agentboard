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

**Ruflo/Claude-Flow tools:**
- `memory_search` — recall prior solutions from HNSW-indexed memory
- `agentdb_pattern_search` — find learned patterns from prior tasks
- `hooks_intelligence_pattern_search` — semantic similarity search across the intelligence graph

### 1. Plan First

No branch needed — planning happens in conversation.

- Use **planner** agent to create implementation plan
- Identify dependencies and risks
- Break down into phases
- WAIT for user confirmation before proceeding

**Ruflo/Claude-Flow tools:**
- For multi-agent tasks: `swarm_init` (hierarchical topology) + `agent_spawn`
- `task_create` — track subtasks across agents
- `workflow_run` with `feature-implementation` template
- `hooks_route` — optimal agent/model selection based on task content

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

**Ruflo/Claude-Flow tools:**
- `hooks_pre_edit` — validates changes before write
- `hooks_post_edit` — auto-formats and stores patterns after write
- `worker_dispatch testgaps` — find missing test coverage
- `browser_open` + `browser_snapshot` — E2E testing with Lightpanda

### 4. Code Review

- Use **code-reviewer** agent immediately after writing code (MANDATORY)
- Use **security-reviewer** agent when touching auth, user input, APIs, worker stages, DB queries, or shell commands
- Address CRITICAL and HIGH issues before proceeding
- Fix MEDIUM issues when possible

**Ruflo/Claude-Flow tools:**
- `analyze_diff_risk` — automated risk scoring of changes
- `analyze_diff_reviewers` — suggest human reviewers based on file ownership
- `aidefence_scan` — security scanning (prompt injection, PII detection)
- `agentdb_feedback` — record review quality metrics for learning

### 5. Learn & Capture Patterns

After completing a task, capture what was learned so future agents benefit. This step is **mandatory for significant tasks**.

#### Automatic (fire-and-forget)
- Worker pipeline auto-runs `extractLearnings()` on task completion
- Metrics appended to `.agentboard/learning-log.jsonl`
- Novel patterns saved to `.claude/skills/learned/`

#### Manual (required for significant tasks)
1. **Store patterns:** Use `agentdb_pattern_store` to save reusable approaches
   - What worked, what didn't, and why
   - File paths and function names involved
   - Edge cases discovered
2. **Record feedback:** Use `agentdb_feedback` to close the learning loop
3. **Update decisions:** If architectural choices were made, update `docs/decisions.md`
4. **HNSW indexing:** Use `hooks_intelligence_pattern_store` for ReasoningBank
5. **Cross-session memory:** Use `memory_store` for context future sessions need
6. **Skill file:** Create `.claude/skills/learned/<pattern>.md` for non-obvious discoveries

#### Mistake Capture
When a task fails or requires rework:
1. Record the failure pattern: what went wrong, root cause, resolution
2. Use `agentdb_pattern_store` with type "failure" so future agents can search for it
3. Use `agentdb_causal_edge` to link the failure to the decision/pattern it violated
4. Update `docs/gotchas/` if it's a recurring trap

#### Learning Triggers
| Trigger | Action |
|---------|--------|
| Pipeline bugs | Create skill file in `.claude/skills/learned/` |
| DB schema changes | Create skill file + security review |
| Multi-subtask issues | Create skill file |
| Workflow violations | Save feedback memory |
| Production failures | Create post-mortem skill + decision log entry |

### 6. Commit & Push

- Feature branch, never master (hook-enforced)
- Run `npm test` and `npm run build` before committing
- Detailed commit messages following conventional commits format
- See [git-workflow.md](./git-workflow.md) for commit message format

**Ruflo/Claude-Flow tools:**
- `analyze_diff` — pre-commit risk assessment
- `session_save` — persist session state before ending

## Specialized Agents (use via `agent_spawn` or direct invocation)

| Agent Type | When to Use |
|-----------|-------------|
| `researcher` | Deep research before implementation |
| `planner` | Implementation planning, dependency analysis |
| `coder` / `sparc-coder` | Code implementation with TDD |
| `reviewer` | Code review with pattern detection |
| `tester` | Test generation and quality assurance |
| `security-auditor` | Security scanning and CVE detection |
| `performance-optimizer` | Bottleneck analysis and optimization |
| `analyst` | Code quality analysis |
| `system-architect` | System design and architecture decisions |
| `backend-dev` | Backend API development |
| `mobile-dev` | React Native development |
| `cicd-engineer` | GitHub Actions pipelines |
| `production-validator` | Deployment readiness checks |

## Background Workers (dispatch via `worker_dispatch`)

| Worker | Purpose | When |
|--------|---------|------|
| `testgaps` | Find missing test coverage | After TDD step |
| `audit` | Security + code audit | After touching auth/DB/APIs |
| `optimize` | Performance optimization | After implementation |
| `document` | Auto-generate documentation | After feature completion |
| `consolidate` | Clean up memory, deduplicate | Periodic maintenance |
| `predict` | Predictive analysis | Before complex changes |
| `deepdive` | Deep code analysis | Complex refactors |
| `refactor` | Dead code, duplication | After feature completion |

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
