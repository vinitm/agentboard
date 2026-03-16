# Multi-Role Review Panel

## Overview

Replace the existing `review_spec` and `review_code` stages with a single `review_panel` stage that runs three specialized reviewer agents in parallel. All three must pass (unanimous) for the implementation to proceed to PR creation. If any fail, their combined feedback is sent back to the implementer for a fix cycle.

## Motivation

The current pipeline uses two sequential review stages (`review_spec` then `review_code`) with generic prompts. This misses the value of multi-perspective evaluation — an architect catches different issues than a security expert. Running specialized reviewers in parallel is both faster and more thorough than two sequential generic reviews.

## Reviewer Roles

Each reviewer gets a distinct persona via a dedicated prompt template that shapes what they focus on:

| Role | Focus | Pass Criteria |
|---|---|---|
| **Architect** | Codebase fit, patterns, abstractions, complexity, modularity | Implementation follows established patterns, no unnecessary abstractions, clean interfaces |
| **QA Engineer** | Acceptance criteria, edge cases, test coverage, correctness | All acceptance criteria met, edge cases handled, tests are sufficient |
| **Security Reviewer** | OWASP top 10, injection, auth, data exposure, secrets | No security vulnerabilities introduced |

## Pipeline Change

```
Before: ... → checks → review_spec → review_code → pr_creation → ...
After:  ... → checks → review_panel → pr_creation → ...
```

The `Stage` type union gains `'review_panel'` and drops `'review_spec' | 'review_code'`.

The task status flow remains the same shape — `review_panel` occupies the same position in the status enum that the two review stages previously held.

## Execution Flow

1. `review_panel` stage starts — launches all 3 reviewers in parallel via `Promise.allSettled`.
2. Each reviewer receives the same context (task spec, diff, file hints, plan summary) plus its role-specific prompt from `prompts/`.
3. Each returns structured JSON: `{ passed: boolean, feedback: string, issues: string[] }`.
4. Results are aggregated:
   - **All pass** — proceed to `pr_creation`.
   - **Any fail** — combine feedback from all failing reviewers into a single structured block, cycle back to implementer.

Each reviewer invocation creates its own `Run` record in the database with a stage value that identifies the role (e.g., `review_panel:architect`). This keeps audit trails per-reviewer while the pipeline treats `review_panel` as a single logical stage.

## Feedback Format

When reviewers fail, the implementer receives feedback structured by role:

```
## Review Panel Feedback (Cycle 2/3)

### Architect (FAILED)
- Introduced a god-class that violates the existing separation in src/worker/stages/
- Should extract the aggregation logic into a separate module

### QA Engineer (PASSED)
No issues.

### Security Reviewer (FAILED)
- User input at line 42 is interpolated into SQL without parameterization
```

All reviewer results are included (even passing ones) so the implementer has full context.

## Retry Behavior

Uses the existing `maxReviewCycles` config. Each cycle:

1. Implementer re-runs with combined review feedback in context.
2. Checks re-run on the new changes.
3. All 3 reviewers re-run (even ones that previously passed — the fix might have introduced new issues).

If `maxReviewCycles` is exhausted and any reviewer still fails, the task status moves to `failed`.

## Model Selection

Reviewers follow the existing model selection logic:
- Default: Sonnet (fast, cheap, good enough for focused review)
- High-risk tasks: Opus (more thorough analysis)

This matches the current behavior of `review_spec` and `review_code`.

## Files to Change

| File | Change |
|---|---|
| `src/types/index.ts` | Update `Stage` type: remove `review_spec` / `review_code`, add `review_panel`. Update `TaskStatus` to replace `review_spec` / `review_code` with `review_panel`. |
| `src/worker/stages/review-panel.ts` | **New file** — orchestrates 3 parallel reviewer invocations, parses results, aggregates verdict and feedback. |
| `src/worker/stages/review-spec.ts` | **Delete** — functionality absorbed into QA reviewer role. |
| `src/worker/stages/review-code.ts` | **Delete** — functionality absorbed into Architect and Security roles. |
| `prompts/review-architect.md` | **New** — Architect persona prompt template. |
| `prompts/review-qa.md` | **New** — QA Engineer persona prompt template. |
| `prompts/review-security.md` | **New** — Security Reviewer persona prompt template. |
| `src/worker/loop.ts` | Update `runReviewAndPR()` to call `runReviewPanel()` instead of sequential `review_spec` → `review_code`. Simplify the review cycle logic since it's now one stage instead of two. |
| `src/db/queries.ts` | Update any stage-specific queries or status transitions referencing the old stage names. |
| `ui/src/types.ts` | Mirror the `Stage` and `TaskStatus` type changes. |
| UI components | Update any stage display logic (status badges, pipeline visualization) to show `review_panel` instead of two separate review stages. |
| Tests | New tests for `review-panel.ts`, remove tests for deleted review stages. |

## What Stays the Same

- **Executor** (`executeClaudeCode`) — unchanged. Each reviewer calls it independently.
- **Context builder** (`buildTaskPacket`) — unchanged. Reviewers use it like before.
- **PR creator** — unchanged. Receives task after panel passes.
- **Config** — `maxReviewCycles` still controls retry limit.
- **Implementer** — unchanged. Receives feedback in the same way, just from multiple sources.
- **Checks stage** — unchanged. Still runs between implementation and review.
- **Planner** — unchanged.
- **Subtask behavior** — unchanged. Subtasks still skip PR creation.

## Edge Cases

- **Reviewer timeout/crash**: If one reviewer fails to produce valid JSON, treat it as a review failure with a generic "reviewer produced invalid output" feedback message. Don't block the other reviewers.
- **All reviewers pass on first try**: No re-implementation needed. Proceed directly to PR creation.
- **Conflicting feedback**: The implementer receives all feedback and must reconcile. The prompts should be scoped tightly enough to their domain that conflicts are rare (an architect won't comment on security, and vice versa).
- **Empty diff**: If the implementer produces no changes on a retry (already committed in previous cycle), skip the review cycle and proceed — same as current behavior.

## Future Extensions

- Add more reviewer roles (Performance, DX/Maintainability) by adding prompt files and registering them in the panel.
- Make the reviewer roster configurable per-project via the agentboard config.
- Add weighted/majority verdict modes as alternatives to unanimous.
