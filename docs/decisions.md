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

## 2026-03-16: Subtasks are fully autonomous with no review panel
**Context:** Subtasks could go through the same pipeline as parent tasks (spec → plan → implement → review → PR).
**Decision:** Subtasks go `ready → ralph loop → done|failed` only. No spec, no planning, no review panel, no PR.
**Why:** Subtasks are scoped by the parent's plan. Adding a full pipeline would multiply token cost and latency for marginal quality gain.
**Consequences:** Subtask quality depends entirely on the parent's spec quality and the ralph loop's backpressure.

## 2026-03-16: Unanimous review panel (all 3 must pass)
**Context:** Review panel runs Architect, QA, and Security reviewers in parallel.
**Decision:** All three must pass (unanimous). Any failure cycles back to the implementer.
**Why:** A majority-vote system could let security issues slip through if only QA and Architect pass. The cost of an extra iteration is lower than the cost of a missed security issue.
**Consequences:** False positives from any single reviewer block the pipeline. May need reviewer prompt tuning to reduce noise.

## 2026-03-16: ECC rules installed project-scoped, not global
**Context:** ECC rules can be installed globally (`~/.claude/rules/`) or per-project (`.claude/rules/`).
**Decision:** Project-scoped installation at `.claude/rules/`.
**Why:** Agentboard has project-specific conventions (console.log prefixes, prepared statements, stage patterns) that shouldn't affect other projects. Project-scoped rules travel with the repo.
**Consequences:** Other projects don't benefit from these rules. Contributors need no global ECC setup.

## 2026-03-16: ECC learnings are project-scoped only
**Context:** ECC's learn-eval can save globally or per-project.
**Decision:** All learnings save to `.claude/skills/learned/` (project), never `~/.claude/skills/learned/` (global).
**Why:** Agentboard patterns (ralph loop, BufferedWriter, stage contracts) are project-specific and would confuse agents in other projects.
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
**Consequences:** Pipeline changes from `spec → planning → implementing` to `planning → needs_plan_review → implementing`. New API endpoints: `POST /api/tasks/refine-field` (per-field AI refinement), `POST /api/tasks/:id/review-plan` (approve/reject). Worker loop detects approved plans via `plan_review_approved` event and skips re-planning. `DecisionPoint` type removed, replaced by iterative per-field refinement.

## 2026-03-17: Post-task learning extraction via claude --print
**Context:** After task completion, the pipeline collects quantitative metrics (tokens, duration, attempts, check failures). But patterns are extracted manually by developers, requiring `/everything-claude-code:learn-eval`. This is reactive and relies on manual invocation.
**Decision:** After each task reaches a terminal state (done/failed), fire-and-forget `extractLearnings()` spawns `claude --print` with a learner prompt that analyzes the task's execution summary and automatically saves reusable patterns to `.claude/skills/learned/`. Non-blocking: failures are logged but never change task outcomes. Model selection is configurable via `config.modelDefaults.learning` (defaults to haiku). Prompt template in `prompts/learner.md`.
**Why:** Automated extraction captures non-obvious patterns while context is fresh (ralph loop iterations, check failures, reviewer feedback). Fire-and-forget ensures learning never blocks the pipeline. Project-scoped learnings prevent cross-contamination with other projects' patterns. Haiku model is cost-effective for lightweight pattern analysis.
**Consequences:** Pipeline's learner stage now has dual responsibilities: quantitative metrics (`recordLearning()` → `.agentboard/learning-log.jsonl`) and qualitative patterns (`extractLearnings()` → `.claude/skills/learned/`). New `learning` key in `ModelDefaults` interface. All 6 `recordLearning()` call sites in worker loop trigger `extractLearnings()` as fire-and-forget. `config-compat.ts` defaults `learning: 'haiku'` for backward compatibility. Learning extraction can be toggled by users via `config.modelDefaults.learning = null` (though not yet implemented in CLI init).
