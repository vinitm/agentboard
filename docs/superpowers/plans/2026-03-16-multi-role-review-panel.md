# Multi-Role Review Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sequential `review_spec` → `review_code` stages with a single `review_panel` stage that runs 3 specialized reviewers (Architect, QA, Security) in parallel with unanimous pass required.

**Architecture:** The `review-panel.ts` stage orchestrates 3 parallel Claude Code invocations, each with a role-specific prompt. Results are aggregated — all must pass. On failure, combined feedback is formatted per-role and fed back to the implementer. Run records use `stage: 'review_panel'` with role stored in an Artifact (`type: 'review_result'`).

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Node.js, React + Tailwind (UI)

**Spec:** `docs/superpowers/specs/2026-03-16-multi-role-review-panel-design.md`

---

## Chunk 1: Types, Config, and Model Selector

### Task 1: Update Backend Types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Update TaskStatus type**

Replace `review_spec` and `review_code` with `review_panel` in `TaskStatus`:

```typescript
export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'review_panel'
  | 'needs_human_review'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'cancelled';
```

- [ ] **Step 2: Update Stage type**

```typescript
export type Stage =
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'review_panel'
  | 'pr_creation';
```

- [ ] **Step 3: Update ModelDefaults interface**

```typescript
export interface ModelDefaults {
  planning: string;
  implementation: string;
  review: string;
  security: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "refactor: replace review_spec/review_code with review_panel in types"
```

### Task 2: Update Frontend Types

**Files:**
- Modify: `ui/src/types.ts`

- [ ] **Step 1: Update TaskStatus and Stage**

```typescript
export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'review_panel'
  | 'needs_human_review'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type Stage =
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'review_panel'
  | 'pr_creation';
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/types.ts
git commit -m "refactor: update frontend types for review_panel"
```

### Task 3: Update Model Selector

**Files:**
- Modify: `src/worker/model-selector.ts`
- Modify: `src/worker/model-selector.test.ts`

- [ ] **Step 1: Update model-selector.ts**

Replace the entire file content for `selectModel`:

```typescript
import type { Stage, RiskLevel, AgentboardConfig } from '../types/index.js';

export function selectModel(
  stage: Stage,
  riskLevel: RiskLevel,
  config: AgentboardConfig
): string {
  // High-risk override for review stage
  if (riskLevel === 'high' && stage === 'review_panel') {
    return 'opus';
  }

  const stageToConfigKey: Record<Stage, keyof AgentboardConfig['modelDefaults']> = {
    planning: 'planning',
    implementing: 'implementation',
    checks: 'implementation',
    review_panel: 'review',
    pr_creation: 'implementation',
  };

  const key = stageToConfigKey[stage];
  return config.modelDefaults[key];
}
```

- [ ] **Step 2: Update model-selector.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { selectModel } from './model-selector.js';
import { createTestConfig } from '../test/helpers.js';

describe('selectModel', () => {
  const config = createTestConfig();

  it('planning → config.modelDefaults.planning (sonnet)', () => {
    expect(selectModel('planning', 'low', config)).toBe('sonnet');
  });

  it('implementing → config.modelDefaults.implementation (opus)', () => {
    expect(selectModel('implementing', 'low', config)).toBe('opus');
  });

  it('checks → config.modelDefaults.implementation (opus)', () => {
    expect(selectModel('checks', 'low', config)).toBe('opus');
  });

  it('review_panel → config.modelDefaults.review (sonnet)', () => {
    expect(selectModel('review_panel', 'low', config)).toBe('sonnet');
  });

  it('pr_creation → config.modelDefaults.implementation (opus)', () => {
    expect(selectModel('pr_creation', 'low', config)).toBe('opus');
  });

  it('high risk overrides review_panel → opus', () => {
    expect(selectModel('review_panel', 'high', config)).toBe('opus');
  });

  it('high risk does NOT override planning', () => {
    expect(selectModel('planning', 'high', config)).toBe('sonnet');
  });

  it('medium risk does NOT override review_panel', () => {
    expect(selectModel('review_panel', 'medium', config)).toBe('sonnet');
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/worker/model-selector.ts src/worker/model-selector.test.ts
git commit -m "refactor: update model selector for review_panel stage"
```

### Task 4: Update Test Helpers, CLI Init, and Config Loader

**Files:**
- Modify: `src/test/helpers.ts`
- Modify: `src/cli/init.ts`
- Modify: `src/worker/loop.ts` (config loading section only)

- [ ] **Step 1: Update createTestConfig in helpers.ts**

Find the `modelDefaults` object in `createTestConfig()` and replace:

```typescript
// Old:
reviewSpec: 'sonnet',
reviewCode: 'sonnet',

// New:
review: 'sonnet',
```

Keep the `security` key unchanged.

- [ ] **Step 2: Update init.ts default config**

Find the `modelDefaults` object in the init config (around line 60-65) and replace:

```typescript
// Old:
reviewSpec: 'sonnet',
reviewCode: 'sonnet',

// New:
review: 'sonnet',
```

Keep the `security` key unchanged.

- [ ] **Step 3: Add config migration helper**

Create a helper function in `src/worker/config-compat.ts` that normalizes old config keys:

```typescript
import type { AgentboardConfig } from '../types/index.js';

/**
 * Normalize config loaded from disk, migrating old keys to new ones.
 * Handles existing config.json files that have reviewSpec/reviewCode
 * instead of the new 'review' key.
 */
export function normalizeConfig(raw: Record<string, unknown>): AgentboardConfig {
  const config = raw as AgentboardConfig;

  // Migrate old reviewSpec/reviewCode to review
  if (config.modelDefaults) {
    const md = config.modelDefaults as Record<string, string>;
    if (!md.review && (md.reviewSpec || md.reviewCode)) {
      md.review = md.reviewSpec ?? md.reviewCode ?? 'sonnet';
      delete md.reviewSpec;
      delete md.reviewCode;
    }
  }

  return config;
}
```

- [ ] **Step 4: Wire normalizeConfig into config loading**

In `src/worker/loop.ts`, find the config loading in `processTask` (around line 674):

```typescript
// Old:
projectConfig = JSON.parse(raw) as AgentboardConfig;

// New:
import { normalizeConfig } from './config-compat.js';
// ... then in processTask:
projectConfig = normalizeConfig(JSON.parse(raw));
```

Also update the config loading in `checkAndUpdateParentStatus` (around line 141) the same way.

Note: The import should be added at the top of the file with other imports.

- [ ] **Step 5: Commit**

```bash
git add src/test/helpers.ts src/cli/init.ts src/worker/config-compat.ts src/worker/loop.ts
git commit -m "refactor: update model config keys with backward-compatible migration"
```

### Task 5: Update Recovery and Server Route Guards

**Files:**
- Modify: `src/worker/recovery.ts`
- Modify: `src/server/routes/tasks.ts`
- Modify: `src/server/routes/tasks.test.ts`
- Modify: `src/db/queries.test.ts`

- [ ] **Step 1: Update recovery.ts**

Replace `AGENT_CONTROLLED_STATUSES` (line 6-12):

```typescript
const AGENT_CONTROLLED_STATUSES: TaskStatus[] = [
  'planning',
  'implementing',
  'checks',
  'review_panel',
];
```

- [ ] **Step 2: Update tasks.ts route guard**

Replace `AGENT_CONTROLLED_COLUMNS` (line 10-16):

```typescript
const AGENT_CONTROLLED_COLUMNS: TaskStatus[] = [
  'planning',
  'implementing',
  'checks',
  'review_panel',
];
```

- [ ] **Step 3: Update tasks.test.ts**

Find the test that iterates over agent-controlled columns (line 179) and replace the array:

```typescript
for (const col of ['planning', 'implementing', 'checks', 'review_panel']) {
```

- [ ] **Step 4: Update queries.test.ts**

Find the `getLatestRunByTaskAndStage` test (line 415) and replace:

```typescript
const result = queries.getLatestRunByTaskAndStage(db, task.id, 'review_panel');
```

- [ ] **Step 5: Commit**

Note: `npm test` will NOT pass yet because `loop.ts` still references deleted `review_spec`/`review_code` types and imports from deleted files. This is expected — Task 9 will fix it. Do not run tests until after Chunk 3.

- [ ] **Step 6: Commit**

```bash
git add src/worker/recovery.ts src/server/routes/tasks.ts src/server/routes/tasks.test.ts src/db/queries.test.ts
git commit -m "refactor: update agent-controlled status arrays for review_panel"
```

### Task 6: Add Data Migration

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add migration function**

Add after the existing table creation code in `schema.ts`:

```typescript
export function migrateReviewStages(db: Database.Database): void {
  const migrated = db
    .prepare(`UPDATE tasks SET status = 'review_panel' WHERE status IN ('review_spec', 'review_code')`)
    .run();
  const migratedRuns = db
    .prepare(`UPDATE runs SET stage = 'review_panel' WHERE stage IN ('review_spec', 'review_code')`)
    .run();
  if (migrated.changes > 0 || migratedRuns.changes > 0) {
    console.log(`[db] Migrated ${migrated.changes} tasks and ${migratedRuns.changes} runs from review_spec/review_code to review_panel`);
  }
}
```

- [ ] **Step 2: Call migration after table creation**

In the `initializeDatabase` function (or equivalent), add after the `CREATE TABLE IF NOT EXISTS` calls:

```typescript
migrateReviewStages(db);
```

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: add data migration for review_spec/review_code → review_panel"
```

---

## Chunk 2: Review Panel Stage (Core Logic)

### Task 7: Create Review Prompt Templates

**Files:**
- Create: `prompts/review-architect.md`
- Create: `prompts/review-qa.md`
- Create: `prompts/review-security.md`
- Delete: `prompts/review-spec.md`
- Delete: `prompts/review-code.md`

- [ ] **Step 1: Create prompts/review-architect.md**

```markdown
You are a Senior Software Architect reviewing code changes. Focus exclusively on architectural quality.

## Task Context
{taskSpec}

## Your Review Focus
1. Read the code changes in this worktree
2. Evaluate ONLY architectural concerns:
   - Does the implementation follow existing codebase patterns and conventions?
   - Are abstractions appropriate — not too many, not too few?
   - Are module boundaries clean with well-defined interfaces?
   - Is complexity proportional to the problem being solved?
   - Are there any god-classes, circular dependencies, or tight coupling?
   - Would this be easy for another developer to understand and modify?
3. Do NOT review for security vulnerabilities or test coverage — other reviewers handle those.
4. Output a JSON response:
```json
{
  "passed": true/false,
  "feedback": "Summary of architectural findings",
  "issues": ["issue1", "issue2"]
}
```

Minor style issues should not fail the review. Focus on structural problems that would make the code harder to maintain or extend.
```

- [ ] **Step 2: Create prompts/review-qa.md**

```markdown
You are a QA Engineer reviewing code changes. Focus exclusively on correctness and spec compliance.

## Task Context
{taskSpec}

## Your Review Focus
1. Read the code changes in this worktree
2. Evaluate ONLY correctness and completeness:
   - Does the implementation satisfy every acceptance criterion in the spec?
   - Are edge cases handled (null/undefined, empty inputs, boundary values)?
   - Are error paths handled gracefully?
   - Is test coverage sufficient for the changes made?
   - Do the tests actually verify the right behavior (not just that code runs)?
   - Are there any obvious logic errors or off-by-one bugs?
3. Do NOT review for architectural patterns or security — other reviewers handle those.
4. Output a JSON response:
```json
{
  "passed": true/false,
  "feedback": "Summary of correctness findings",
  "issues": ["issue1", "issue2"]
}
```

Be strict: if any acceptance criterion is not fully met, fail the review.
```

- [ ] **Step 3: Create prompts/review-security.md**

```markdown
You are a Security Engineer reviewing code changes. Focus exclusively on security concerns.

## Task Context
{taskSpec}

## Your Review Focus
1. Read the code changes in this worktree
2. Evaluate ONLY security concerns:
   - SQL injection: Are all queries parameterized?
   - Command injection: Is user input ever passed to shell commands unsafely?
   - XSS: Is user-provided content properly escaped in outputs?
   - Path traversal: Are file paths validated against directory escape?
   - Authentication/authorization: Are access controls properly enforced?
   - Data exposure: Are secrets, tokens, or PII handled safely?
   - Dependency risks: Are new dependencies from trusted sources?
   - Input validation: Is external input validated at system boundaries?
3. Do NOT review for code style, architecture, or test coverage — other reviewers handle those.
4. Output a JSON response:
```json
{
  "passed": true/false,
  "feedback": "Summary of security findings",
  "issues": ["issue1", "issue2"]
}
```

Minor style issues should not fail the review. Only fail for actual security vulnerabilities or risky patterns.
```

- [ ] **Step 4: Delete old prompt files**

```bash
rm prompts/review-spec.md prompts/review-code.md
```

- [ ] **Step 5: Commit**

```bash
git add prompts/review-architect.md prompts/review-qa.md prompts/review-security.md
git rm prompts/review-spec.md prompts/review-code.md
git commit -m "feat: add role-specific review prompt templates"
```

### Task 8: Create review-panel.ts Stage

**Files:**
- Create: `src/worker/stages/review-panel.ts`

- [ ] **Step 1: Write the failing tests first**

Create `src/worker/stages/review-panel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatPanelFeedback, parseReviewOutput, type RoleReviewResult } from './review-panel.js';

describe('formatPanelFeedback', () => {
  it('formats mixed pass/fail results with cycle info', () => {
    const results: RoleReviewResult[] = [
      { role: 'architect', passed: false, feedback: 'Bad abstractions', issues: ['God class in foo.ts'] },
      { role: 'qa', passed: true, feedback: 'All criteria met', issues: [] },
      { role: 'security', passed: false, feedback: 'SQL injection found', issues: ['Unparameterized query'] },
    ];
    const output = formatPanelFeedback(results, 2, 3);
    expect(output).toContain('## Review Panel Feedback (Cycle 2/3)');
    expect(output).toContain('### Architect (FAILED)');
    expect(output).toContain('God class in foo.ts');
    expect(output).toContain('### QA Engineer (PASSED)');
    expect(output).toContain('### Security Reviewer (FAILED)');
    expect(output).toContain('Unparameterized query');
  });

  it('formats all-pass results', () => {
    const results: RoleReviewResult[] = [
      { role: 'architect', passed: true, feedback: 'Clean', issues: [] },
      { role: 'qa', passed: true, feedback: 'Good', issues: [] },
      { role: 'security', passed: true, feedback: 'Secure', issues: [] },
    ];
    const output = formatPanelFeedback(results, 1, 3);
    expect(output).toContain('### Architect (PASSED)');
    expect(output).toContain('### QA Engineer (PASSED)');
    expect(output).toContain('### Security Reviewer (PASSED)');
    expect(output).not.toContain('FAILED');
  });
});

describe('parseReviewOutput', () => {
  it('parses JSON from code fences', () => {
    const output = '```json\n{"passed": true, "feedback": "All good", "issues": []}\n```';
    const result = parseReviewOutput(output);
    expect(result.passed).toBe(true);
    expect(result.feedback).toBe('All good');
    expect(result.issues).toEqual([]);
  });

  it('parses raw JSON with passed key', () => {
    const output = 'Some text before {"passed": false, "feedback": "Bad", "issues": ["bug"]} after';
    const result = parseReviewOutput(output);
    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(['bug']);
  });

  it('returns failed result for unparseable output', () => {
    const result = parseReviewOutput('This is just plain text with no JSON');
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Could not parse structured review output');
  });

  it('handles missing fields gracefully', () => {
    const output = '```json\n{"passed": true}\n```';
    const result = parseReviewOutput(output);
    expect(result.passed).toBe(true);
    expect(result.feedback).toBe('');
    expect(result.issues).toEqual([]);
  });

  it('filters non-string issues', () => {
    const output = '```json\n{"passed": false, "feedback": "x", "issues": ["real", 123, null]}\n```';
    const result = parseReviewOutput(output);
    expect(result.issues).toEqual(['real']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/worker/stages/review-panel.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create review-panel.ts**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig } from '../../types/index.js';
import { selectModel } from '../model-selector.js';
import { buildTaskPacket } from '../context-builder.js';
import { executeClaudeCode } from '../executor.js';
import { createRun, updateRun, createArtifact } from '../../db/queries.js';

export type ReviewerRole = 'architect' | 'qa' | 'security';

export interface ReviewResult {
  passed: boolean;
  feedback: string;
  issues: string[];
}

export interface RoleReviewResult extends ReviewResult {
  role: ReviewerRole;
}

export interface PanelResult {
  passed: boolean;
  results: RoleReviewResult[];
  feedback: string;
}

const ROLES: ReviewerRole[] = ['architect', 'qa', 'security'];

const ROLE_LABELS: Record<ReviewerRole, string> = {
  architect: 'Architect',
  qa: 'QA Engineer',
  security: 'Security Reviewer',
};

const ROLE_PROMPT_FILES: Record<ReviewerRole, string> = {
  architect: 'review-architect.md',
  qa: 'review-qa.md',
  security: 'review-security.md',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadPromptTemplate(role: ReviewerRole): string {
  const promptPath = path.resolve(__dirname, '../../../../prompts', ROLE_PROMPT_FILES[role]);
  try {
    return fs.readFileSync(promptPath, 'utf-8');
  } catch {
    throw new Error(`Review prompt template not found at ${promptPath}`);
  }
}

export function parseReviewOutput(output: string): ReviewResult {
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      return validateReviewResult(JSON.parse(fenceMatch[1]));
    } catch {
      // Fall through
    }
  }

  const jsonMatch = output.match(/\{[\s\S]*"passed"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return validateReviewResult(JSON.parse(jsonMatch[0]));
    } catch {
      // Fall through
    }
  }

  return {
    passed: false,
    feedback: output.slice(0, 2000),
    issues: ['Could not parse structured review output'],
  };
}

function validateReviewResult(data: unknown): ReviewResult {
  const obj = data as Record<string, unknown>;
  return {
    passed: typeof obj.passed === 'boolean' ? obj.passed : false,
    feedback: typeof obj.feedback === 'string' ? obj.feedback : '',
    issues: Array.isArray(obj.issues)
      ? (obj.issues as unknown[]).filter((i): i is string => typeof i === 'string')
      : [],
  };
}

async function runSingleReviewer(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig,
  role: ReviewerRole,
  onOutput?: (chunk: string) => void
): Promise<RoleReviewResult> {
  const model = selectModel('review_panel', task.riskLevel, config);
  const taskPacket = buildTaskPacket(db, task);
  const template = loadPromptTemplate(role);
  const prompt = template.replace('{taskSpec}', () => taskPacket);

  const run = createRun(db, {
    taskId: task.id,
    stage: 'review_panel',
    modelUsed: model,
    input: prompt,
  });

  try {
    const result = await executeClaudeCode({
      prompt,
      worktreePath,
      model,
      onOutput,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Claude Code exited with code ${result.exitCode}: ${result.output}`);
    }

    const reviewResult = parseReviewOutput(result.output);

    updateRun(db, run.id, {
      status: reviewResult.passed ? 'success' : 'failed',
      output: JSON.stringify(reviewResult),
      tokensUsed: result.tokensUsed,
      finishedAt: new Date().toISOString(),
    });

    // Store role and full result as an artifact for audit trail
    createArtifact(db, {
      runId: run.id,
      type: 'review_result',
      name: role,
      content: JSON.stringify(reviewResult),
    });

    return { ...reviewResult, role };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    updateRun(db, run.id, {
      status: 'failed',
      output: errorMessage,
      finishedAt: new Date().toISOString(),
    });

    createArtifact(db, {
      runId: run.id,
      type: 'review_result',
      name: role,
      content: JSON.stringify({
        passed: false,
        feedback: `${ROLE_LABELS[role]} reviewer crashed: ${errorMessage}`,
        issues: ['Review execution error'],
      }),
    });

    return {
      role,
      passed: false,
      feedback: `${ROLE_LABELS[role]} reviewer crashed: ${errorMessage}`,
      issues: ['Review execution error'],
    };
  }
}

/**
 * Format the combined panel feedback for the implementer.
 */
export function formatPanelFeedback(
  results: RoleReviewResult[],
  cycle: number,
  maxCycles: number
): string {
  const lines: string[] = [`## Review Panel Feedback (Cycle ${cycle}/${maxCycles})`, ''];

  for (const result of results) {
    const label = ROLE_LABELS[result.role];
    const status = result.passed ? 'PASSED' : 'FAILED';
    lines.push(`### ${label} (${status})`);

    if (result.issues.length > 0) {
      for (const issue of result.issues) {
        lines.push(`- ${issue}`);
      }
    } else if (result.passed) {
      lines.push('No issues.');
    } else {
      lines.push(result.feedback || 'No details provided.');
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Run the review panel: 3 specialized reviewers in parallel.
 * All must pass (unanimous) for the panel to pass.
 */
export async function runReviewPanel(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig,
  onOutput?: (chunk: string) => void
): Promise<PanelResult> {
  // Launch all 3 reviewers in parallel
  // Note: with maxConcurrentTasks, this means up to 3x concurrent Claude processes during review
  const reviewPromises = ROLES.map(role =>
    runSingleReviewer(db, task, worktreePath, config, role, onOutput)
  );

  const settledResults = await Promise.allSettled(reviewPromises);

  const results: RoleReviewResult[] = settledResults.map((settled, i) => {
    if (settled.status === 'fulfilled') {
      return settled.value;
    }
    // Promise rejected (unexpected) — treat as crash
    const errorMessage = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
    return {
      role: ROLES[i],
      passed: false,
      feedback: `${ROLE_LABELS[ROLES[i]]} reviewer crashed: ${errorMessage}`,
      issues: ['Review execution error'],
    };
  });

  const passed = results.every(r => r.passed);

  return {
    passed,
    results,
    feedback: passed ? 'All reviewers passed.' : results.filter(r => !r.passed).map(r => `${ROLE_LABELS[r.role]}: ${r.feedback}`).join('; '),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/worker/stages/review-panel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/stages/review-panel.ts src/worker/stages/review-panel.test.ts
git commit -m "feat: add review-panel stage with parallel reviewer orchestration"
```

---

## Chunk 3: Worker Loop Integration

### Task 9: Update loop.ts — Replace Review Stages with Panel

**Files:**
- Modify: `src/worker/loop.ts`

- [ ] **Step 1: Update imports**

Replace:
```typescript
import { runSpecReview } from './stages/review-spec.js';
import { runCodeReview } from './stages/review-code.js';
```
With:
```typescript
import { runReviewPanel, formatPanelFeedback } from './stages/review-panel.js';
```

- [ ] **Step 2: Rewrite runReviewAndPR function**

Replace the entire `runReviewAndPR` function (lines 419-651) with:

```typescript
  async function runReviewAndPR(
    task: Task,
    worktreePath: string,
    config: AgentboardConfig,
    io: Server,
    db: Database.Database,
    memory: WorkerMemory,
    configDir: string
  ): Promise<void> {
    let reviewCycle = 0;
    let panelPassed = false;

    while (reviewCycle < config.maxReviewCycles) {
      reviewCycle++;

      // ── Review panel (3 parallel reviewers) ────────────────────────
      updateTask(db, task.id, { status: 'review_panel' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: task.status, to: 'review_panel', reviewCycle })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'review_panel' });

      await runHook(hooks, 'beforeStage', makeHookContext(task, 'review_panel', worktreePath, config));
      const panelResult = await runReviewPanel(db, task, worktreePath, config, createLogStreamer(task.id, `review-panel-${task.id}`));
      await runHook(hooks, 'afterStage', makeHookContext(task, 'review_panel', worktreePath, config));

      if (panelResult.passed) {
        panelPassed = true;

        createAndBroadcastEvent(
          task.id,
          'review_panel_completed',
          JSON.stringify({
            reviewCycle,
            results: panelResult.results.map(r => ({ role: r.role, passed: r.passed, issues: r.issues })),
          })
        );
        break;
      }

      // Panel failed — emit event with per-role details
      createAndBroadcastEvent(
        task.id,
        'review_panel_failed',
        JSON.stringify({
          reviewCycle,
          results: panelResult.results.map(r => ({ role: r.role, passed: r.passed, issues: r.issues })),
        })
      );

      if (reviewCycle >= config.maxReviewCycles) {
        break;
      }

      // Cycle back to implementing with combined feedback
      const feedbackText = formatPanelFeedback(panelResult.results, reviewCycle, config.maxReviewCycles);

      // Store feedback as an event so context-builder picks it up via the failed run output
      createAndBroadcastEvent(
        task.id,
        'review_panel_feedback',
        JSON.stringify({ feedback: feedbackText, reviewCycle })
      );

      updateTask(db, task.id, { status: 'implementing' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({
          from: 'review_panel',
          to: 'implementing',
          reason: 'review_panel_failed',
          reviewCycle,
        })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

      // Re-run implementation with review feedback
      const implResult = await runImplementation(db, task, worktreePath, config, reviewCycle + 1, createLogStreamer(task.id, `review-impl-${reviewCycle}`));
      if (!implResult.success) {
        break;
      }

      // Re-run checks
      updateTask(db, task.id, { status: 'checks' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: 'implementing', to: 'checks' })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'checks' });

      const checksResult = await runChecks(db, task, worktreePath, config, createLogStreamer(task.id, `checks-review-${task.id}`));
      if (!checksResult.passed) {
        break;
      }

      await commitChanges(worktreePath, `feat: address review panel feedback (cycle ${reviewCycle})`);
      continue;
    }

    // If panel didn't pass, fail the task
    if (!panelPassed) {
      updateTask(db, task.id, { status: 'failed' });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({
          from: task.status,
          to: 'failed',
          reason: 'review_cycles_exhausted',
        })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'failed' });
      notify('Task Failed', `"${task.title}" failed: review cycles exhausted`, config);
      await checkAndUpdateParentStatus(task);
      return;
    }

    // ── PR creation (skip for subtasks) ────────────────────────────────
    if (!task.parentTaskId) {
      try {
        await runHook(hooks, 'beforeStage', makeHookContext(task, 'pr_creation', worktreePath, config));
        const prResult = await createPR(db, task, worktreePath, config, createLogStreamer(task.id, `pr-${task.id}`));
        await runHook(hooks, 'afterStage', makeHookContext(task, 'pr_creation', worktreePath, config));

        createAndBroadcastEvent(
          task.id,
          'pr_created',
          JSON.stringify({
            prUrl: prResult.prUrl,
            prNumber: prResult.prNumber,
            reviewCycles: reviewCycle,
          })
        );
        notify('PR Created', `PR for "${task.title}" is ready for review`, config);

        recordConvention(memory, `task:${task.id}:pr`, `PR #${prResult.prNumber} created successfully`);
        saveMemory(configDir, memory);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        createAndBroadcastEvent(
          task.id,
          'pr_creation_failed',
          JSON.stringify({ error: errorMessage })
        );
      }
    }

    // Move to needs_human_review
    updateTask(db, task.id, { status: 'needs_human_review' });
    unclaimTask(db, task.id);
    await checkAndUpdateParentStatus(task);
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({
        from: task.status,
        to: 'needs_human_review',
        reviewCycles: reviewCycle,
      })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'needs_human_review' });
    notify('Task Complete', `"${task.title}" is ready for human review`, config);
    await runHook(hooks, 'onTaskComplete', makeHookContext(task, 'pr_creation', worktreePath, config));
  }
```

- [ ] **Step 3: Delete old review stage files**

```bash
rm src/worker/stages/review-spec.ts src/worker/stages/review-code.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/worker/loop.ts
git rm src/worker/stages/review-spec.ts src/worker/stages/review-code.ts
git commit -m "feat: integrate review panel into worker loop, remove old review stages"
```

### Task 10: Update PR Creator to Use Review Panel Runs

**Files:**
- Modify: `src/worker/stages/pr-creator.ts`

- [ ] **Step 1: Update review results section**

Find the review results section (around lines 299-327) that fetches `review_spec` and `review_code` runs via `getLatestRunByTaskAndStage`. Replace the entire block from the `// Review results` comment through the closing `}` of the code review section with:

```typescript
  // Review panel results — get the 3 most recent review_panel runs (one per role)
  // Using the existing query function pattern from queries.ts
  const allRuns = listRunsByTask(db, task.id);
  const panelRuns = allRuns
    .filter(r => r.stage === 'review_panel')
    .slice(-3); // Last 3 = most recent cycle

  sections.push('## Review Panel');

  if (panelRuns.length > 0) {
    const ROLE_LABELS: Record<string, string> = {
      architect: 'Architect',
      qa: 'QA Engineer',
      security: 'Security',
    };

    for (const run of panelRuns) {
      const artifacts = listArtifactsByRun(db, run.id);
      const roleArtifact = artifacts.find(a => a.type === 'review_result');
      if (roleArtifact) {
        try {
          const result = JSON.parse(roleArtifact.content) as { passed: boolean };
          const label = ROLE_LABELS[roleArtifact.name] ?? roleArtifact.name;
          const icon = result.passed ? '\u2705 Passed' : '\u274c Failed';
          sections.push(`- ${label}: ${icon}`);
        } catch {
          sections.push(`- ${roleArtifact.name}: \u2753 Unknown`);
        }
      }
    }
  } else {
    sections.push('- Review panel: \u2753 Not run');
  }
```

Note: `listRunsByTask` and `listArtifactsByRun` are already imported in pr-creator.ts. If `listRunsByTask` is not imported, add it to the imports from `../../db/queries.js`.

- [ ] **Step 2: Commit**

```bash
git add src/worker/stages/pr-creator.ts
git commit -m "feat: update PR creator to display review panel results"
```

---

## Chunk 4: UI Updates

### Task 11: Update Board and Column Components

**Files:**
- Modify: `ui/src/components/Board.tsx`
- Modify: `ui/src/components/Column.tsx`

- [ ] **Step 1: Update Board.tsx MAIN_COLUMNS**

Replace lines 9-12:

```typescript
const MAIN_COLUMNS: TaskStatus[] = [
  'backlog', 'ready', 'planning', 'implementing', 'checks',
  'review_panel', 'needs_human_review', 'done',
];
```

- [ ] **Step 2: Update Column.tsx**

Replace AGENT_COLUMNS (line 7):

```typescript
const AGENT_COLUMNS: TaskStatus[] = ['planning', 'implementing', 'checks', 'review_panel'];
```

Replace COLUMN_LABELS (lines 8-21) — change the `review_spec` and `review_code` entries:

Remove:
```typescript
  review_spec: 'Review: Spec',
  review_code: 'Review: Code',
```
Add:
```typescript
  review_panel: 'Review Panel',
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Board.tsx ui/src/components/Column.tsx
git commit -m "feat: update kanban board columns for review panel"
```

### Task 12: Update Status Color Components

**Files:**
- Modify: `ui/src/components/TaskCard.tsx`
- Modify: `ui/src/components/SubtaskMiniCard.tsx`
- Modify: `ui/src/components/TaskDetail.tsx`
- Modify: `ui/src/components/TaskPage.tsx`

- [ ] **Step 1: Update TaskCard.tsx statusDotColor**

Replace `review_spec` and `review_code` entries (lines 24-25) with:

```typescript
  review_panel: 'bg-accent-purple',
```

- [ ] **Step 2: Update SubtaskMiniCard.tsx**

Replace `review_spec` and `review_code` entries in statusDotColor (lines 14-15) with:

```typescript
  review_panel: 'bg-accent-purple',
```

Replace the leftBorderClass agent status array (line 28):

```typescript
  if (['planning', 'implementing', 'checks', 'review_panel'].includes(status)) return 'border-l-accent-purple';
```

- [ ] **Step 3: Update TaskDetail.tsx**

Replace `review_spec` and `review_code` in statusBadgeColor (lines 64-65):

```typescript
  implementing: 'text-accent-purple', checks: 'text-accent-purple', review_panel: 'text-accent-purple',
```

Replace isAgentActive array (line 85):

```typescript
  const isAgentActive = ['planning', 'implementing', 'checks', 'review_panel'].includes(task.status);
```

- [ ] **Step 4: Update TaskPage.tsx**

Replace ACTIVE_STATUSES (line 12):

```typescript
const ACTIVE_STATUSES: TaskStatus[] = ['planning', 'implementing', 'checks', 'review_panel'];
```

Replace `review_spec` and `review_code` in statusBadgeColor (lines 22-23):

```typescript
  implementing: 'bg-accent-purple', checks: 'bg-accent-purple', review_panel: 'bg-accent-purple',
```

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/TaskCard.tsx ui/src/components/SubtaskMiniCard.tsx ui/src/components/TaskDetail.tsx ui/src/components/TaskPage.tsx
git commit -m "feat: update status colors and arrays for review panel"
```

### Task 13: Update Event Timeline Components

**Files:**
- Modify: `ui/src/components/EventsTimeline.tsx`
- Modify: `ui/src/components/ActivityFeed.tsx`

- [ ] **Step 1: Update EventsTimeline.tsx**

Replace the EVENT_COLORS entries (lines 10-11):

Remove:
```typescript
  review_spec_failed: 'text-accent-red',
  review_code_failed: 'text-accent-red',
```
Add:
```typescript
  review_panel_failed: 'text-accent-red',
  review_panel_completed: 'text-accent-green',
```

Replace the summarizeEvent cases (lines 26-27):

Remove:
```typescript
    case 'review_spec_failed': return `Spec review failed (cycle ${payload.reviewCycle})`;
    case 'review_code_failed': return `Code review failed (cycle ${payload.reviewCycle})`;
```
Add:
```typescript
    case 'review_panel_failed': {
      const results = payload.results as Array<{ role: string; passed: boolean }> | undefined;
      const failed = results?.filter(r => !r.passed).map(r => r.role).join(', ') ?? 'unknown';
      return `Review panel failed: ${failed} (cycle ${payload.reviewCycle})`;
    }
    case 'review_panel_completed': return `Review panel passed (cycle ${payload.reviewCycle})`;
```

- [ ] **Step 2: Update ActivityFeed.tsx**

Same changes as EventsTimeline — replace EVENT_COLORS entries and summarizeEvent cases:

Remove from EVENT_COLORS:
```typescript
  review_spec_failed: 'text-accent-red',
  review_code_failed: 'text-accent-red',
```
Add:
```typescript
  review_panel_failed: 'text-accent-red',
  review_panel_completed: 'text-accent-green',
```

Remove from summarizeEvent:
```typescript
    case 'review_spec_failed': return `spec review failed (cycle ${payload.reviewCycle})`;
    case 'review_code_failed': return `code review failed (cycle ${payload.reviewCycle})`;
```
Add:
```typescript
    case 'review_panel_failed': {
      const results = payload.results as Array<{ role: string; passed: boolean }> | undefined;
      const failed = results?.filter(r => !r.passed).map(r => r.role).join(', ') ?? 'unknown';
      return `review panel failed: ${failed} (cycle ${payload.reviewCycle})`;
    }
    case 'review_panel_completed': return `review panel passed (cycle ${payload.reviewCycle})`;
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/EventsTimeline.tsx ui/src/components/ActivityFeed.tsx
git commit -m "feat: update event timeline for review panel events"
```

---

## Chunk 5: Docs and Final Verification

### Task 14: Update Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update pipeline flow in CLAUDE.md**

Find the pipeline flow line and replace:

```
Pipeline: backlog → ready → planning → implementing → checks → review_panel → needs_human_review → done
```

Also find and update the Stages list in the Architecture section:

```
- **Stages** (`src/worker/stages/`) — planner, implementer, checks, review-panel, pr-creator
```

- [ ] **Step 2: Update AGENTS.md**

Find any pipeline flow references in AGENTS.md and replace `review_spec → review_code` with `review_panel`. The line at approximately line 51 reads:

```
Pipeline: backlog -> ready -> planning -> implementing -> checks -> review_spec -> review_code -> pr_creation -> needs_human_review -> done
```

Replace with:

```
Pipeline: backlog -> ready -> planning -> implementing -> checks -> review_panel -> pr_creation -> needs_human_review -> done
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: update pipeline flow for review panel"
```

### Task 15: Build and Test Everything

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: Clean build with no TypeScript errors

- [ ] **Step 3: Build the UI**

Run: `npm run build:ui`
Expected: Clean Vite build

- [ ] **Step 4: Fix any remaining compilation errors**

If there are TypeScript errors from missed references to `review_spec` or `review_code`, fix them. Common places to check:
- Any file importing from `./stages/review-spec.js` or `./stages/review-code.js`
- Any string literal `'review_spec'` or `'review_code'` in remaining files

Run: `grep -r "review_spec\|review_code\|reviewSpec\|reviewCode" src/ ui/src/ --include="*.ts" --include="*.tsx" -l`

Fix any files found and commit.

- [ ] **Step 5: Final commit if needed**

```bash
git add -A
git commit -m "fix: resolve remaining review_spec/review_code references"
```
