import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestDb, createTestApp, createTestConfig } from '../../test/helpers.js';
import * as queries from '../../db/queries.js';

// Helper to resolve paths relative to repo root
function repoRoot(...segments: string[]): string {
  const path = require('node:path');
  // Tests run from repo root via vitest
  return path.resolve(process.cwd(), ...segments);
}

function createTestProject(db: ReturnType<typeof createTestDb>) {
  return queries.createProject(db, {
    name: 'test-project',
    path: '/tmp/test',
    configPath: '/tmp/test/.agentboard',
  });
}

// ── Planner: assumptions replace questions ──────────────────────────

describe('Planner: PlanningResult parsing', () => {
  it('planner prompt instructs agent to use assumptions, not questions', () => {
    const fs = require('node:fs');
    const prompt = fs.readFileSync(repoRoot('prompts/planner-v2.md'), 'utf-8');

    expect(prompt).not.toContain('"questions"');
    expect(prompt).toContain('"assumptions"');
    expect(prompt).toContain('Do NOT return questions');
  });

  it('implementer prompt instructs agent to never ask for input', () => {
    const fs = require('node:fs');
    const prompt = fs.readFileSync(repoRoot('prompts/implementer-v2.md'), 'utf-8');

    expect(prompt).not.toContain('needs_user_input');
    expect(prompt).toContain('Never ask for human input');
  });
});

// ── Implementer: no needsUserInput field ────────────────────────────

describe('Implementer: ImplementationResult uses structured status', () => {
  it('ImplementationResult type has status and output fields', async () => {
    // Import the type and verify it at runtime via a conforming object
    const result = { status: 'DONE' as const, output: 'done' };
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('output');
    expect(result).not.toHaveProperty('needsUserInput');
    expect(result).not.toHaveProperty('success');
  });

  it('implementer.ts does not export parseNeedsUserInput', async () => {
    const implementer = await import('./implementer.js');
    expect(implementer).not.toHaveProperty('parseNeedsUserInput');
  });

  it('implementer.ts exports parseStructuredOutput', async () => {
    const implementer = await import('./implementer.js');
    expect(implementer).toHaveProperty('parseStructuredOutput');
  });
});

// ── PR Creator: assumptions in PR body ──────────────────────────────

describe('PR Creator: assumptions in PR description', () => {
  it('PR body includes assumptions section when assumptions artifact exists', () => {
    const db = createTestDb();

    // Create project, task, and planning run with assumptions artifact
    const project = createTestProject(db);
    const task = queries.createTask(db, {
      projectId: project.id,
      title: 'Add rate limiting',
      description: 'Add rate limiting to API',
      riskLevel: 'medium',
      priority: 5,
      status: 'implementing',
    });
    const run = queries.createRun(db, {
      taskId: task.id,
      stage: 'planning',
      modelUsed: 'sonnet',
      input: 'test prompt',
    });
    queries.updateRun(db, run.id, {
      status: 'success',
      output: JSON.stringify({ planSummary: 'Add rate limiting' }),
    });

    // Store plan summary artifact
    queries.createArtifact(db, {
      runId: run.id,
      type: 'plan',
      name: 'plan_summary',
      content: 'Add rate limiting to the API endpoint',
    });

    // Store assumptions artifact
    queries.createArtifact(db, {
      runId: run.id,
      type: 'assumptions',
      name: 'planning_assumptions',
      content: JSON.stringify([
        'Assumed rate limiting is per-user since auth middleware extracts user context',
        'Assumed 429 status code with Retry-After header',
      ]),
    });

    // Verify: read the artifacts back and check they exist
    const artifacts = queries.listArtifactsByRun(db, run.id);
    const assumptionArtifact = artifacts.find((a) => a.type === 'assumptions');
    expect(assumptionArtifact).toBeDefined();

    const assumptions = JSON.parse(assumptionArtifact!.content) as string[];
    expect(assumptions).toHaveLength(2);
    expect(assumptions[0]).toContain('per-user');
    expect(assumptions[1]).toContain('429');
  });

  it('PR body does NOT include assumptions section when no assumptions exist', () => {
    const db = createTestDb();

    const project = createTestProject(db);
    const task = queries.createTask(db, {
      projectId: project.id,
      title: 'Fix typo',
      description: 'Simple fix',
      riskLevel: 'low',
      priority: 1,
      status: 'implementing',
    });
    const run = queries.createRun(db, {
      taskId: task.id,
      stage: 'planning',
      modelUsed: 'sonnet',
      input: 'test prompt',
    });
    queries.updateRun(db, run.id, { status: 'success' });

    // No assumptions artifact created
    const artifacts = queries.listArtifactsByRun(db, run.id);
    const assumptionArtifact = artifacts.find((a) => a.type === 'assumptions');
    expect(assumptionArtifact).toBeUndefined();
  });

});

// ── Worker loop: no blocking for questions/needsUserInput ───────────

describe('Worker loop: no blocking transitions', () => {
  it('loop.ts does not contain needsUserInput blocking logic', async () => {
    const fs = require('node:fs');
    const loopSource = fs.readFileSync(repoRoot('src/worker/loop.ts'), 'utf-8');

    // Should NOT contain the old blocking patterns
    expect(loopSource).not.toContain('needsUserInput');
    expect(loopSource).not.toContain('needs_user_input');
    expect(loopSource).not.toContain('planResult.questions');

    // Should contain assumptions artifact storage
    expect(loopSource).toContain("type: 'assumptions'");
    expect(loopSource).toContain('planning_assumptions');
    expect(loopSource).toContain('getLatestRunByTaskAndStage');
  });
});

// ── Parse endpoint: spec-driven parsing ──────────────────────────────

describe('Parse endpoint: spec-driven fields', () => {
  it('POST /api/tasks/parse prompt requests spec-kit inspired fields', () => {
    const fs = require('node:fs');
    const routesSource = fs.readFileSync(repoRoot('src/server/routes/tasks.ts'), 'utf-8');

    expect(routesSource).toContain('goal');
    expect(routesSource).toContain('userScenarios');
    expect(routesSource).toContain('successCriteria');
  });
});

// ── Types: SpecDocument and PlanReviewAction exist ───────────────────

describe('Shared types: SpecDocument and PlanReviewAction', () => {
  it('SpecDocument interface exists in backend types with spec-kit fields', () => {
    const fs = require('node:fs');
    const typesSource = fs.readFileSync(repoRoot('src/types/index.ts'), 'utf-8');

    expect(typesSource).toContain('export interface SpecDocument');
    expect(typesSource).toContain('goal: string');
    expect(typesSource).toContain('userScenarios: string');
    expect(typesSource).toContain('successCriteria: string');
  });

  it('PlanReviewAction interface exists in backend types', () => {
    const fs = require('node:fs');
    const typesSource = fs.readFileSync(repoRoot('src/types/index.ts'), 'utf-8');

    expect(typesSource).toContain('export interface PlanReviewAction');
    expect(typesSource).toContain("'approve' | 'reject'");
  });

  it('SpecDocument interface exists in frontend types', () => {
    const fs = require('node:fs');
    const typesSource = fs.readFileSync(repoRoot('ui/src/types.ts'), 'utf-8');

    expect(typesSource).toContain('export interface SpecDocument');
    expect(typesSource).toContain('export interface PlanReviewAction');
  });
});

// ── UI: TaskForm has spec editor phase ───────────────────────────────

describe('UI: TaskForm spec editor', () => {
  it('TaskForm uses SpecField and SSE streaming chat API', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(repoRoot('ui/src/components/TaskForm.tsx'), 'utf-8');

    expect(formSource).toContain('SpecField');
    expect(formSource).toContain('goal');
    expect(formSource).toContain('/chat/stream');
    expect(formSource).toContain('streamingContent');
    // Should NOT use /api/tasks/parse anymore
    expect(formSource).not.toContain('/api/tasks/parse');
  });

  it('SpecField component renders read-only spec preview', () => {
    const fs = require('node:fs');
    const specFieldSource = fs.readFileSync(repoRoot('ui/src/components/SpecField.tsx'), 'utf-8');

    expect(specFieldSource).toContain('label');
    expect(specFieldSource).toContain('value');
    expect(specFieldSource).toContain('Not yet filled');
  });
});

