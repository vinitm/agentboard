# ADR 007: Superpowers-Inspired Task Workflow

**Status:** Accepted
**Date:** 2026-03-17
**Context:** Reimplementing the task workflow inspired by [obra/superpowers](https://github.com/obra/superpowers) to improve spec quality, subtask granularity, and review effectiveness.

## Summary

Replace the current pipeline (form-based spec → coarse subtasks → ralph loop → 3-reviewer panel) with a superpowers-inspired workflow (conversational spec building → bite-sized TDD subtasks → single-shot implementation with inline fix → per-subtask code quality review → holistic final review).

All stages use Opus.

## Complete Task Flow

### ① Conversational Spec Building

PM clicks "New Task" — a chat panel opens immediately. No forms. The AI (powered by superpowers brainstorming) drives the conversation:

1. PM types rough idea: "We need webhook support for task status changes"
2. AI reads codebase context (files, docs, recent commits)
3. AI asks clarifying questions **one at a time** — purpose, users, constraints, scope, success criteria
4. AI proposes **2-3 approaches** with tradeoffs and a recommendation
5. PM picks an approach
6. AI drafts spec (goal, userScenarios, successCriteria) shown inline in chat
7. PM reviews: approves or requests changes
8. Spec fields auto-populated from conversation. Task title auto-generated.
9. Task sits in backlog until PM drags to ready.

**Key design decisions:**
- Chat is the primary interface — no form fields to fill
- Spec fields are derived by AI from the conversation, not typed by PM
- AI output streams token-by-token to UI via WebSocket (`task:chat` events) so PM sees real-time output
- Chat history persisted in DB for context if PM returns later
- PM can reopen chat to refine spec before moving to ready

**Status transitions:** `backlog` (spec authoring happens in-place, no status change)

### ② Spec Review (automated gate)

When PM drags task to ready, worker claims it and runs automated spec review:

- All fields populated and substantive
- Acceptance criteria are testable (not vague)
- Scope is reasonable (not "build everything")
- No contradictions between sections

**Pass** → proceed to planning
**Fail** → task blocked, PM notified with specific issues. PM fixes in chat → drags to ready again.

**Status transitions:** `ready` → `spec_review` → `planning` (or → `blocked`)

### ③ Planning (planner decides granularity)

Planner receives full spec + codebase context. Produces:

- **planSummary** — high-level approach
- **subtasks[]** — each with title, description, TDD steps, exact file paths, code snippets
- **assumptions[]** — anything the planner assumed that PM didn't specify
- **fileMap[]** — which files are created/modified

**Subtask granularity** — planner decides based on complexity:
- Simple changes (config, copy, single function): 2-3 subtasks
- Medium features (new endpoint, new component): 4-6 subtasks
- Complex features (new subsystem, multi-file refactor): 7-10 subtasks
- Each subtask = one TDD cycle: write test → implement → verify

**Automated plan review** runs before human sees the plan:
- Every subtask has test + verify steps
- File paths make sense
- No missing dependencies between subtasks
- Scope matches spec (no over/under-build)
- Pass → present to engineer. Fail → re-plan with feedback (max 3 attempts).

**Engineer reviews** plan in UI:
- Approve (with optional subtask edits)
- Reject (with required reason → re-plan with rejection feedback)

Subtasks created: first = `ready`, rest = `backlog`. Parent → `implementing`.

**Status transitions:** `spec_review` → `planning` → `needs_plan_review` → `implementing`

### ④ Per-Subtask Execution (serial, no ralph loop)

Each subtask goes through this flow independently. Subtasks execute serially — next sibling promoted to `ready` only after current one completes.

#### Step 1: Implement (single shot)

Fresh Claude session per subtask. Receives full subtask text + TDD steps + plan context. Implementer writes code, runs tests, self-reviews.

Reports structured status:
- **DONE** → proceed to checks
- **DONE_WITH_CONCERNS** → log concerns, proceed to checks
- **NEEDS_CONTEXT** → provide context from codebase, re-dispatch (not a retry)
- **BLOCKED** → escalate to human (task → `blocked`)

#### Step 2: Checks

Pipeline: secrets → test → lint → format → typecheck

- **Pass** → code quality review
- **Fail** → inline fix: new Claude session receives failure output, fixes the specific issue, re-runs checks
  - **Pass** → code quality review
  - **Fail again** → escalate to human (task → `blocked`)

No ralph loop. One implementation attempt + one inline fix attempt = max 2 tries.

#### Step 3: Code Quality Review

Single reviewer (not 3 parallel). Reviews git diff for this subtask:
- Code quality (naming, structure, complexity)
- Test quality (coverage, edge cases, assertions)
- Security (injection, secrets, auth)
- Architecture (patterns, coupling, file size)

Issues rated: **Critical** / **Important** / **Minor**

- All pass or Minor only → subtask done
- Critical or Important → implementer fixes (same task, new session) → re-review
- Max 2 fix cycles, then escalate to human

#### Subtask completion

Subtask → `done`. Promote next backlog sibling to `ready`.

If subtask fails/blocked → cancel remaining backlog siblings → parent → `failed`/`blocked`.

### ⑤ Final Review

After all subtasks complete. Holistic review of ALL changes across all subtasks:

- Cross-file consistency
- Integration issues between subtasks
- **Spec compliance**: do ALL acceptance criteria from the original spec pass?
- Architecture alignment with existing codebase

**Pass** → PR creation
**Fail** → targeted inline fix → re-review (max 2 attempts, then escalate)

**Status transitions:** `implementing` → `final_review`

### ⑥ PR Creation

Single PR for all subtask commits. Uses `gh pr create`.

**Status transitions:** `final_review` → `pr_creation`

### ⑦ Auto-Merge Gate

Criteria: low risk + all reviews passed + no security-sensitive files.

**Pass** → `done` (skip human review)
**Fail** → `needs_human_review`

### ⑧ Learning Extraction

Fire-and-forget after task reaches terminal state. Collects metrics + extracts patterns.

## Status State Machine

```
backlog → ready → spec_review → planning → needs_plan_review → implementing
                      │                          │                (subtasks)
                   (fail)                     (reject)               │
                      ↓                          ↓               final_review
                   blocked              planning (retry)             │
                                                                pr_creation
                                                                     │
                                                        ┌────────────┴────────────┐
                                                        ↓                         ↓
                                                needs_human_review              done
                                                        │                  (auto-merge)
                                                        ↓
                                                      done

Any stage → blocked (escalation to human)
Any stage → failed (unrecoverable)
Any stage → cancelled (manual)
```

## Type Changes

### TaskStatus
```typescript
type TaskStatus =
  | 'backlog' | 'ready'
  | 'spec_review'          // NEW — automated spec quality gate
  | 'planning' | 'needs_plan_review'
  | 'implementing'
  | 'checks'               // KEPT for UI display during subtask execution
  | 'code_quality'         // REPLACES review_panel
  | 'final_review'         // NEW — holistic cross-subtask review
  | 'pr_creation'          // NEW — explicit status
  | 'needs_human_review'
  | 'done' | 'blocked' | 'failed' | 'cancelled';
```

### Stage
```typescript
type Stage =
  | 'spec_review'       // NEW
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'code_quality'      // REPLACES review_panel
  | 'final_review'      // NEW
  | 'pr_creation';
```

### New Interfaces
```typescript
type ImplementerStatus = 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_CONTEXT' | 'BLOCKED';

interface ImplementationResult {
  status: ImplementerStatus;
  output: string;
  concerns?: string[];
  contextNeeded?: string[];
  blockerReason?: string;
}

interface SpecReviewResult {
  passed: boolean;
  issues: Array<{
    field: 'goal' | 'userScenarios' | 'successCriteria';
    severity: 'critical' | 'warning';
    message: string;
  }>;
  suggestions: string[];
}

interface ChatMessage {
  id: string;
  taskId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
```

## What Gets Removed

- **Ralph loop** (`src/worker/ralph-loop.ts`) — replaced by single-shot + inline fix
- **Review panel** (`src/worker/stages/review-panel.ts`) — replaced by per-subtask code quality review
- **Model selection complexity** (`src/worker/model-selector.ts`) — opus everywhere
- **Spec form fields UI** — replaced by chat-driven spec building
- **Per-field refine endpoint** (`POST /api/tasks/refine-field`) — replaced by chat

## What Gets Added

- **Chat system** — DB table, API endpoints, WebSocket streaming, UI chat panel
- **Spec review stage** (`src/worker/stages/spec-review.ts`)
- **Code quality stage** (`src/worker/stages/code-quality.ts`)
- **Final review stage** (`src/worker/stages/final-review.ts`)
- **Automated plan reviewer** (runs inside planning stage before human gate)
- **Structured implementer status** reporting
- **Inline fix** logic (replaces ralph loop)

## What Gets Modified

- **Planner** — produces bite-sized TDD subtasks with code snippets
- **Implementer** — structured status, self-review
- **Worker loop** — new stage routing, no ralph loop calls
- **Task types** — new statuses, stages, interfaces
- **UI TaskPage/TaskDetail** — chat panel, new stage indicators
- **DB schema** — chat_messages table, updated status enums
