# Decision Log

> Architectural and design decisions for agentboard. Append new decisions at the bottom. For detailed rationale, see linked ADRs.

---

## 2026-03-16: Single log file per task

**Context:** Separate log files per subtask vs single file per parent task.
**Decision:** Single append-only file at `.agentboard/logs/{taskId}.log` with indented subtask sections.
**Why:** Easier end-to-end reading. Avoids file explosion. Subtask context only makes sense within the parent.
**See also:** Superseded by per-stage log files (2026-03-17 entry below).

## 2026-03-16: execFile over exec for all shell commands

**Context:** Need to run git, gh, claude CLI commands from the worker.
**Decision:** Always use `execFile` (promisified), never `exec`.
**Why:** `exec` runs through a shell, vulnerable to command injection. `execFile` passes arguments as an array.
**See also:** [common/security.md](../.claude/rules/common/security.md), [typescript/security.md](../.claude/rules/typescript/security.md)

## 2026-03-16: Subtasks are fully autonomous

**Context:** Subtasks could go through the same full pipeline as parent tasks.
**Decision:** Subtasks go `ready → implement → checks → (inline fix) → code_quality → done|failed|blocked`. No spec, no planning, no PR.
**Why:** Subtasks are scoped by the parent's plan. Full pipeline would multiply cost for marginal gain.
**See also:** [ADR-004](architecture/004-serial-subtasks.md), [gotchas/subtasks.md](gotchas/subtasks.md)

## ~~2026-03-16: Unanimous review panel~~ SUPERSEDED

**Superseded by:** 2026-03-17 superpowers workflow. Replaced by single code-quality reviewer + holistic final review.

## 2026-03-16: Project-scoped ECC rules

**Context:** ECC rules can be global (`~/.claude/rules/`) or per-project (`.claude/rules/`).
**Decision:** Project-scoped at `.claude/rules/`.
**Why:** Agentboard conventions (console.log prefixes, prepared statements, stage patterns) are project-specific.
**See also:** [learning-scope.md](../.claude/rules/common/learning-scope.md)

## 2026-03-16: Project-scoped learnings only

**Context:** ECC's learn-eval can save globally or per-project.
**Decision:** All learnings save to `.claude/skills/learned/` (project), never `~/.claude/skills/learned/` (global).
**Why:** Agentboard patterns would confuse agents in other projects.

## 2026-03-17: Global database, global CLI, per-project config

**Context:** Initially one project per `.agentboard/` directory. Needed multi-project orchestration.
**Decision:** Single shared SQLite at `~/.agentboard/agentboard.db`. Per-project state stays in each repo's `.agentboard/`.
**Why:** Simplifies cross-project task tracking. Global CLI avoids needing to cd into repos.
**See also:** [ADR-001](architecture/001-sqlite-wal.md), [gotchas/database.md](gotchas/database.md)

## 2026-03-17: Spec-driven task creation with plan review gate

**Context:** PMs typed short descriptions, AI auto-filled everything, pipeline ran fully autonomous. Spec quality was poor.
**Decision:** PM writes detailed spec via guided chat UI. After AI planning, task pauses at `needs_plan_review` for engineer approval.
**Why:** PM domain knowledge is source of truth for "what." Engineers validate "how" before compute is spent.
**See also:** [ADR-007](architecture/007-superpowers-workflow.md), [pipeline-stages.md](pipeline-stages.md) (Stages 0-2)

## 2026-03-17: Post-task learning extraction

**Context:** Patterns extracted manually. Reactive and relies on manual invocation.
**Decision:** Fire-and-forget `extractLearnings()` spawns `claude --print` with learner prompt after each task terminal state.
**Why:** Captures non-obvious patterns while context is fresh. Haiku model is cost-effective.
**See also:** [pipeline-stages.md](pipeline-stages.md) (Stage 9)

## 2026-03-17: Superpowers-inspired workflow rewrite

**Context:** Old pipeline had no spec quality gate, coarse subtasks, late-catching of "built the wrong thing," 5-retry loops.
**Decision:** Full rewrite: conversational spec building, automated spec review, single-shot implementation, inline fix (not 5-retry loop), per-subtask code quality, holistic final review, opus everywhere.
**Why:** Better specs → better plans → higher first-pass success → less wasted compute.
**See also:** [ADR-007](architecture/007-superpowers-workflow.md), [pipeline-stages.md](pipeline-stages.md)

## 2026-03-17: Stage-wise log streaming

**Context:** Logs were monolithic per task. No stage boundaries. Users couldn't answer "what happened during planning?"
**Decision:** Per-stage log files + DB indexing via `stage_logs` table. `StageRunner` wraps execution with DB records + Socket.IO broadcasts. HTTP Range support for efficient tailing.
**Why:** Structured logs enable stage-level debugging. Range requests enable efficient tailing.
**See also:** [api-routes.md](api-routes.md) (Stage Logs), [gotchas/worker.md](gotchas/worker.md)

## 2026-03-18: Persistent chat sessions

**Context:** Chat replayed full history on each message. Added latency and token overhead.
**Decision:** Use Claude Code's `--session-id` / `--resume`. Fallback to history replay if resume fails.
**Why:** Native session persistence eliminates token waste. Fallback maintains robustness.
**See also:** [pipeline-stages.md](pipeline-stages.md) (Stage 0)

## 2026-03-18: Integer task IDs

**Context:** Task IDs were UUIDs. URLs ugly, tasks hard to reference.
**Decision:** Auto-incrementing integers. Full-page task view at `/tasks/:id`. Data-preserving migration.
**Why:** Simpler for self-hosted tool. Clean URLs. Shareable/bookmarkable.

## 2026-03-18: Read-only guardrails for brainstorming agent

**Context:** Brainstorming agent could edit files and run shell commands without guardrails.
**Decision:** Spawn with `--tools Read,Glob,Grep`. System prompt enforces conversation-only mode.
**Why:** Defense-in-depth: tool restrictions prevent accidental edits; system prompt provides role clarity.
**See also:** [pipeline-stages.md](pipeline-stages.md) (Stage 0)

## 2026-03-18: Per-stage tool permissions

**Context:** All stages had same broad permissions. Review stages should be read-only.
**Decision:** Per-stage `--tools` lists centralized in `src/worker/stage-tools.ts`. Read-only for reviews, full-access for implementation.
**Why:** Principle of least privilege. Review stages that accidentally write files corrupt the worktree.
**See also:** [pipeline-stages.md](pipeline-stages.md) (Tool Presets)

## 2026-03-19: Full ruflo integration

**Context:** Need automated agent routing, cross-session learning, portable intelligence.
**Decision:** Integrate ruflo v3.5 with hooks, daemon workers, memory, neural training, guidance compilation.
**Why:** Maximum automation for single-developer. Zero-manual-effort sessions.
**See also:** [ADR-008](architecture/008-ruflo-integration.md), `docs/ruflo-setup.md`

## 2026-03-19: Lightpanda + Playwright for browser testing

**Context:** React UI had zero browser tests.
**Decision:** Lightpanda as CDP backend for Playwright. Tests in `browser-tests/`.
**Why:** 11x faster than Chrome, 9x less memory. CDP-compatible.
**See also:** [browser-testing.md](browser-testing.md)
