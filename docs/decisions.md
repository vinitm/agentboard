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
