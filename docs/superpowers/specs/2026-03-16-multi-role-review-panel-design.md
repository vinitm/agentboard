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

The `TaskStatus` type replaces `'review_spec' | 'review_code'` with a single `'review_panel'`. The kanban board collapses from two review columns into one.

## Execution Flow

1. `review_panel` stage starts — launches all 3 reviewers in parallel via `Promise.allSettled`.
2. Each reviewer receives the same context (task spec, diff, file hints, plan summary) plus its role-specific prompt from `prompts/`.
3. Each returns structured JSON: `{ passed: boolean, feedback: string, issues: string[] }`.
4. Results are aggregated:
   - **All pass** — proceed to `pr_creation`.
   - **Any fail** — combine feedback from all failing reviewers into a single structured block, cycle back to implementer.

### Run Records

Each reviewer invocation creates its own `Run` record in the database. The `Run.stage` field is `'review_panel'` (matching the `Stage` type). The reviewer role is stored in an `Artifact` attached to the Run with `type: 'review_role'` and `name` set to `'architect' | 'qa' | 'security'`. The artifact `content` holds the full reviewer output JSON. This keeps audit trails per-reviewer without polluting the `Stage` type union.

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

Replace `ModelDefaults.reviewSpec` and `ModelDefaults.reviewCode` with a single `ModelDefaults.review` field. All three reviewers use this same model.

High-risk override: if `riskLevel === 'high'`, use `'opus'` for the `review_panel` stage — same pattern as before but checking for `stage === 'review_panel'` instead of the two old stages.

The `model-selector.ts` mapping becomes:

```typescript
const stageToConfigKey: Record<Stage, keyof AgentboardConfig['modelDefaults']> = {
  planning: 'planning',
  implementing: 'implementation',
  checks: 'implementation',
  review_panel: 'review',
  pr_creation: 'implementation',
};
```

**Config migration**: Existing `config.json` files with `reviewSpec`/`reviewCode` keys will still load — the config loader should fall back: if `review` key is missing, use `reviewSpec` value (or default `'sonnet'`). This is a soft migration, not a breaking change.

## Data Migration

SQLite has no migration framework — `CREATE TABLE IF NOT EXISTS` is used. Add a one-time migration function called at startup (alongside `recoverStaleTasks`):

```sql
UPDATE tasks SET status = 'review_panel' WHERE status IN ('review_spec', 'review_code');
UPDATE runs SET stage = 'review_panel' WHERE stage IN ('review_spec', 'review_code');
```

This migrates any in-flight or historical data. Tasks mid-review will restart the review panel from scratch on next claim (acceptable since reviews are idempotent).

## Concurrency Considerations

Each review panel spawns 3 Claude Code processes in parallel. With `maxConcurrentTasks` tasks running simultaneously, the system could have up to `3 * maxConcurrentTasks` Claude processes during review. This is acceptable because:

- Review stages are short-lived (typically <60s each).
- The Claude CLI handles rate limiting internally.
- Only one task at a time is typically in review (the bottleneck is implementation, not review).

No changes to `maxConcurrentTasks` semantics are needed, but the concurrency multiplier should be documented in a code comment.

## Event Types

Replace `review_spec_failed` and `review_code_failed` events with:
- `review_panel_completed` — emitted when all 3 reviewers finish. Payload includes per-role results: `{ results: { architect: { passed, issues }, qa: { passed, issues }, security: { passed, issues } } }`.
- `review_panel_failed` — emitted when the panel verdict is fail (any reviewer failed). Same payload structure.

This gives the UI and event timeline enough information to display per-role results.

## Hook Compatibility

**Breaking change**: Hooks keyed on `beforeStage` / `afterStage` with `review_spec` or `review_code` stage names will stop firing. The new stage name is `review_panel`. This is documented as a breaking change in release notes. No automatic migration for hooks — users must update their hook configs.

## Files to Change

### Types & Config
| File | Change |
|---|---|
| `src/types/index.ts` | `TaskStatus`: replace `review_spec \| review_code` with `review_panel`. `Stage`: same. `ModelDefaults`: replace `reviewSpec` + `reviewCode` with `review`. |
| `ui/src/types.ts` | Mirror the `TaskStatus` and `Stage` changes. |

### Worker (backend)
| File | Change |
|---|---|
| `src/worker/stages/review-panel.ts` | **New** — orchestrates 3 parallel reviewers, parses results, aggregates verdict and feedback. |
| `src/worker/stages/review-spec.ts` | **Delete** |
| `src/worker/stages/review-code.ts` | **Delete** |
| `src/worker/loop.ts` | Update `runReviewAndPR()` to call `runReviewPanel()` instead of sequential spec → code reviews. |
| `src/worker/model-selector.ts` | Update `stageToConfigKey` map and high-risk override to use `review_panel` / `review`. |
| `src/worker/model-selector.test.ts` | Update tests for new stage/config key. |
| `src/worker/recovery.ts` | Update `AGENT_CONTROLLED_STATUSES`: replace `review_spec`, `review_code` with `review_panel`. |

### Server
| File | Change |
|---|---|
| `src/server/routes/tasks.ts` | Update `AGENT_CONTROLLED_COLUMNS`: replace `review_spec`, `review_code` with `review_panel`. |
| `src/server/routes/tasks.test.ts` | Update test iterations over agent columns. |

### Database
| File | Change |
|---|---|
| `src/db/queries.ts` | Update any stage-specific queries referencing old stage names. Add migration function. |
| `src/db/schema.ts` | Call migration function after table creation. |

### Prompts
| File | Change |
|---|---|
| `prompts/review-architect.md` | **New** — Architect persona prompt. |
| `prompts/review-qa.md` | **New** — QA Engineer persona prompt. |
| `prompts/review-security.md` | **New** — Security Reviewer persona prompt. |
| `prompts/review-spec.md` (if exists) | **Delete** |
| `prompts/review-code.md` (if exists) | **Delete** |

### UI
| File | Change |
|---|---|
| `ui/src/components/Board.tsx` | `MAIN_COLUMNS`: replace `review_spec`, `review_code` with `review_panel`. |
| `ui/src/components/Column.tsx` | `AGENT_COLUMNS`: replace entries. `COLUMN_LABELS`: add `review_panel: 'Review Panel'`, remove old keys. |
| `ui/src/components/TaskCard.tsx` | Update status-to-color mapping. |
| `ui/src/components/TaskDetail.tsx` | Update status badge colors and `isAgentActive` check. |
| `ui/src/components/TaskPage.tsx` | Update `ACTIVE_STATUSES` and status badge colors. |
| `ui/src/components/SubtaskMiniCard.tsx` | Update status dot/border colors. |
| `ui/src/components/EventsTimeline.tsx` | Update event type colors/display text for new event types. |
| `ui/src/components/ActivityFeed.tsx` | Update event type colors/display text. |

### PR Creator
| File | Change |
|---|---|
| `src/worker/stages/pr-creator.ts` | Update Run record fetches — currently fetches `review_spec` and `review_code` runs for PR body. Change to fetch `review_panel` runs + their role artifacts. |

### Docs
| File | Change |
|---|---|
| `CLAUDE.md` | Update pipeline flow documentation. |
| `AGENTS.md` | Update pipeline flow if documented there. |

### Tests
| File | Change |
|---|---|
| `src/worker/stages/review-panel.test.ts` | **New** — test parallel execution, aggregation, feedback formatting, edge cases. |
| `src/worker/stages/review-spec.test.ts` | **Delete** |
| `src/worker/stages/review-code.test.ts` | **Delete** |

## What Stays the Same

- **Executor** (`executeClaudeCode`) — unchanged. Each reviewer calls it independently.
- **Context builder** (`buildTaskPacket`) — unchanged. Reviewers use it like before.
- **PR creator** — logic unchanged, just fetches different stage/artifact names.
- **Config** — `maxReviewCycles` still controls retry limit.
- **Implementer** — unchanged. Receives feedback in the same way, just from multiple sources.
- **Checks stage** — unchanged. Still runs between implementation and review.
- **Planner** — unchanged.
- **Subtask behavior** — unchanged. Subtasks still skip PR creation.

## Edge Cases

- **Reviewer timeout/crash**: If a reviewer's Promise rejects (process crash) or returns invalid JSON, treat it as a review failure with feedback: `"[role] reviewer crashed or produced invalid output"`. This is an infrastructure failure, not a review failure — it does NOT count toward `maxReviewCycles`. The panel retries that reviewer once before counting it as a cycle. If it crashes again, count the cycle.
- **All reviewers pass on first try**: No re-implementation needed. Proceed directly to PR creation.
- **Conflicting feedback**: The implementer receives all feedback and must reconcile. The prompts are scoped tightly to their domain to minimize conflicts.
- **Empty diff**: If the implementer produces no changes on a retry (`commitChanges()` returns empty string), still run the review panel — the previous commit may not have been reviewed yet. Only skip if the panel already passed in the current cycle.

## Future Extensions

- Add more reviewer roles (Performance, DX/Maintainability) by adding prompt files and registering them in the panel.
- Make the reviewer roster configurable per-project via the agentboard config.
- Add weighted/majority verdict modes as alternatives to unanimous.
