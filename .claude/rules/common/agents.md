# Agent Orchestration

## Available Agents

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| planner | Implementation planning | Complex features, refactoring, multi-file changes |
| architect | System design | Architectural decisions, new subsystems |
| tdd-guide | Test-driven development | New features, bug fixes |
| code-reviewer | Code review | After writing/modifying code (MANDATORY) |
| security-reviewer | Security analysis | Auth, user input, APIs, worker stages, DB queries, shell commands |
| build-error-resolver | Fix build errors | When `npm run build` or `npm test` fails |
| e2e-runner | E2E testing | After implementing user-facing features |
| doc-updater | Documentation | After completing features — update AGENTS.md, architecture docs, gotchas |
| refactor-cleaner | Dead code cleanup | After refactoring — remove unused code |

## Immediate Agent Usage

No user prompt needed:
1. Complex feature requests → Use **planner** agent
2. Code just written/modified → Use **code-reviewer** agent
3. Bug fix or new feature → Use **tdd-guide** agent
4. Architectural decision → Use **architect** agent
5. Touching src/server/, src/worker/, src/db/ → Use **security-reviewer** agent
6. After completing a feature → Use **doc-updater** agent

## Parallel Task Execution

ALWAYS use parallel execution for independent operations:
- Launch code-reviewer + security-reviewer in parallel after implementation
- Launch multiple research agents in parallel during the Research phase

## Agentboard-Specific Triggers

- Modifying `src/worker/stages/` → planner + architect (pipeline changes are high-risk)
- Modifying `src/db/queries.ts` or `src/db/schema.ts` → security-reviewer (SQL injection risk)
- Modifying `prompts/` → code-reviewer (prompt quality matters)
- Adding new API routes → security-reviewer + code-reviewer in parallel
