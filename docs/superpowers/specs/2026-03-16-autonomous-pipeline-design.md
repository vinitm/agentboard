# Autonomous Pipeline Design

**Date:** 2026-03-16
**Status:** Draft
**Problem:** Tasks block too frequently for human input during the planning and implementation stages, making the pipeline non-autonomous.

## Context

The agentboard pipeline currently blocks for human input at multiple points:

1. **Planner questions** — The planner stage can return a `questions[]` array, which moves the task to `blocked` status until a human answers via the UI.
2. **Implementer needs_user_input** — The implementer stage can output `{"needs_user_input": [...]}` JSON, which also blocks the task.
3. **Sparse task specs** — Tasks created from the UI often lack enough context for the agent to proceed without asking questions. The `/parse` endpoint expands a short description into spec fields, but doesn't anticipate decision points.

The only intentional human touchpoint should be PR review (`needs_human_review` → `done`). Everything before that should be autonomous.

## Design

### 1. Enhanced Task Creation — Decision Points

Enhance the `/api/tasks/parse` endpoint and TaskForm UI to capture likely ambiguities upfront.

#### API Changes

The `/api/tasks/parse` response gains a `decisionPoints` array:

```ts
interface DecisionPoint {
  question: string;       // "Should rate limiting be per-user or per-IP?"
  options: string[];      // ["Per user", "Per IP", "Both"]
  defaultIndex: number;   // Index of the recommended option
  specField: string;      // Which spec field this enriches (e.g., "constraints")
}
```

The parse prompt is updated to also generate decision points — questions the implementer would likely need answered, presented with sensible defaults.

#### UI Changes — TaskForm

Add a `decisions` phase between `describe` and `preview`:

- **Phase flow:** `describe` → `decisions` (if any) → `preview`
- Each decision point renders as a radio group with the AI's recommended option pre-selected
- User can accept all defaults quickly or override individual choices
- If no decision points are returned, skip straight to `preview` (current behavior)
- Selected answers are appended to the relevant spec fields (identified by `specField`) before task creation

No database schema changes needed — the spec JSON simply gets richer content.

### 2. Autonomous Agent Prompts

Update planner and implementer prompts to never ask questions. Instead, they make reasonable assumptions and proceed.

#### Planner Prompt (`prompts/planner.md`)

Replace the questions instruction:

```
- Do NOT return questions. If there are ambiguities not covered in the spec,
  make a reasonable assumption based on the codebase context and common practices.
- Document each assumption in the "assumptions" array with a brief rationale.
- Proceed with planning as if the assumptions are confirmed.
```

Update the JSON output schema:

```json
{
  "planSummary": "...",
  "subtasks": [{"title": "...", "description": "..."}],
  "assumptions": ["Assumed X because Y"],
  "fileHints": ["paths/to/relevant/files"]
}
```

The `questions` field is removed from the schema.

#### Implementer Prompt (`prompts/implementer.md`)

Remove the `needs_user_input` JSON instruction. Replace with:

```
- Never ask for human input. If something is unclear, make a reasonable
  assumption based on the spec, the codebase, and software engineering best practices.
- If you must choose between approaches, pick the simpler one.
```

#### Type Changes

**`PlanningResult`** (`src/worker/stages/planner.ts`):
- Add `assumptions: string[]`
- Remove `questions: string[]`
- Update `parseJsonFromOutput` fallback (line 147) to return `assumptions: []` instead of `questions: []`

**`ImplementationResult`** (`src/worker/stages/implementer.ts`):
- Remove `needsUserInput?: string[]`

**`DecisionPoint`** — Define in both `src/types/index.ts` and `ui/src/types.ts` to maintain the existing mirroring pattern.

Note: Implementer-level assumptions are not captured in v1. The implementer is instructed to assume and proceed, but assumptions are only formally tracked at the planning stage. This is acceptable because the implementation diff itself is visible in the PR.

### 3. Assumptions in PR Description and Task Detail

Assumptions made by the planner are surfaced at the human review touchpoint.

#### Storage

After planning succeeds, if `planResult.assumptions.length > 0`, store them as an artifact:
- Type: `assumptions`
- Name: `planning_assumptions`
- Content: JSON array of assumption strings

This uses the existing artifact system — no new tables needed.

#### PR Description

Update the PR creator stage to read assumption artifacts for the task (and its subtasks) and include them in the PR body. Query strategy: use `getLatestRunByTaskAndStage(db, taskId, 'planning')` to get the planning run, then `listArtifactsByRun(db, runId)` filtered by type `assumptions`. For parent tasks with subtasks, iterate over subtask IDs to collect their assumptions too.

The "Assumptions Made" section is conditionally rendered — omitted when no assumptions exist.

```markdown
## Assumptions Made
> These decisions were made autonomously. Please verify during review.
- Assumed rate limiting is per-user (not per-IP) since the auth middleware already extracts user context
- Assumed 429 status code with Retry-After header for rate limit responses
```

#### Task Detail UI

Show assumptions in the task detail view with a distinct visual treatment (warning/info style). This lets the human see assumptions before the PR is created.

### 4. Remove Automated Blocking Code Paths

Clean up the worker loop by removing the code paths that automatically move tasks to `blocked`.

#### Keep

- `blocked` in the `TaskStatus` type union — still useful for manual blocking
- `/api/tasks/:id/answer` endpoint — still works if a human manually blocks/unblocks a task
- `AGENT_CONTROLLED_COLUMNS` array in `tasks.ts` — `blocked` is not in this array anyway

#### Remove

- **Worker loop** (`src/worker/loop.ts`):
  - Planner questions → blocked transition (lines 762-784)
  - Implementer needsUserInput → blocked transition (lines 313-331)
- **`parseNeedsUserInput` function** (`src/worker/stages/implementer.ts`) — Delete entirely
- **`validatePlanningResult`** (`src/worker/stages/planner.ts`) — Remove `questions` parsing, add `assumptions` parsing

## Files Changed

| File | Change |
|------|--------|
| `prompts/planner.md` | Remove questions instruction, add assumptions instruction |
| `prompts/implementer.md` | Remove needs_user_input instruction, add assume-and-proceed instruction |
| `src/worker/stages/planner.ts` | `PlanningResult`: add `assumptions`, remove `questions`; update parser |
| `src/worker/stages/implementer.ts` | `ImplementationResult`: remove `needsUserInput`; delete `parseNeedsUserInput` |
| `src/worker/loop.ts` | Remove two blocked-transition code paths; store assumptions artifact |
| `src/worker/stages/pr-creator.ts` | Read assumptions artifacts, include in PR body |
| `src/server/routes/tasks.ts` | Update `/parse` prompt to generate decision points |
| `ui/src/components/TaskForm.tsx` | Add `decisions` phase with radio groups |
| `ui/src/components/TaskDetail.tsx` | Show assumptions with warning-style treatment |
| `ui/src/types.ts` | Add `DecisionPoint` interface |
| `src/types/index.ts` | Add `DecisionPoint` interface (mirrored to UI) |
| `src/db/queries.ts` | May need `getLatestRunByTaskAndStage` if not already present |

## Non-Goals

- Removing `blocked` status entirely — it's still useful for manual workflows
- Removing the `/answer` endpoint — backward compatibility
- Changing the `needs_human_review` → `done` transition — this is the intentional human touchpoint
- Auto-merging PRs — out of scope (already a config option `autoMerge`)

## Risks

- **Wrong assumptions:** Agent may assume incorrectly, leading to wasted implementation work. Mitigated by surfacing assumptions in PR description for human verification.
- **Decision point quality:** The parse endpoint may generate irrelevant or too many decision points. Mitigated by capping at 5 and pre-selecting sensible defaults so the user can skip through quickly.
- **Prompt sensitivity:** Changing planner/implementer prompts may affect output quality. Mitigated by keeping changes minimal and focused.
- **Decision point cap:** Decision points are capped at 5, enforced in the `/parse` prompt instruction and validated on the backend before returning the response.

## Notes

- **Retry behavior:** When a failed task is retried, old assumption artifacts from previous runs persist in the DB. This is harmless because the PR creator reads artifacts scoped to the latest planning run via `getLatestRunByTaskAndStage`.
- **Manual block/unblock:** The `/answer` endpoint and `blocked` status remain functional for manual workflows but are no longer triggered by the automated pipeline. This is a known vestigial path that may be cleaned up in a future iteration.
- **`spawn` vs `execFile`:** The existing `/parse` endpoint uses `spawn` instead of `execFile` (a pre-existing CLAUDE.md violation). This spec does not fix that, but it should be addressed as a separate cleanup.
