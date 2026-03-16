# Documentation Restructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AGENTS.md the source of truth, create hierarchical documentation (ADRs + gotcha docs), symlink CLAUDE.md, and enhance the maintaining-agents-md skill with progressive disclosure, ADR lifecycle, and gotcha pruning patterns.

**Architecture:** Two workstreams — (1) restructure agentboard's docs into a lean AGENTS.md root with detailed docs in `docs/architecture/` and `docs/gotchas/`, (2) enhance the `maintaining-agents-md` skill at `~/.claude/skills/maintaining-agents-md/` to teach agents these patterns. CLAUDE.md becomes a symlink to AGENTS.md.

**Tech Stack:** Markdown, git symlinks, Claude Code skills

---

## Chunk 1: Agentboard Docs Restructure

### Task 1: Create docs directory structure

**Files:**
- Create: `docs/architecture/README.md`
- Create: `docs/gotchas/README.md`

- [ ] **Step 1: Create docs/architecture/ with README**

```markdown
# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for agentboard.

ADRs capture the "why" behind key architectural choices — context that cannot be inferred from code alone. They follow the format: Context → Decision → Consequences.

## Index

| ADR | Decision | Status |
|-----|----------|--------|
| [001-sqlite-wal](001-sqlite-wal.md) | Use SQLite with WAL mode as the sole persistence layer | Accepted |
| [002-polling-worker](002-polling-worker.md) | Poll-based worker loop with event-driven wake-up | Accepted |
| [003-worktree-isolation](003-worktree-isolation.md) | Git worktrees for task isolation, shared by subtasks | Accepted |
| [004-serial-subtasks](004-serial-subtasks.md) | Serial subtask execution with single parent PR | Accepted |
| [005-model-selection](005-model-selection.md) | Stage-and-risk-driven model selection | Accepted |
| [006-claude-code-executor](006-claude-code-executor.md) | Spawn Claude Code as child process in non-interactive mode | Accepted |
```

- [ ] **Step 2: Create docs/gotchas/ with README**

```markdown
# Gotchas

Known pitfalls organized by subsystem. Each gotcha is failure-backed — it documents a real issue that caused an agent or developer to fail.

Every entry must pass the pruning test:
1. **Failure-backed?** — Can you point to a specific failure this prevents?
2. **Tool-enforceable?** — If yes, use a linter instead of documenting it.
3. **Decision-encoding?** — Does it capture a "why" not inferable from code?
4. **Triggerable?** — Is it context-specific (load on demand)?

If an entry fails all four, delete it.

## Files

- [imports.md](imports.md) — Module resolution gotchas
- [worker.md](worker.md) — Worker loop and task processing
- [subtasks.md](subtasks.md) — Subtask pipeline edge cases
- [database.md](database.md) — SQLite singleton and query patterns
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/README.md docs/gotchas/README.md
git commit -m "docs: add architecture and gotchas directory structure"
```

### Task 2: Write ADRs

**Files:**
- Create: `docs/architecture/001-sqlite-wal.md`
- Create: `docs/architecture/002-polling-worker.md`
- Create: `docs/architecture/003-worktree-isolation.md`
- Create: `docs/architecture/004-serial-subtasks.md`
- Create: `docs/architecture/005-model-selection.md`
- Create: `docs/architecture/006-claude-code-executor.md`

Each ADR follows this template:

```markdown
# ADR-NNN: Title

## Status
Accepted

## Context
[What problem were we solving? What constraints existed?]

## Decision
[What did we choose and why?]

## Consequences
### Positive
- [benefit]

### Negative
- [tradeoff]

### Risks
- [what could go wrong]
```

- [ ] **Step 1: Write ADR-001 — SQLite with WAL mode**

Context: Self-hosted tool running alongside a repo on a single machine. Need persistence for tasks, runs, artifacts, events. The Express server reads while the worker writes concurrently.

Decision: SQLite with WAL mode via `better-sqlite3`. Single connection singleton pattern (`getDatabase()`). Synchronous prepared statements. Snake_case DB columns mapped to camelCase TypeScript via row-conversion functions.

Consequences:
- Positive: Zero-config, no external database to manage, fast reads, simple deployment
- Negative: Single-writer limits throughput (acceptable for single-machine use case)
- Risks: If multi-server deployment is ever needed, SQLite becomes a bottleneck. WAL files can grow large under sustained write load.

- [ ] **Step 2: Write ADR-002 — Polling worker loop**

Context: Need a mechanism to pick up ready tasks and process them. Options: message queue, database polling, filesystem watches, pub/sub.

Decision: Poll DB every 5 seconds via `setTimeout` loop. Optimistic locking via `claimTask()` (conditional UPDATE on `claimed_at IS NULL`). Event-driven wake-up (`task:ready` EventEmitter) for immediate subtask promotion without waiting for next poll. `activeTasks` counter enforces `config.maxConcurrentTasks`.

Consequences:
- Positive: No external dependencies (no Redis/RabbitMQ), simple to reason about, graceful shutdown via drain loop
- Negative: 0-5s latency between task becoming ready and being claimed
- Risks: Polling interval is a tuning parameter — too fast wastes CPU, too slow delays tasks

- [ ] **Step 3: Write ADR-003 — Git worktree isolation**

Context: Multiple tasks may run concurrently. Each needs a clean working directory on its own branch without affecting the main checkout.

Decision: Each top-level task gets a `git worktree` at `.agentboard/worktrees/<taskId>/` on branch `<prefix><taskId>-<slug>`. Subtasks share their parent's worktree and branch — they accumulate commits on the same branch. Cleanup via `git worktree remove --force` + `git branch -D`.

Consequences:
- Positive: True isolation, no stashing/switching, concurrent execution
- Negative: Disk usage scales with concurrent tasks (each worktree is a full checkout)
- Risks: Subtask sharing means concurrent subtasks would conflict (mitigated by serial execution — see ADR-004). Worktree cleanup on failure is best-effort.

- [ ] **Step 4: Write ADR-004 — Serial subtask execution**

Context: Subtasks share a worktree and branch (ADR-003). Running them concurrently would cause merge conflicts.

Decision: Serial execution — first child task is `ready`, rest are `backlog`. On completion, `checkAndUpdateParentStatus()` promotes the next sibling. On failure, remaining siblings are cancelled. Parent creates a single PR after all subtasks succeed.

Consequences:
- Positive: No merge conflicts, predictable execution order, single PR per feature
- Negative: Total wall-clock time is sum of all subtask durations (no parallelism)
- Risks: A single failing subtask blocks the rest. Long subtask chains can monopolize a worktree.

- [ ] **Step 5: Write ADR-005 — Stage-and-risk-driven model selection**

Context: Different pipeline stages have different quality/cost tradeoffs. Only four stages actually invoke Claude Code: planner, implementer, review-spec, and review-code. The checks stage runs shell commands (test, lint, typecheck) and pr-creator runs `gh` CLI — neither uses an LLM.

Decision: `selectModel(stage, riskLevel, config)` consults `config.modelDefaults` per-stage for the four LLM-using stages. Implementation always uses Opus (hardcoded in `implementer.ts`, bypassing `selectModel`). High-risk tasks escalate review stages to Opus regardless of config. Planning and review stages respect config.

Consequences:
- Positive: Per-project cost control, risk-appropriate quality gates
- Negative: Implementation always using Opus means no cost savings there
- Risks: Model names evolve — the Opus hardcoding in implementer.ts needs updating when models change. The `selectModel` function maps checks/pr_creation stages to the implementation config key, but neither stage actually calls it — this dead mapping could cause confusion.

- [ ] **Step 6: Write ADR-006 — Claude Code executor**

Context: Need to invoke an AI coding agent to do the actual work in each stage. Agent must operate in the task's worktree with permission to edit files.

Decision: `spawn('claude', ['--print', '--model', model, '--permission-mode', 'acceptEdits'], { cwd: worktreePath })`. Prompt written to stdin, stdout/stderr streamed to UI via Socket.IO. 300s timeout. Token usage parsed from output with regex fallback.

Consequences:
- Positive: Claude Code handles all file editing, git operations, and tool use. Streaming gives real-time UI feedback.
- Negative: Tight coupling to Claude Code CLI interface. Changes to CLI flags break all stages.
- Risks: `acceptEdits` permission mode gives the agent broad write access. Timeout may be too short for complex tasks.

- [ ] **Step 7: Commit all ADRs**

```bash
git add docs/architecture/
git commit -m "docs: add architecture decision records for core design choices"
```

### Task 3: Write gotcha docs

**Files:**
- Create: `docs/gotchas/imports.md`
- Create: `docs/gotchas/worker.md`
- Create: `docs/gotchas/subtasks.md`
- Create: `docs/gotchas/database.md`

- [ ] **Step 1: Write docs/gotchas/imports.md**

```markdown
# Import Gotchas

## .js extension required on all imports

**Symptom:** `ERR_MODULE_NOT_FOUND` at runtime despite TypeScript compiling fine.

**Cause:** Project uses NodeNext module resolution. TypeScript compiles `.ts` → `.js` but does NOT rewrite import specifiers. If you write `import { foo } from './bar'`, Node looks for `./bar` (no extension) and fails.

**Fix:** Always use `.js` extension: `import { foo } from './bar.js'`

**Why not enforceable by linter?** ESLint's `import/extensions` rule doesn't understand NodeNext resolution well. This is enforced by convention.
```

- [ ] **Step 2: Write docs/gotchas/worker.md**

```markdown
# Worker Gotchas

## Recovery resets tasks claimed >30 minutes ago

**Symptom:** A long-running task mysteriously restarts from `ready`.

**Cause:** The recovery mechanism (`recoverStaleTasks()` in `src/worker/recovery.ts`, called at startup from `src/cli/up.ts`) resets any task where `claimed_at` is older than 30 minutes, assuming the worker crashed. If your task legitimately takes >30 minutes and the server restarts, it gets reclaimed.

**Fix:** If debugging long-running tasks, be aware of this timeout. The executor has a separate 300s (5 min) timeout — the 30-minute recovery is for crashed workers, not slow tasks.

## Executor changes affect all agent runs

**Symptom:** Changing `executor.ts` causes unexpected behavior across all pipeline stages.

**Cause:** Four stages (planner, implementer, review-spec, review-code) invoke Claude Code through the same `executeClaudeCode()` function in `executor.ts`. A change to spawn arguments, timeout handling, or output parsing affects all four stages.

**Fix:** Test changes to executor.ts against multiple stages, not just the one you're working on. Note: checks and pr-creator do NOT use `executeClaudeCode()` — they run shell commands directly.
```

- [ ] **Step 3: Write docs/gotchas/subtasks.md**

```markdown
# Subtask Gotchas

## Subtasks have NO git_refs — use parent's

**Symptom:** `git_refs` lookup returns null for a subtask.

**Cause:** Only parent tasks create worktrees and git_refs entries. Subtasks share the parent's worktree. Code that needs a worktree path or branch for a subtask must fall back to `task.parentTaskId`.

**Fix:** Always check `task.parentTaskId` when looking up git_refs: `getGitRefs(task.parentTaskId ?? task.id)`.

## Task object goes stale after claim

**Symptom:** `checkAndUpdateParentStatus` makes wrong decisions based on outdated status.

**Cause:** The `task` object is fetched once at claim time and passed through `processTask → runImplementationLoop → runReviewAndPR`. Its `.status` reflects claim-time state, not current state.

**Fix:** Any function making decisions based on `task.status` must re-fetch from DB: `const fresh = getTask(task.id)`.

## commitChanges() returns empty string when nothing to commit

**Symptom:** Review retry fails or produces confusing logs.

**Cause:** After a review cycle requests changes, the implementer may have already committed the fix in the previous cycle. `commitChanges()` returns `''` (empty string) when there are no staged changes.

**Fix:** Callers must handle the empty-string return gracefully — it's a normal condition, not an error.

## Failed subtask must cancel backlog siblings

**Symptom:** Parent task stuck in `implementing` forever.

**Cause:** `checkAndUpdateParentStatus` only resolves the parent when all children are in terminal states (`done`, `failed`, `cancelled`). `backlog` is non-terminal. If a subtask fails without cancelling its backlog siblings, the parent can never resolve.

**Fix:** On subtask failure, cancel all remaining `backlog` siblings before calling `checkAndUpdateParentStatus`.

## checkAndUpdateParentStatus is async — always await it

**Symptom:** Parent status not updated, PR not created, race conditions.

**Cause:** `checkAndUpdateParentStatus` triggers PR creation for the parent when all subtasks succeed. It's async because PR creation involves git push and `gh pr create`.

**Fix:** Every call site must `await checkAndUpdateParentStatus(...)`.
```

- [ ] **Step 4: Write docs/gotchas/database.md**

```markdown
# Database Gotchas

## Singleton connection — don't create new ones

**Symptom:** Database locked errors or data not visible between components.

**Cause:** The DB uses a singleton pattern via `getDatabase()`. Creating a second connection to the same SQLite file can cause WAL contention or see stale data.

**Fix:** Always use `getDatabase()` — never construct a new `Database()` instance.

## Snake_case in DB, camelCase in TypeScript

**Symptom:** Property undefined when accessing a DB row directly.

**Cause:** SQLite columns use `snake_case` (`parent_task_id`), but TypeScript interfaces use `camelCase` (`parentTaskId`). Raw query results have snake_case keys.

**Fix:** Always use row-conversion functions (`rowToTask`, `rowToProject`, etc.) from `queries.ts`. Never access raw row properties directly.
```

- [ ] **Step 5: Commit gotcha docs**

```bash
git add docs/gotchas/
git commit -m "docs: add structured gotcha docs by subsystem"
```

### Task 4: Create AGENTS.md and symlink CLAUDE.md

**Files:**
- Create: `AGENTS.md`
- Remove: `CLAUDE.md`
- Create: `CLAUDE.md` (symlink → `AGENTS.md`)

- [ ] **Step 1: Write AGENTS.md**

Lean root doc under 100 lines. References point to detailed docs.

```markdown
# Agentboard

Self-hosted Kanban board that orchestrates AI coding agents through a pipeline:
planning → implementation → checks → review → PR creation.
Built with TypeScript, Express, SQLite, Socket.IO, React + Tailwind.

## Commands

npm run build          # Compile TypeScript + build React UI
npm run build:server   # TypeScript only
npm run build:ui       # React/Vite UI only
npm run dev            # Watch mode with auto-reload (tsx)
npm start              # Run compiled dist/bin/agentboard.js

### Testing

npm test               # Run backend tests
npm run test:watch     # Watch mode
npm run test:coverage  # Backend tests with coverage report

### CLI

agentboard init        # Initialize .agentboard/ config in a repo
agentboard up          # Start server + worker
agentboard down        # Graceful shutdown
agentboard doctor      # Verify prerequisites (git, gh, node, claude)

## Code Style & Conventions

- ES module imports with `.js` extensions (even for .ts files) — see [docs/gotchas/imports.md](docs/gotchas/imports.md)
- `console.log` with bracketed prefixes: `[worker]`, `[http]`, `[recovery]`
- Prepared statements for all DB queries (see src/db/queries.ts)
- snake_case DB columns → camelCase TypeScript via row-conversion functions
- `execFile` (promisified) for shell commands, never `exec`
- Prompt templates in `prompts/` as markdown files
- Follow existing stage patterns in `src/worker/stages/`

## Testing Requirements

- Co-locate tests: `foo.ts` → `foo.test.ts`, `Bar.tsx` → `Bar.test.tsx`
- `createTestDb()` from `src/test/helpers.ts` for in-memory DB per test
- `createTestRepo()` for tests needing real git repos (auto-cleaned)
- `createTestApp()` for API route tests with supertest
- Backend: Node environment. UI: jsdom. E2E: Playwright in `e2e/`
- Run `npm test` before committing

## Architecture & Boundaries

3 layers: CLI (`src/cli/`) → Server+Worker (`src/server/`, `src/worker/`) → DB (`src/db/`)

Pipeline: backlog → ready → planning → implementing → checks → review_spec → review_code → pr_creation → needs_human_review → done

Subtasks execute serially. First child is `ready`, rest `backlog`. Parent creates single PR after all succeed.

See [docs/architecture/](docs/architecture/) for ADRs on key design decisions.
See [docs/gotchas/](docs/gotchas/) for known pitfalls by subsystem.

## Never Do / Always Ask First

- Don't use `any` — strict TypeScript throughout
- Don't add dependencies without discussion
- Don't modify the worker loop's 5-second polling or stage ordering without understanding the full pipeline
- Don't commit directly to master — agentboard creates feature branches per task
- Don't hardcode model names — use config.modelDefaults and model-selector.ts
- Don't create new DB connections — use `getDatabase()` singleton

## References

- [docs/architecture/](docs/architecture/) — Architecture Decision Records
- [docs/gotchas/](docs/gotchas/) — Known pitfalls by subsystem
- [prompts/](prompts/) — Prompt templates for each pipeline stage
- [src/types/index.ts](src/types/index.ts) — All shared interfaces and type unions
```

- [ ] **Step 2: Remove CLAUDE.md from git tracking and create symlink**

```bash
git rm CLAUDE.md
ln -s AGENTS.md CLAUDE.md
```

- [ ] **Step 3: Verify symlink works**

```bash
ls -la CLAUDE.md  # Should show CLAUDE.md -> AGENTS.md
cat CLAUDE.md      # Should show AGENTS.md content
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md CLAUDE.md
git commit -m "docs: make AGENTS.md source of truth, symlink CLAUDE.md"
```

## Chunk 2: Enhance maintaining-agents-md Skill

### Task 5: Add progressive disclosure and ADR references to skill

**Files:**
- Modify: `~/.claude/skills/maintaining-agents-md/SKILL.md`
- Create: `~/.claude/skills/maintaining-agents-md/progressive-disclosure.md`
- Create: `~/.claude/skills/maintaining-agents-md/adr-lifecycle.md`
- Create: `~/.claude/skills/maintaining-agents-md/gotcha-guidelines.md`
- Modify: `~/.claude/skills/maintaining-agents-md/file-template.md`

- [ ] **Step 1: Create progressive-disclosure.md**

This reference doc teaches the hot/warm/cold memory hierarchy:

```markdown
# Progressive Disclosure

Agent-facing docs follow a three-tier hierarchy. Single-file manifests do not scale beyond modest codebases.

## Tiers

### Hot (AGENTS.md) — Always loaded
- Under 100 lines, ideally under 80
- Commands, conventions, boundaries, references to deeper docs
- Every line must pass the 4-question pruning test (see gotcha-guidelines.md)

### Warm (on-demand docs) — Loaded when relevant
- ADRs in `docs/architecture/` — loaded when modifying related subsystems
- Gotcha docs in `docs/gotchas/` — loaded when working in specific areas
- Referenced via `See [docs/architecture/003-worktree-isolation.md]` patterns

### Cold (deep reference) — Loaded only when specifically needed
- Design specs, RFCs, meeting notes
- Full API documentation
- Historical decision context

## AGENTS.md as Index

The root AGENTS.md is a lean index. Detailed content lives in reference docs.
Instead of a 30-line Gotchas section in AGENTS.md, write:

```
See [docs/gotchas/](docs/gotchas/) for known pitfalls by subsystem.
```

## When to Extract

Extract content from AGENTS.md into a reference doc when:
- A section exceeds ~30 lines
- Content is only relevant to a specific subsystem
- The total file exceeds 100 lines
- Information changes frequently (ADRs are more stable than inline notes)

## CLAUDE.md Symlink Convention

AGENTS.md is the cross-tool standard (supported by Codex, Cursor, Jules, Amp, Factory).
For Claude Code compatibility, create a symlink:

```bash
ln -s AGENTS.md CLAUDE.md
```

The skill should detect and maintain this symlink. When updating AGENTS.md, verify the symlink still works. When initializing a new project, offer to create both.
```

- [ ] **Step 2: Create adr-lifecycle.md**

```markdown
# ADR Lifecycle

Architecture Decision Records capture the "why" behind choices that agents cannot infer from code.

## When to Create an ADR

- A new architectural pattern is introduced
- A technology choice is made (database, framework, protocol)
- A non-obvious constraint shapes the design
- The team explicitly decides NOT to do something

## When to Update an ADR

- The decision is superseded (mark old as "Superseded by ADR-NNN")
- New consequences are discovered
- Context has materially changed

## Template

```markdown
# ADR-NNN: Title

## Status
Accepted | Superseded by ADR-NNN | Deprecated

## Context
[What problem were we solving? What constraints existed?]

## Decision
[What did we choose and why?]

## Consequences
### Positive
- [benefit]

### Negative
- [tradeoff]

### Risks
- [what could go wrong]
```

## Directory Convention

ADRs live in `docs/architecture/` with a README.md index table.
Number sequentially: `001-sqlite-wal.md`, `002-polling-worker.md`.

## Referencing ADRs from AGENTS.md

The Architecture & Boundaries section of AGENTS.md should include:
```
See [docs/architecture/](docs/architecture/) for ADRs on key design decisions.
```

Individual gotcha docs or code comments can reference specific ADRs:
```
<!-- See ADR-003 for why subtasks share worktrees -->
```

## Self-Update Integration

After completing a task that introduced a new architectural pattern, the maintaining-agents-md self-update loop should ask:
"Did this introduce a new architectural decision? If yes, suggest creating an ADR."
```

- [ ] **Step 3: Create gotcha-guidelines.md**

```markdown
# Gotcha Documentation Guidelines

## The 4-Question Pruning Test

Every gotcha entry must pass at least one of these tests:

1. **Failure-backed?** Can you point to a specific failure this prevents?
2. **Tool-enforceable?** If yes, enforce with a linter/CI check instead of documenting.
3. **Decision-encoding?** Does it capture a "why" the agent cannot infer from code?
4. **Triggerable?** Does it apply only in specific contexts? (If so, put it in a subsystem-specific doc, not the root AGENTS.md.)

If an entry fails all four tests, delete it.

## Gotcha Entry Format

```markdown
## Short descriptive title

**Symptom:** What you observe when you hit this issue.

**Cause:** Why it happens (the non-obvious part).

**Fix:** What to do about it.
```

Optional: add a **Why not enforceable?** line if the gotcha seems like it could be a linter rule but can't be.

## Where Gotchas Live

- `docs/gotchas/<subsystem>.md` — per-subsystem gotcha files
- `docs/gotchas/README.md` — index with the pruning test and file list
- AGENTS.md links to `docs/gotchas/` in the References section

## Gotcha Decay

Gotchas should be reviewed periodically. If the underlying issue is fixed (e.g., a linter rule now catches it, or the code was refactored to make it impossible), remove the gotcha.

## Self-Update Integration

After completing a task where an agent hit an unexpected issue, the maintaining-agents-md self-update loop should ask:
"Did I encounter a non-obvious pitfall? If yes, suggest adding a gotcha entry."
```

- [ ] **Step 4: Update file-template.md**

Add a `References` section to the canonical skeleton pointing to the doc hierarchy. Update the Architecture & Boundaries section to mention ADRs. Add the symlink note.

The updated canonical skeleton should include:

```
## References
<pointers to docs/architecture/, docs/gotchas/, and other reference docs>
```

And the Architecture & Boundaries description should note:
```
<key modules, data flow, what not to touch — link to docs/architecture/ for ADRs>
```

- [ ] **Step 5: Update SKILL.md**

Add to the existing skill:

1. **Progressive disclosure awareness** — add a reference to `progressive-disclosure.md` in the Hard Rules section:
   - Update hard rule 4 from "Files must stay under 150 lines" to: "Root AGENTS.md must stay under 100 lines; other AGENTS.md files under 150 lines — extract to reference docs using progressive disclosure (see progressive-disclosure.md)"
   - New hard rule: "Detect and maintain CLAUDE.md symlinks — never overwrite a symlink with a regular file"

2. **ADR lifecycle integration** — add to the Self-Update Loop:
   - After "Did I learn a new command, convention, or boundary?" add: "Did this introduce a new architectural decision? If yes, suggest creating an ADR (see adr-lifecycle.md)"

3. **Gotcha integration** — add to the Self-Update Loop:
   - "Did I encounter a non-obvious pitfall? If yes, suggest adding a gotcha entry (see gotcha-guidelines.md)"

4. **References section** at the bottom:
   ```
   ## Reference Docs
   - [progressive-disclosure.md](progressive-disclosure.md) — Hot/warm/cold doc hierarchy
   - [adr-lifecycle.md](adr-lifecycle.md) — When and how to create/update ADRs
   - [gotcha-guidelines.md](gotcha-guidelines.md) — Pruning test and entry format for gotchas
   ```

- [ ] **Step 6: Verify skill files are written correctly**

The skill directory at `~/.claude/skills/maintaining-agents-md/` is not a git repo — no commit needed. Verify all files exist and are well-formed:

```bash
ls -la ~/.claude/skills/maintaining-agents-md/
# Expected: SKILL.md, file-template.md, hierarchy-rules.md,
#   progressive-disclosure.md, adr-lifecycle.md, gotcha-guidelines.md
```

### Task 6: Verify everything works end-to-end

- [ ] **Step 1: Verify CLAUDE.md symlink resolves**

```bash
cd /home/user/Personal/agentboard
cat CLAUDE.md | head -5
# Should show "# Agentboard" from AGENTS.md
```

- [ ] **Step 2: Verify AGENTS.md is under 100 lines**

```bash
wc -l AGENTS.md
# Should be under 100
```

- [ ] **Step 3: Verify all reference links resolve**

Check that every path referenced in AGENTS.md exists:
- `docs/architecture/` directory with README and 6 ADRs
- `docs/gotchas/` directory with README and 4 subsystem docs
- `prompts/` directory
- `src/types/index.ts`

- [ ] **Step 4: Verify skill files are complete**

```bash
ls ~/.claude/skills/maintaining-agents-md/
# Should show: SKILL.md, file-template.md, hierarchy-rules.md,
#   progressive-disclosure.md, adr-lifecycle.md, gotcha-guidelines.md
```

- [ ] **Step 5: Run npm test to verify nothing is broken**

```bash
cd /home/user/Personal/agentboard
npm test
```

- [ ] **Step 6: Final commit if any fixups needed**
