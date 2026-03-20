# Pipeline Stages

> Per-stage contracts for the agentboard pipeline. For system-level architecture, see [agent-orchestration.md](architecture/agent-orchestration.md).

## Overview

Every task moves through up to 9 stages. Each AI-powered stage spawns a fresh Claude Code subprocess via `src/worker/executor.ts`, records a `Run` in the database, and streams output to the UI via Socket.IO.

```
spec_review → planning → [needs_plan_review] → implementing → checks → [inline_fix] → code_quality → final_review → pr_creation → [auto_merge] → [learner]
```

Stages in brackets are conditional or post-pipeline.

## Stage Contract

All stages implement:

```typescript
(db: Database, task: Task, worktreePath: string, config: AgentboardConfig) → Promise<Result>
```

## Stage 0: Conversational Spec Building

| | |
|---|---|
| **Trigger** | User opens task form and starts chatting |
| **File** | `src/server/routes/chat.ts` |
| **Prompt** | `prompts/brainstorming-system.md` (system), `prompts/brainstorming.md` (user) |
| **Model** | opus |
| **Tools** | Read-only (Read, Glob, Grep) |
| **Output** | Structured spec with goal, acceptance criteria, file scope, risk |

**How it works:** PM chats with AI via SSE streaming endpoint. AI asks clarifying questions and iteratively builds a structured spec. Session persists via `--session-id` / `--resume`.

**Guardrails:**
- Tool restrictions enforce read-only (no file writes, no shell commands)
- System prompt enforces conversation-only mode — implementation requests trigger spec finalization
- Completion: `isComplete: true` when all 3 spec fields substantive + at least 2 clarifying questions asked

**Recovery:**
- Mid-session close: partial responses saved server-side, user can resume
- Missing JSON block: server auto-sends corrective follow-up via `--resume`
- Session resume failure: falls back to replaying full chat history

## Stage 1: Spec Review

| | |
|---|---|
| **Trigger** | Task status moves to `ready` |
| **File** | `src/worker/stages/spec-review.ts` |
| **Prompt** | `prompts/spec-review.md` |
| **Model** | opus |
| **Tools** | Read-only (Read, Glob, Grep) |
| **Output** | `SpecReviewResult { passed, issues[], suggestions[] }` |
| **On pass** | → `planning` |
| **On fail** | → `blocked` with review feedback |

Reviews spec for completeness, clarity, testability, and feasibility. Catches ambiguities before planning begins.

## Stage 2: Planning

| | |
|---|---|
| **Trigger** | Spec review passes |
| **File** | `src/worker/stages/planner.ts` |
| **Prompt** | `prompts/planner-v2.md` |
| **Model** | opus |
| **Tools** | Read-only (Read, Glob, Grep) |
| **Output** | `PlanningResult { planSummary, confidence, steps[], assumptions[], fileMap[] }` |
| **On success** | → `needs_plan_review` (or auto-approve if low risk + high confidence) |
| **On questions** | → `blocked` with clarifying questions |

Produces implementation steps with file paths. Steps are guidance for the implementer, not separate tasks.

**Auto-approval gate:** If `config.autoPlanApproval` enabled AND `task.riskLevel === 'low'` AND `confidence >= 0.8`, skip `needs_plan_review`.

## Human Gate: Plan Review

| | |
|---|---|
| **Trigger** | Task reaches `needs_plan_review` |
| **Endpoint** | `POST /api/tasks/:id/review` |
| **UI** | `PlanReviewPanel.tsx` |

Engineer reviews/edits/approves the plan. On rejection, task returns to `planning` with feedback. On approval → `implementing`.

## Stage 3: Implementation

| | |
|---|---|
| **Trigger** | Plan approved |
| **File** | `src/worker/stages/implementer.ts` |
| **Prompt** | `prompts/implementer-v2.md` |
| **Model** | opus |
| **Tools** | Full-access (Read, Write, Edit, Bash, Glob, Grep) |
| **Timeout** | 600s (10 min) |
| **Output** | `ImplementerStatus: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED` |
| **On DONE** | → `checks` |
| **On NEEDS_CONTEXT/BLOCKED** | → `blocked` with details |

Writes code directly in the task's isolated git worktree. Single-shot — no retry loop. Context packet includes spec, plan, file hints, and any previous failure summary.

## Stage 4: Checks

| | |
|---|---|
| **Trigger** | Implementation returns DONE |
| **File** | `src/worker/stages/checks.ts` |
| **Tools** | Full-access (runs shell commands directly) |
| **Output** | Pass/fail per check |
| **On all pass** | → `code_quality` |
| **On fail** | → inline fix (max 2 retries), then `blocked` |

Runs checks in order. First failure that can't be auto-fixed stops the pipeline.

| Check | Command Source | On Failure |
|-------|---------------|------------|
| Secret detection | Built-in regex scan | Immediate fail, never committed |
| Test | `config.commands.test` | Fail → inline fix |
| Lint | `config.commands.lint` | Fail → inline fix |
| Format | `config.commands.format` | Auto-fix if `formatPolicy = 'auto-fix-separate-commit'` |
| Typecheck | `config.commands.typecheck` | Fail → inline fix |
| Security | `config.commands.security` | Fail → inline fix |

**Secret detection patterns:** AWS keys (`AKIA...`), PEM markers, `sk-` prefixes, `password|secret|token = "..."` assignments.

## Stage 4b: Inline Fix (conditional)

| | |
|---|---|
| **Trigger** | Checks fail |
| **File** | `src/worker/inline-fix.ts` |
| **Prompt** | `prompts/inline-fix.md` |
| **Model** | opus |
| **Tools** | Full-access |
| **Max retries** | 2 |
| **Output** | Re-runs checks after each fix attempt |
| **On success** | → `code_quality` |
| **On exhausted** | → `blocked` or `failed` |

Re-invokes implementer with failure context to fix issues inline. Replaces the old 5-retry "ralph loop" with targeted single-fix attempts.

## Stage 5: Code Quality Review

| | |
|---|---|
| **Trigger** | Checks pass |
| **File** | `src/worker/stages/code-quality.ts` |
| **Prompt** | `prompts/code-quality.md` |
| **Model** | opus |
| **Tools** | Read-only |
| **Output** | `CodeQualityResult { passed, issues[], summary }` |
| **On pass** | → `final_review` |
| **On fail** | → re-implement fix → re-check (max 2 cycles), then `failed` |

Single reviewer evaluating design, testing, and security. Replaces the old 3-reviewer panel (Architect, QA, Security).

## Stage 6: Final Review

| | |
|---|---|
| **Trigger** | Code quality passes |
| **File** | `src/worker/stages/final-review.ts` |
| **Prompt** | `prompts/final-review.md` |
| **Model** | opus |
| **Tools** | Read-only |
| **Output** | `FinalReviewResult { specCompliance, integrationIssues }` |
| **On pass** | → `pr_creation` |
| **On fail** | → re-implement fix → re-check (max 2 cycles), then `failed` |

Holistic review of the full changeset against the spec. Catches cross-cutting issues that per-stage reviews miss.

## Stage 7: PR Creation

| | |
|---|---|
| **Trigger** | Final review passes |
| **File** | `src/worker/stages/pr-creator.ts` |
| **Model** | opus |
| **Tools** | Full-access (runs `gh` CLI) |
| **Output** | PR URL + number stored as artifacts |

Steps:
1. Push branch to `config.githubRemote`
2. Create labels: `agentboard`, `risk:{level}`
3. Build PR body (summary, assumptions, criteria, check results, reviews)
4. Run `gh pr create` (draft if `config.prDraft`)

## Stage 8: Auto-Merge Gate

| | |
|---|---|
| **Trigger** | PR created |
| **File** | `src/worker/auto-merge.ts` |
| **Output** | `done` or `needs_human_review` |

**All criteria must pass:**
1. `config.autoMerge` enabled (not `'off'`)
2. `task.riskLevel === 'low'`
3. No security-sensitive files touched (`.env`, `secret`, `credential`, `auth`, `password`, `token`, `.pem`, `.key`)
4. Code quality and final review passed with no blocking issues

## Stage 9: Learner (post-task)

| | |
|---|---|
| **Trigger** | Task reaches terminal state (done/failed) |
| **File** | `src/worker/stages/learner.ts` |
| **Prompt** | `prompts/learner.md` |
| **Model** | haiku (configurable via `config.modelDefaults.learning`) |
| **Tools** | Read-only |
| **Blocking** | No — fire-and-forget |

Collects metrics and extracts patterns:

**Quantitative** → `.agentboard/learning-log.jsonl`:
```typescript
{ totalTokensUsed, implementationAttempts, checksPassedFirst, failedCheckNames[] }
```

**Qualitative** → `.claude/skills/learned/` (reusable patterns via `claude --print`)

## Claude Code Executor

**File:** `src/worker/executor.ts`

All AI stages use a single executor:

```typescript
executeClaudeCode({
  prompt: string,
  worktreePath: string,  // cwd for the subprocess
  model: string,
  tools?: string[],      // --tools (overrides --permission-mode)
  timeout?: number,      // default 300s, 600s for implementation
  onOutput?: (chunk) => void,  // real-time streaming
}): Promise<{ output, exitCode, tokensUsed, duration }>
```

**Spawn command:** `claude --print --model <model> --permission-mode acceptEdits`

When `tools` is provided, uses `--tools Read,Glob,Grep` (etc.) instead of `--permission-mode`.

## Tool Presets

**File:** `src/worker/stage-tools.ts`

| Preset | Tools | Used by |
|--------|-------|---------|
| Read-only | Read, Glob, Grep | spec_review, planning, code_quality, final_review, learner |
| Full-access | Read, Write, Edit, Bash, Glob, Grep | implementing, inline_fix |

Unknown stages default to read-only (principle of least privilege).

## Context Flow

Each stage receives a **task packet** built by `src/worker/context-builder.ts`:

```
Task Packet
├── Task title, description, spec (JSON)
├── File Hints (from planner output)
├── Plan Summary (from planner output)
├── Previous Failure (from last failed run, truncated to 2000 chars)
└── User Answers (from blocked → answered flow)
```

Interpolated into prompt templates via `{taskSpec}`, `{plan}`, `{failureSummary}` placeholders.
