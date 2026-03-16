# Autonomous Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agentboard pipeline fully autonomous — human provides context once at task creation, agent runs without blocking, human reviews the PR at the end.

**Architecture:** Four changes: (1) enhanced task creation with AI-generated decision points, (2) autonomous agent prompts that assume instead of ask, (3) assumptions surfaced in PRs, (4) dead blocking code removed.

**Tech Stack:** TypeScript, Express, React, Tailwind, SQLite, Claude Code CLI

**Spec:** `docs/superpowers/specs/2026-03-16-autonomous-pipeline-design.md`

---

## Chunk 1: Backend — Autonomous Prompts & Types

### Task 1: Update planner prompt and types

**Files:**
- Modify: `prompts/planner.md`
- Modify: `src/worker/stages/planner.ts:11-16` (PlanningResult interface)
- Modify: `src/worker/stages/planner.ts:125-181` (parseJsonFromOutput, validatePlanningResult)

- [ ] **Step 1: Update the planner prompt**

Replace the contents of `prompts/planner.md` with:

```markdown
You are a planning agent for a software task. Analyze the task and produce a plan.

## Task
{taskSpec}

## Instructions
1. Read the relevant code to understand the codebase
2. Produce a JSON response with this exact structure:
```json
{
  "planSummary": "Brief description of the implementation approach",
  "subtasks": [{"title": "...", "description": "..."}],
  "assumptions": ["Assumed X because Y — each assumption with rationale"],
  "fileHints": ["paths/to/relevant/files"]
}
```

If the task is simple enough to implement directly, return empty subtasks and assumptions.
Only create subtasks if the work genuinely needs to be broken down.
Do NOT return questions. If there are ambiguities not covered in the spec, make a reasonable assumption based on the codebase context and common practices. Document each assumption in the "assumptions" array with a brief rationale. Proceed with planning as if the assumptions are confirmed.
```

- [ ] **Step 2: Update `PlanningResult` interface**

In `src/worker/stages/planner.ts`, change the interface:

```ts
export interface PlanningResult {
  planSummary: string;
  subtasks: Array<{ title: string; description: string }>;
  assumptions: string[];
  fileHints: string[];
}
```

Remove `questions: string[]`, add `assumptions: string[]`.

- [ ] **Step 3: Update `validatePlanningResult`**

In `src/worker/stages/planner.ts`, update the validation function:

```ts
function validatePlanningResult(data: unknown): PlanningResult {
  const obj = data as Record<string, unknown>;
  return {
    planSummary: typeof obj.planSummary === 'string' ? obj.planSummary : '',
    subtasks: Array.isArray(obj.subtasks)
      ? (obj.subtasks as Array<{ title: string; description: string }>).map(
          (s) => ({
            title: typeof s.title === 'string' ? s.title : '',
            description: typeof s.description === 'string' ? s.description : '',
          })
        )
      : [],
    assumptions: Array.isArray(obj.assumptions)
      ? (obj.assumptions as string[]).filter(
          (a): a is string => typeof a === 'string'
        )
      : [],
    fileHints: Array.isArray(obj.fileHints)
      ? (obj.fileHints as string[]).filter(
          (f): f is string => typeof f === 'string'
        )
      : [],
  };
}
```

- [ ] **Step 4: Update `parseJsonFromOutput` fallback**

In `src/worker/stages/planner.ts`, update the fallback return at line 147:

```ts
  // Last resort: return a minimal result with the output as summary
  return {
    planSummary: output.slice(0, 1000),
    subtasks: [],
    assumptions: [],
    fileHints: [],
  };
```

- [ ] **Step 5: Update the raw JSON regex match**

In `parseJsonFromOutput`, update the regex at line 137 from:

```ts
const jsonMatch = output.match(/\{[\s\S]*"planSummary"[\s\S]*\}/);
```

No change needed — the regex matches on `planSummary` which is still present.

- [ ] **Step 6: Verify build compiles**

Run: `npm run build:server`
Expected: No errors related to `questions` or `PlanningResult`

- [ ] **Step 7: Commit**

```bash
git add prompts/planner.md src/worker/stages/planner.ts
git commit -m "feat: replace planner questions with assumptions"
```

---

### Task 2: Update implementer prompt and types

**Files:**
- Modify: `prompts/implementer.md`
- Modify: `src/worker/stages/implementer.ts:10-14` (ImplementationResult interface)
- Modify: `src/worker/stages/implementer.ts:157-189` (parseNeedsUserInput — delete)
- Modify: `src/worker/stages/implementer.ts:87-103` (remove needsUserInput check)

- [ ] **Step 1: Update the implementer prompt**

Replace the contents of `prompts/implementer.md` with:

```markdown
You are an implementation agent. Implement the following task in the codebase.

## Task
{taskSpec}

## Previous Attempt Feedback
{failureSummary}

## Instructions
1. Read the relevant code files to understand the codebase
2. Implement the changes specified in the task
3. Follow existing code patterns and conventions
4. Write tests if appropriate
5. Ensure your changes compile/build successfully
6. Never ask for human input. If something is unclear, make a reasonable assumption based on the spec, the codebase, and software engineering best practices. If you must choose between approaches, pick the simpler one.

Just implement the changes directly. Do not output JSON.
```

- [ ] **Step 2: Simplify `ImplementationResult` interface**

In `src/worker/stages/implementer.ts`:

```ts
export interface ImplementationResult {
  success: boolean;
  output: string;
}
```

Remove `needsUserInput?: string[]`.

- [ ] **Step 3: Delete `parseNeedsUserInput` function**

Delete the entire function at lines 157-189 of `src/worker/stages/implementer.ts`.

- [ ] **Step 4: Remove needsUserInput check from `runImplementation`**

In `src/worker/stages/implementer.ts`, remove lines 87-103 (the `userInputNeeded` block). The code after `executeClaudeCode` should go directly to the exit code check:

```ts
    const result = await executeClaudeCode({
      prompt,
      worktreePath,
      model,
      onOutput,
    });

    // Check exit code
    if (result.exitCode !== 0) {
      updateRun(db, run.id, {
        status: 'failed',
        output: result.output,
        tokensUsed: result.tokensUsed,
        modelUsed: model,
        finishedAt: new Date().toISOString(),
      });

      return {
        success: false,
        output: result.output,
      };
    }

    // Success
    updateRun(db, run.id, {
      status: 'success',
      output: result.output,
      tokensUsed: result.tokensUsed,
      modelUsed: model,
      finishedAt: new Date().toISOString(),
    });

    return {
      success: true,
      output: result.output,
    };
```

- [ ] **Step 5: Verify build compiles**

Run: `npm run build:server`
Expected: No errors related to `needsUserInput` or `parseNeedsUserInput`

- [ ] **Step 6: Commit**

```bash
git add prompts/implementer.md src/worker/stages/implementer.ts
git commit -m "feat: remove implementer user-input blocking, assume and proceed"
```

---

### Task 3: Remove blocking code paths from worker loop

**Files:**
- Modify: `src/worker/loop.ts:312-331` (implementer needsUserInput → blocked)
- Modify: `src/worker/loop.ts:762-784` (planner questions → blocked)
- Modify: `src/worker/loop.ts:787` (planResult.subtasks check — update reference)

- [ ] **Step 1: Remove implementer blocking path**

In `src/worker/loop.ts`, in `runImplementationLoop`, remove lines 312-331 (the `if (implResult.needsUserInput...)` block). The code should go directly from the `executeClaudeCode` result to the `if (!implResult.success)` check.

- [ ] **Step 2: Store assumptions artifact after planning**

In `src/worker/loop.ts`, in `processTask`, after the planning stage succeeds (after line 759 `await runHook(hooks, 'afterStage', ...)`), add assumptions artifact storage before the questions/subtasks handling:

```ts
      // Store planning assumptions as artifact
      if (planResult.assumptions.length > 0) {
        const planningRun = getLatestRunByTaskAndStage(db, task.id, 'planning');
        if (planningRun) {
          createArtifact(db, {
            runId: planningRun.id,
            type: 'assumptions',
            name: 'planning_assumptions',
            content: JSON.stringify(planResult.assumptions),
          });
        }
      }
```

Add `getLatestRunByTaskAndStage` and `createArtifact` to the existing imports from `../db/queries.js` in loop.ts. Neither is currently imported. Update the import block (lines 8-22) to include them:

```ts
import {
  listTasksByStatus,
  claimTask,
  updateTask,
  unclaimTask,
  createEvent,
  createTask,
  createGitRef,
  createArtifact,
  getTaskById,
  getProjectById,
  listProjects,
  listGitRefsByTask,
  getSubtasksByParentId,
  getNextBacklogSubtask,
  getLatestRunByTaskAndStage,
} from '../db/queries.js';
```

- [ ] **Step 3: Remove planner questions → blocked transition**

In `src/worker/loop.ts`, remove the entire `if (planResult.questions.length > 0)` block (lines 762-784). The code should flow directly from assumptions storage to the subtasks check.

- [ ] **Step 4: Verify build compiles**

Run: `npm run build:server`
Expected: No errors. No references to `planResult.questions` or `implResult.needsUserInput` remain.

- [ ] **Step 5: Run existing tests**

Run: `npm test`
Expected: All existing tests pass. (Some tests may reference `questions` — if so, update them in this step.)

- [ ] **Step 6: Commit**

```bash
git add src/worker/loop.ts
git commit -m "feat: remove automated blocking from worker loop, store assumptions"
```

---

## Chunk 2: PR Assumptions & Backend Types

### Task 4: Surface assumptions in PR description

**Files:**
- Modify: `src/worker/stages/pr-creator.ts:196-278` (buildPRBody function)

- [ ] **Step 1: Add assumptions section to `buildPRBody`**

In `src/worker/stages/pr-creator.ts`, in the `buildPRBody` function, after the plan summary section (after line 211), add:

```ts
  // Assumptions from planning
  const assumptions = collectAssumptions(db, task);
  if (assumptions.length > 0) {
    sections.push('## Assumptions Made');
    sections.push('> These decisions were made autonomously. Please verify during review.');
    sections.push('');
    for (const assumption of assumptions) {
      sections.push(`- ${assumption}`);
    }
  }
```

- [ ] **Step 2: Add `collectAssumptions` helper function**

Add this function above `buildPRBody` in `pr-creator.ts`:

```ts
/**
 * Collect all planning assumptions for a task and its subtasks.
 */
function collectAssumptions(db: Database.Database, task: Task): string[] {
  const assumptions: string[] = [];

  // Get assumptions from the task's own planning run
  const planningRun = getLatestRunByTaskAndStage(db, task.id, 'planning');
  if (planningRun) {
    const artifacts = listArtifactsByRun(db, planningRun.id);
    const assumptionArtifact = artifacts.find((a) => a.type === 'assumptions');
    if (assumptionArtifact) {
      try {
        const parsed = JSON.parse(assumptionArtifact.content) as string[];
        assumptions.push(...parsed);
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  // Get assumptions from subtasks
  const subtasks = getSubtasksByParentId(db, task.id);
  for (const subtask of subtasks) {
    const subtaskRun = getLatestRunByTaskAndStage(db, subtask.id, 'planning');
    if (subtaskRun) {
      const artifacts = listArtifactsByRun(db, subtaskRun.id);
      const assumptionArtifact = artifacts.find((a) => a.type === 'assumptions');
      if (assumptionArtifact) {
        try {
          const parsed = JSON.parse(assumptionArtifact.content) as string[];
          assumptions.push(...parsed);
        } catch {
          // Malformed JSON — skip
        }
      }
    }
  }

  return assumptions;
}
```

- [ ] **Step 3: Add missing import**

Add `getSubtasksByParentId` to the existing imports from `../../db/queries.js` in `pr-creator.ts` (line 5-14). Add it to the end of the import list:

```ts
import {
  createRun,
  updateRun,
  createArtifact,
  listGitRefsByTask,
  updateGitRef,
  getLatestRunByTaskAndStage,
  listArtifactsByRun,
  getTaskById,
  getSubtasksByParentId,
} from '../../db/queries.js';
```

Note: this preserves all existing imports (`createRun`, `updateRun`, etc.) and only adds `getSubtasksByParentId`.

- [ ] **Step 4: Verify build compiles**

Run: `npm run build:server`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add src/worker/stages/pr-creator.ts
git commit -m "feat: include planning assumptions in PR description"
```

---

### Task 5: Add `DecisionPoint` type to shared types

**Files:**
- Modify: `src/types/index.ts`
- Modify: `ui/src/types.ts`

- [ ] **Step 1: Add `DecisionPoint` to backend types**

At the end of `src/types/index.ts`, add:

```ts
// ── Decision points for task creation ───────────────────────────────
export interface DecisionPoint {
  question: string;
  options: string[];
  defaultIndex: number;
  specField: string;
}
```

- [ ] **Step 2: Add `DecisionPoint` to frontend types**

At the end of `ui/src/types.ts`, add:

```ts
export interface DecisionPoint {
  question: string;
  options: string[];
  defaultIndex: number;
  specField: string;
}
```

- [ ] **Step 3: Verify both builds compile**

Run: `npm run build`
Expected: Clean build for both server and UI

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts ui/src/types.ts
git commit -m "feat: add DecisionPoint type to shared types"
```

---

## Chunk 3: Enhanced Task Creation

### Task 6: Update `/api/tasks/parse` to generate decision points

**Files:**
- Modify: `src/server/routes/tasks.ts:72-149` (/parse endpoint)

- [ ] **Step 1: Update the parse prompt**

In `src/server/routes/tasks.ts`, replace the prompt string in the `/parse` handler (lines 79-101) with:

```ts
    const prompt = `You are a task parser. Given a short task description, extract structured fields for a software engineering task. Also anticipate likely ambiguities and generate decision points the implementer would need answered.

Return ONLY valid JSON with no markdown fences or extra text.

The JSON must have this exact shape:
{
  "title": "short imperative title (max 80 chars)",
  "description": "1-2 sentence expanded description",
  "riskLevel": "low" | "medium" | "high",
  "priority": 0-10 (0=lowest, 10=highest),
  "spec": {
    "context": "what is the context/background for this task",
    "acceptanceCriteria": "when is this task considered done",
    "constraints": "technical constraints or limitations",
    "verification": "how to verify this task is correct",
    "infrastructureAllowed": "what infrastructure changes are allowed"
  },
  "decisionPoints": [
    {
      "question": "A specific implementation question the developer would face",
      "options": ["Option A", "Option B", "Option C"],
      "defaultIndex": 0,
      "specField": "constraints"
    }
  ]
}

Guidelines for decision points:
- Generate 0-5 decision points for genuine ambiguities only
- Each must have 2-4 concrete options with one recommended as defaultIndex
- specField must be one of: context, acceptanceCriteria, constraints, verification, infrastructureAllowed
- Focus on product behavior decisions, not implementation details
- If the task is clear and unambiguous, return an empty decisionPoints array

Guidelines for field inference:
- riskLevel: "high" for DB migrations, auth changes, infra; "medium" for API changes, refactors; "low" for UI tweaks, docs, tests
- priority: higher for bugs, security fixes, blockers; lower for nice-to-haves, cleanup
- Leave spec fields as empty strings if not inferable from the description

Task description: ${description.trim()}`;
```

- [ ] **Step 2: Validate decisionPoints in response parsing**

In the same `/parse` handler, update the `child.on('close')` callback to validate and cap decision points. After `const parsed = JSON.parse(jsonStr);`, add:

```ts
        // Validate and cap decision points
        if (Array.isArray(parsed.decisionPoints)) {
          parsed.decisionPoints = parsed.decisionPoints
            .filter((dp: Record<string, unknown>) =>
              typeof dp.question === 'string' &&
              Array.isArray(dp.options) &&
              dp.options.length >= 2 &&
              typeof dp.defaultIndex === 'number' &&
              typeof dp.specField === 'string'
            )
            .slice(0, 5);
        } else {
          parsed.decisionPoints = [];
        }
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build:server`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/tasks.ts
git commit -m "feat: generate decision points in task parse endpoint"
```

---

### Task 7: Add decisions phase to TaskForm UI

**Files:**
- Modify: `ui/src/components/TaskForm.tsx`

- [ ] **Step 1: Update phase type and state**

In `ui/src/components/TaskForm.tsx`, update the `Phase` type and add decision state:

```ts
type Phase = 'describe' | 'decisions' | 'preview';
```

Add an import for `DecisionPoint` from `../types` at the top of the file:

```ts
import type { Task, RiskLevel, SpecTemplate, DecisionPoint } from '../types';
```

Add state for decisions after the existing state declarations:

```ts
  const [decisionPoints, setDecisionPoints] = useState<DecisionPoint[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<number[]>([]);
```

- [ ] **Step 2: Update `handleParse` to capture decision points**

In the `handleParse` function, after setting the spec fields (line 43), add:

```ts
      if (Array.isArray(parsed.decisionPoints) && parsed.decisionPoints.length > 0) {
        setDecisionPoints(parsed.decisionPoints);
        setSelectedOptions(parsed.decisionPoints.map((dp: { defaultIndex: number }) => dp.defaultIndex));
        setPhase('decisions');
      } else {
        setPhase('preview');
      }
```

And remove the existing `setPhase('preview');` at line 44.

- [ ] **Step 3: Add decisions phase UI**

In the JSX return, between the `describe` and `preview` phase blocks, add:

```tsx
          {phase === 'decisions' && (
            <>
              <Dialog.Title className="text-lg font-semibold text-white mb-1">Quick Decisions</Dialog.Title>
              <p className="text-xs text-text-secondary mb-4">These help the AI make better choices. Defaults are pre-selected — just click Continue if they look right.</p>
              {error && <div className="text-accent-red text-sm mb-3">{error}</div>}
              {decisionPoints.map((dp, i) => (
                <div key={i} className="mb-4 pb-3 border-b border-border-default last:border-0">
                  <div className="text-sm font-medium text-text-primary mb-2">{dp.question}</div>
                  <div className="flex flex-col gap-1.5">
                    {dp.options.map((opt, j) => (
                      <label key={j} className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary">
                        <input
                          type="radio"
                          name={`decision-${i}`}
                          checked={selectedOptions[i] === j}
                          onChange={() => {
                            const next = [...selectedOptions];
                            next[i] = j;
                            setSelectedOptions(next);
                          }}
                          className="accent-accent-blue"
                        />
                        {opt}
                        {j === dp.defaultIndex && <span className="text-[10px] text-accent-blue">(recommended)</span>}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    // Fold selected answers into spec fields
                    const updatedSpec = { ...spec };
                    for (let i = 0; i < decisionPoints.length; i++) {
                      const dp = decisionPoints[i];
                      const answer = dp.options[selectedOptions[i]];
                      const field = dp.specField as keyof typeof updatedSpec;
                      if (field in updatedSpec) {
                        const existing = updatedSpec[field];
                        updatedSpec[field] = existing
                          ? `${existing}\n- Decision: ${dp.question} → ${answer}`
                          : `- Decision: ${dp.question} → ${answer}`;
                      }
                    }
                    setSpec(updatedSpec);
                    setPhase('preview');
                  }}
                  className={`${btnClasses} bg-accent-blue text-white hover:bg-blue-600`}
                >
                  Continue
                </button>
                <button onClick={() => setPhase('preview')} className={`${btnClasses} text-text-secondary border border-border-default hover:bg-bg-tertiary`}>Skip</button>
                <button onClick={() => setPhase('describe')} className={`${btnClasses} text-text-secondary border border-border-default hover:bg-bg-tertiary`}>← Back</button>
              </div>
            </>
          )}
```

- [ ] **Step 4: Verify UI builds**

Run: `npm run build:ui`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/TaskForm.tsx
git commit -m "feat: add decision points phase to task creation form"
```

---

## Chunk 4: Assumptions in Task Detail UI

### Task 8: Show assumptions in TaskDetail

**Files:**
- Modify: `ui/src/components/TaskDetail.tsx:91-92` (after spec section)

- [ ] **Step 1: Add assumptions section to TaskDetail**

In `ui/src/components/TaskDetail.tsx`, after the spec section closing `</div>` (line 91), add a new section that fetches and displays assumptions:

```tsx
          {/* Assumptions */}
          <AssumptionsPanel runs={runs} />
```

- [ ] **Step 2: Create `AssumptionsPanel` component inline**

At the top of `TaskDetail.tsx`, before the main component, add a small inline component. This reuses the `runs` state already fetched by the parent (line 37) to avoid a redundant API call:

```tsx
const AssumptionsPanel: React.FC<{ runs: Run[] }> = ({ runs }) => {
  const [assumptions, setAssumptions] = useState<string[]>([]);

  useEffect(() => {
    const planningRun = runs.find((r) => r.stage === 'planning' && r.status === 'success');
    if (!planningRun) {
      setAssumptions([]);
      return;
    }
    api.get<Array<{ type: string; content: string }>>(`/api/artifacts?runId=${planningRun.id}`)
      .then((artifacts) => {
        const found = artifacts.find((a) => a.type === 'assumptions');
        if (found) {
          try {
            setAssumptions(JSON.parse(found.content) as string[]);
          } catch {
            setAssumptions([]);
          }
        } else {
          setAssumptions([]);
        }
      })
      .catch(console.error);
  }, [runs]);

  if (assumptions.length === 0) return null;

  return (
    <div className="mb-4 pb-4 border-b border-border-default">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-accent-amber mb-1.5">Assumptions</h4>
      <div className="bg-accent-amber/10 border border-accent-amber/30 rounded-md p-3">
        <p className="text-[11px] text-accent-amber mb-2">These decisions were made autonomously. Verify during PR review.</p>
        <ul className="list-disc list-inside text-sm text-text-primary space-y-1">
          {assumptions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      </div>
    </div>
  );
};
```

`Run` is already imported at line 9 — no import changes needed.

- [ ] **Step 3: Verify UI builds**

Run: `npm run build:ui`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/TaskDetail.tsx
git commit -m "feat: show planning assumptions in task detail view"
```

---

### Task 9: Final verification

**Files:** None (testing only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: Clean build for both server and UI

- [ ] **Step 3: Verify no references to removed code**

Run: `grep -r "needsUserInput\|needs_user_input\|parseNeedsUserInput" src/ --include="*.ts" | grep -v node_modules | grep -v dist`
Expected: No matches (only the prompt file and possibly test files should reference this, not source code)

Run: `grep -r "planResult\.questions\|questions\.length" src/ --include="*.ts" | grep -v node_modules | grep -v dist`
Expected: No matches in worker code

- [ ] **Step 4: Commit any fixes**

If any issues were found, fix and commit.
