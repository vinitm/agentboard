# Decision Log

Architectural and design decisions for agentboard. Read this before working on the project to understand why things are the way they are. Append new decisions at the bottom.

---

## 2026-03-16: Single log file per task, not per subtask
**Context:** Considered separate log files per subtask vs single file per parent task.
**Decision:** Single append-only file at `.agentboard/logs/{taskId}.log` with indented sections for subtasks.
**Why:** Easier to read end-to-end. Avoids file explosion. Subtask context only makes sense within the parent's context.
**Consequences:** Parallel review panel stages need `BufferedWriter` (collect in memory, flush sequentially) to avoid interleaved output.

## 2026-03-16: execFile over exec for all shell commands
**Context:** Need to run git, gh, claude CLI commands from the worker.
**Decision:** Always use `execFile` (promisified), never `exec`.
**Why:** `exec` is vulnerable to command injection — it runs through a shell. `execFile` passes arguments as an array, bypassing the shell.
**Consequences:** Can't use shell features like pipes. Must handle argument arrays explicitly.

## 2026-03-16: Subtasks are fully autonomous with per-subtask code quality review
**Context:** Subtasks could go through the same pipeline as parent tasks (spec → plan → implement → review → PR).
**Decision:** Subtasks go `ready → implement → checks → (inline fix) → code_quality → done|failed|blocked`. No spec, no planning, no PR. Per-subtask code quality review catches issues early.
**Why:** Subtasks are scoped by the parent's plan. A full pipeline would multiply cost for marginal gain. But per-subtask code quality review prevents issues from compounding across subtasks.
**Consequences:** Subtask quality depends on the parent's spec quality, the inline fix mechanism, and per-subtask code quality review.

## ~~2026-03-16: Unanimous review panel (all 3 must pass)~~ SUPERSEDED
**Superseded by:** 2026-03-17 superpowers workflow. Replaced by single code-quality reviewer per subtask + holistic final review.

## 2026-03-16: ECC rules installed project-scoped, not global
**Context:** ECC rules can be installed globally (`~/.claude/rules/`) or per-project (`.claude/rules/`).
**Decision:** Project-scoped installation at `.claude/rules/`.
**Why:** Agentboard has project-specific conventions (console.log prefixes, prepared statements, stage patterns) that shouldn't affect other projects. Project-scoped rules travel with the repo.
**Consequences:** Other projects don't benefit from these rules. Contributors need no global ECC setup.

## 2026-03-16: ECC learnings are project-scoped only
**Context:** ECC's learn-eval can save globally or per-project.
**Decision:** All learnings save to `.claude/skills/learned/` (project), never `~/.claude/skills/learned/` (global).
**Why:** Agentboard patterns (inline fix, BufferedWriter, stage contracts, per-subtask review) are project-specific and would confuse agents in other projects.
**Consequences:** Learnings don't transfer to other projects. This is intentional.

## 2026-03-17: Global database, global CLI, per-project config
**Context:** Agentboard initially supported one project per `.agentboard/` directory. Now needed to orchestrate multiple projects from a single server.
**Decision:** Single shared SQLite at `~/.agentboard/agentboard.db` (global). `agentboard up/down/doctor` work from anywhere. Per-project state (worktrees, logs, config, memory) stays in each repo's `.agentboard/`.
**Why:** Single database simplifies cross-project task tracking and multi-task scheduling. Global CLI avoids needing to cd into repos. Per-project config allows project-specific settings (models, commands, review rules) without coupling.
**Consequences:** Database location changes from `<repo>/.agentboard/agentboard.db` to `~/.agentboard/agentboard.db`. Migration required for existing deployments. Projects are now indexed by `projects` table. Server-level settings move to `~/.agentboard/server.json`.

## 2026-03-17: Spec-driven task creation with plan review gate
**Context:** Previously, PMs typed a short description, AI auto-filled everything, and the pipeline ran end-to-end autonomously. Spec quality was poor (AI guessing) and engineers had no checkpoint before autonomous execution.
**Decision:** PM writes detailed spec via guided UI (6 sections: problem statement, user stories, acceptance criteria, constraints, out of scope, verification strategy) with per-field AI assistance. AI spec-generator stage removed. After AI planning, task pauses at `needs_plan_review` for engineer to review/edit/approve. Rejection sends back to planning with feedback. After approval, pipeline runs fully autonomously.
**Why:** PM's domain knowledge is the source of truth for "what" — AI should assist, not replace. Engineers should validate "how" before compute is spent on implementation. This separation (PM specs what → engineer validates how → agent executes) prevents wasted cycles on bad specs or wrong approaches.
**Consequences:** Pipeline changes from `spec → planning → implementing` to `spec_review → planning → needs_plan_review → implementing`. New API endpoints: `POST /api/tasks/:id/chat/stream` (SSE streaming spec chat), `POST /api/tasks/:id/review-plan` (approve/reject). Worker loop detects approved plans via `plan_review_approved` event and skips re-planning.

## 2026-03-17: Post-task learning extraction via claude --print
**Context:** After task completion, the pipeline collects quantitative metrics (tokens, duration, attempts, check failures). But patterns are extracted manually by developers, requiring `/everything-claude-code:learn-eval`. This is reactive and relies on manual invocation.
**Decision:** After each task reaches a terminal state (done/failed), fire-and-forget `extractLearnings()` spawns `claude --print` with a learner prompt that analyzes the task's execution summary and automatically saves reusable patterns to `.claude/skills/learned/`. Non-blocking: failures are logged but never change task outcomes. Model selection is configurable via `config.modelDefaults.learning` (defaults to haiku). Prompt template in `prompts/learner.md`.
**Why:** Automated extraction captures non-obvious patterns while context is fresh (implementation attempts, check failures, reviewer feedback). Fire-and-forget ensures learning never blocks the pipeline. Project-scoped learnings prevent cross-contamination with other projects' patterns. Haiku model is cost-effective for lightweight pattern analysis.
**Consequences:** Pipeline's learner stage now has dual responsibilities: quantitative metrics (`recordLearning()` → `.agentboard/learning-log.jsonl`) and qualitative patterns (`extractLearnings()` → `.claude/skills/learned/`). New `learning` key in `ModelDefaults` interface. All 6 `recordLearning()` call sites in worker loop trigger `extractLearnings()` as fire-and-forget. `config-compat.ts` defaults `learning: 'haiku'` for backward compatibility. Learning extraction can be toggled by users via `config.modelDefaults.learning = null` (though not yet implemented in CLI init).

## 2026-03-17: Superpowers-inspired workflow rewrite
**Context:** The old pipeline (form-based spec → coarse subtasks → ralph loop with 5 retries → 3-reviewer panel) had several weaknesses: no spec quality gate, subtasks too coarse, no per-subtask review, late-catching of "built the wrong thing," and retry-based loops that wasted compute.
**Decision:** Rewrote the entire pipeline inspired by [obra/superpowers](https://github.com/obra/superpowers). Key changes:
1. **Conversational spec building** — PM chats with AI via streaming SSE endpoint; spec emerges from conversation instead of form fields
2. **Automated spec review** — gate before planning checks completeness, testability, scope
3. **Bite-sized TDD subtasks** — planner decides granularity (2-10 subtasks), each with TDD steps and exact file paths
4. **Automated plan review** — AI validates plan before human sees it
5. **Single-shot implementation** — no ralph loop; implementer reports structured status (DONE/NEEDS_CONTEXT/BLOCKED)
6. **Inline fix** — if checks fail, one targeted fix attempt, then escalate (not 5-retry loop)
7. **Per-subtask code quality** — single reviewer per subtask (replaces 3 parallel reviewers at end)
8. **Final review** — holistic cross-subtask review with spec compliance check before PR
9. **Opus everywhere** — simplified model selection, no stage-based model routing
**Why:** Better specs → better plans → smaller subtasks → higher first-pass success → less wasted compute. Per-subtask review catches issues before they compound. Structured status enables intelligent escalation instead of blind retries.
**Consequences:** Removed: ralph-loop.ts, review-panel.ts, spec-generator.ts, 3 review prompts, implementer-fallback.md. Added: spec-review, code-quality, final-review stages, inline-fix module, streaming chat endpoint, brainstorming prompt. New DB table: chat_messages. New statuses: spec_review, code_quality, final_review, pr_creation. See `docs/architecture/007-superpowers-workflow.md` for full design.

## 2026-03-17: Stage-wise log streaming and persistence
**Context:** Agent output during pipeline execution was streamed via Socket.IO but not easily reviewable after the fact. Logs were monolithic per task with no stage boundaries. Users couldn't see "what happened during the planning stage?" without scrolling through a flat log.
**Decision:** Implement per-stage log files (`.agentboard/logs/{taskId}/{stage}.log` or `.agentboard/logs/{taskId}/subtask-{subtaskId}/{stage}.log` for retries) with DB indexing via new `stage_logs` table. `StageRunner` wraps each stage execution to create/update DB records and broadcast `stage:transition` events with metadata (status, duration, tokens). New API endpoints `GET /api/tasks/:id/stages` and `GET /api/tasks/:id/stages/:stageLogId/logs` with HTTP Range support for efficient log viewing. UI uses `StageAccordion` component to show expandable per-stage summaries, replacing flat `LogViewer`.
**Why:** Structured logs enable "which stage failed?" and "why did planning take 15 mins?" questions without parsing flat text. DB index provides O(1) lookup for stage metadata. Per-stage files prevent log explosion (only active stages write). Range requests enable efficient tailing for long-running stages.
**Consequences:** New `stage_logs` table with indexes on `(task_id, started_at)`, `project_id`, and `status`. All stages now use `StageRunner.execute()` which handles file I/O, DB writes, and Socket.IO broadcasts. Old `task_logs` and monolithic `log-writer.ts` kept for backward compatibility but become dead code once all stages use `StageRunner`. Socket.IO `run:log` event now includes `stage` and `subtaskId` fields. New `stage:transition` event broadcasts start/completion of each stage. UI default view changed from `LogViewer` to `StageAccordion`.

## 2026-03-18: Persistent chat sessions via --session-id/--resume
**Context:** Conversational spec building initially replayed full chat history on each message, reconstructing context from `chat_messages` table. This added latency, token overhead, and UX friction (user sees repetitive history scrolling in Claude output).
**Decision:** Use Claude Code's native session persistence with `--session-id` (first message) and `--resume` (subsequent messages) instead of history replay. Session ID stored on `tasks.chat_session_id` after first message. If resume fails ("No conversation found"), gracefully fall back to spawning a fresh session with full chat history replayed as context in the first message.
**Why:** Native session persistence preserves conversation state server-side (Claude Code) without our overhead. Eliminates token waste from history replay. Cleaner UX. Fallback maintains robustness if session expires or is invalidated.
**Consequences:** New field `chatSessionId` on Task. Chat endpoint (`POST /api/tasks/:id/chat/stream`) detects first message, allocates session ID, then uses resume for subsequent messages. On resume failure, fallback spawns fresh session with history replayed in `buildStdinContent()`. Requires Claude Code version with `--session-id` and `--resume` support.

## 2026-03-18: Integer task IDs and frontend routing
**Context:** Task IDs were UUIDs (`TEXT PRIMARY KEY`), making URLs ugly (`/tasks/1ba25c56-661b-...`) and tasks hard to reference. Clicking a task card on the board opened an inline modal with no URL change — not shareable or bookmarkable.
**Decision:** Replace UUID task IDs with global auto-incrementing integers (`INTEGER PRIMARY KEY AUTOINCREMENT`). Remove the inline `TaskDetail` modal from the Board — all task views navigate to `/tasks/:id` as a full page. Data-preserving migration (`migrateTaskIdsToInteger` in `schema.ts`) converts old UUID-based DBs at startup by mapping UUIDs to sequential integers ordered by `created_at`.
**Why:** Integers are simpler for a self-hosted tool (no distributed collision concerns). Clean URLs (`/tasks/42`). Full-page task view is shareable and bookmarkable. Eliminates dual ID confusion.
**Consequences:** `Task.id` is `number` everywhere (types, queries, routes, worker, UI). All FK columns referencing tasks are `INTEGER`. `parseTaskId()` helper in route files validates and parses `req.params.id`. `TaskDetail.tsx` deleted — `TaskPage.tsx` gained all action panels. TaskCard displays `#ID`. Invalid (non-numeric) task IDs return 400.

## 2026-03-18: Read-only guardrails for brainstorming agent
**Context:** The brainstorming agent (spec builder) is a conversational assistant that should only help PMs define WHAT to build, not implement it. Without guardrails, the agent could edit files, run shell commands, or suggest code changes — violating its role boundary.
**Decision:** Implement tool restrictions at spawn time: brainstorming agent spawned with `--tools Read,Glob,Grep` (read-only tools only). System prompt (`prompts/brainstorming-system.md`) enforces role boundaries: "You are CONVERSATION-ONLY… NEVER edit, write, or create files… NEVER run shell commands… NEVER suggest code changes or diffs."
**Why:** Defense-in-depth: tool restrictions prevent accidental edits; system prompt provides human-readable role clarity. Guardrails ensure agent stays in its lane (spec definition, not implementation). Matches product boundaries (PM specifies, engineer plans, agent implements).
**Consequences:** Brainstorming agent cannot modify the worktree. If PM asks "make this change", agent reminds them that's out of scope. System prompt is the source of truth for role definition. Tool restrictions are enforced at spawn time in `buildSpawnArgs()` helper, independent of system prompt (defense-in-depth).

## 2026-03-18: Per-stage tool permissions for Claude CLI
**Context:** All pipeline stages spawned Claude with `--permission-mode acceptEdits`, giving every stage the same broad permissions (write files, run shell commands). Review and planning stages should be read-only — they only need to read code, not modify it. The brainstorming agent already used `--tools Read,Glob,Grep` successfully.
**Decision:** Replace blanket `--permission-mode acceptEdits` with per-stage `--tools` lists. Centralized in `src/worker/stage-tools.ts` with two presets: `read-only` (Read, Glob, Grep) for spec_review, planning, code_quality, final_review, learner; `full-access` (Read, Write, Edit, Bash, Glob, Grep) for implementing and inline_fix. Unknown stages default to read-only. The `executeClaudeCode()` executor accepts an optional `tools` array — when provided, it uses `--tools` instead of `--permission-mode`.
**Why:** Principle of least privilege. Review stages that accidentally write files or run commands can corrupt the worktree or produce misleading results. Matches the existing brainstorming agent pattern.
**Consequences:** Each stage caller passes `tools: getToolsForStage('stage_name')`. Backward compatible: omitting `tools` still falls back to `--permission-mode acceptEdits`. Future per-project overrides can be added by extending the preset map.

## 2026-03-19: Full ruflo integration for AI agent orchestration
**Context:** Need automated agent routing, cross-session learning, and portable intelligence. Ruflo v3.5 connected as MCP server but unconfigured.
**Decision:** Integrate ruflo v3.5 with all features: hooks (SessionStart, UserPromptSubmit, PostToolUse, Stop, PreCompact), daemon workers (12), memory (sql.js + HNSW with 384-dim embeddings), neural training (3 models), guidance compilation, AI defense, GitHub integration, swarm coordination, workflow templates (4), cross-device portability via `.ruflo/` directory.
**Why:** Single-developer needs maximum automation. Zero-manual-effort sessions. Cross-session learning via HNSW-indexed semantic search. Intelligent agent routing via Q-learning + neural models. Portable state across devices.
**Consequences:** `.claude/settings.json` grows with hook config (backed up as `.pre-ruflo`). `.ruflo/` directory committed for portability. Ruflo daemon runs in background. 12 workers for continuous analysis. Enabled by default via `ruflo.enabled: true` in `.agentboard/config.json`. See `docs/ruflo-setup.md` for complete setup documentation and `docs/architecture/008-ruflo-integration.md` for ADR.

## 2026-03-19: Lightpanda + Playwright for browser testing
**Context:** Agentboard React UI had zero browser tests. Need fast, lightweight headless browser for dev testing.
**Decision:** Use Lightpanda (Zig-based headless browser) as CDP backend for Playwright. Install via npm (`@lightpanda/browser`). Docker fallback for unsupported platforms. Tests in `browser-tests/` directory.
**Why:** 11x faster than Chrome, 9x less memory. CDP-compatible = drop-in for Playwright. npm package = zero manual setup. Purpose-built for automation (no rendering bloat).
**Consequences:** Dev-only for now (not integrated into pipeline checks). Lightpanda is beta — may need Docker fallback on some platforms. Tests connect via `connectOverCDP()`.
