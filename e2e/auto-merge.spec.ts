/**
 * E2E: Auto-merge gate integration test.
 *
 * Tests the auto-merge decision logic with realistic DB state — runs, artifacts,
 * and review results matching what the full pipeline produces.
 *
 * Validates: config toggle, risk levels, reviewer results, security-sensitive file detection.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createProject,
  createTask,
  createRun,
  updateRun,
  createArtifact,
  getTaskById,
} from '../src/db/queries.js';
import { createTestDb, createTestConfig, createTestRepo } from '../src/test/helpers.js';
import { evaluateAutoMerge } from '../src/worker/auto-merge.js';
import type { AgentboardConfig } from '../src/types/index.js';

let db: Database.Database;
let repoPath: string;
let cleanup: () => void;
let projectId: string;

function makeConfig(overrides?: Record<string, unknown>): AgentboardConfig {
  return createTestConfig({ autoMerge: true, ...overrides });
}

/**
 * Create a task with a full implementation + review pipeline in the DB.
 */
function createFullPipelineTask(options: {
  riskLevel?: string;
  reviewResults: { role: string; passed: boolean; issues: string[] }[];
  implOutput?: string;
}) {
  const task = createTask(db, {
    projectId,
    title: 'Test task',
    status: 'review_panel',
    riskLevel: (options.riskLevel ?? 'low') as 'low' | 'medium' | 'high',
    spec: '{"title":"Test"}',
  });

  // Create implementation run
  const implRun = createRun(db, { taskId: task.id, stage: 'implementing', modelUsed: 'opus' });
  updateRun(db, implRun.id, {
    status: 'success',
    output: options.implOutput ?? 'Added helper function to utils.ts',
  });

  // Create review panel run with artifacts
  const reviewRun = createRun(db, { taskId: task.id, stage: 'review_panel', modelUsed: 'sonnet' });
  const allPassed = options.reviewResults.every(r => r.passed);
  updateRun(db, reviewRun.id, {
    status: allPassed ? 'success' : 'failed',
    output: JSON.stringify({ passed: allPassed }),
  });

  for (const review of options.reviewResults) {
    createArtifact(db, {
      runId: reviewRun.id,
      type: 'review_result',
      name: review.role,
      content: JSON.stringify({
        passed: review.passed,
        feedback: review.passed ? 'OK' : 'Issues found',
        issues: review.issues,
      }),
    });
  }

  return getTaskById(db, task.id)!;
}

beforeEach(async () => {
  db = createTestDb();
  const repo = await createTestRepo();
  repoPath = repo.repoPath;
  cleanup = repo.cleanup;

  const project = createProject(db, {
    name: 'merge-test',
    path: repoPath,
    configPath: `${repoPath}/.agentboard/config.json`,
  });
  projectId = project.id;
});

afterEach(() => {
  cleanup();
  db.close();
});

describe('Auto-Merge Gate — Config Toggle', () => {
  it('should reject when autoMerge is disabled', () => {
    const config = makeConfig({ autoMerge: false });
    const task = createFullPipelineTask({
      reviewResults: [
        { role: 'architect', passed: true, issues: [] },
        { role: 'qa', passed: true, issues: [] },
        { role: 'security', passed: true, issues: [] },
      ],
    });

    const decision = evaluateAutoMerge(db, task, config);
    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toContain('Auto-merge is disabled in config');
  });

  it('should approve when autoMerge is enabled and all criteria met', () => {
    const config = makeConfig({ autoMerge: true });
    const task = createFullPipelineTask({
      riskLevel: 'low',
      reviewResults: [
        { role: 'architect', passed: true, issues: [] },
        { role: 'qa', passed: true, issues: [] },
        { role: 'security', passed: true, issues: [] },
      ],
    });

    const decision = evaluateAutoMerge(db, task, config);
    expect(decision.canAutoMerge).toBe(true);
    expect(decision.reasons).toHaveLength(0);
  });
});

describe('Auto-Merge Gate — Risk Level', () => {
  it('should reject medium-risk tasks', () => {
    const config = makeConfig({ autoMerge: true });
    const task = createFullPipelineTask({
      riskLevel: 'medium',
      reviewResults: [
        { role: 'architect', passed: true, issues: [] },
        { role: 'qa', passed: true, issues: [] },
        { role: 'security', passed: true, issues: [] },
      ],
    });

    const decision = evaluateAutoMerge(db, task, config);
    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons.some(r => r.includes('medium'))).toBe(true);
  });

  it('should reject high-risk tasks', () => {
    const config = makeConfig({ autoMerge: true });
    const task = createFullPipelineTask({
      riskLevel: 'high',
      reviewResults: [
        { role: 'architect', passed: true, issues: [] },
        { role: 'qa', passed: true, issues: [] },
        { role: 'security', passed: true, issues: [] },
      ],
    });

    const decision = evaluateAutoMerge(db, task, config);
    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons.some(r => r.includes('high'))).toBe(true);
  });
});

describe('Auto-Merge Gate — Review Results', () => {
  it('should reject when a reviewer fails', () => {
    const config = makeConfig({ autoMerge: true });
    const task = createFullPipelineTask({
      riskLevel: 'low',
      reviewResults: [
        { role: 'architect', passed: true, issues: [] },
        { role: 'qa', passed: false, issues: ['Missing test coverage'] },
        { role: 'security', passed: true, issues: [] },
      ],
    });

    const decision = evaluateAutoMerge(db, task, config);
    expect(decision.canAutoMerge).toBe(false);
    // The review run status is 'failed' (not all passed), so evaluateAutoMerge
    // won't find a successful review_panel run — it rejects with "No successful review"
    expect(decision.reasons.some(r => r.includes('No successful review'))).toBe(true);
  });

  it('should reject when issues exist even if all pass', () => {
    const config = makeConfig({ autoMerge: true });
    const task = createFullPipelineTask({
      riskLevel: 'low',
      reviewResults: [
        { role: 'architect', passed: true, issues: ['Minor coupling concern'] },
        { role: 'qa', passed: true, issues: [] },
        { role: 'security', passed: true, issues: [] },
      ],
    });

    const decision = evaluateAutoMerge(db, task, config);
    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons.some(r => r.includes('issue'))).toBe(true);
  });

  it('should reject when no review runs exist', () => {
    const config = makeConfig({ autoMerge: true });
    const task = createTask(db, {
      projectId,
      title: 'No reviews',
      status: 'review_panel',
      riskLevel: 'low',
      spec: '{}',
    });

    const decision = evaluateAutoMerge(db, getTaskById(db, task.id)!, config);
    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons.some(r => r.includes('No successful review'))).toBe(true);
  });
});

describe('Auto-Merge Gate — Security-Sensitive Files', () => {
  it('should reject when implementation touches .env files', () => {
    const config = makeConfig({ autoMerge: true });
    const task = createFullPipelineTask({
      riskLevel: 'low',
      implOutput: 'Updated .env.production with new API key',
      reviewResults: [
        { role: 'architect', passed: true, issues: [] },
        { role: 'qa', passed: true, issues: [] },
        { role: 'security', passed: true, issues: [] },
      ],
    });

    const decision = evaluateAutoMerge(db, task, config);
    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons.some(r => r.includes('security-sensitive'))).toBe(true);
  });

  it('should reject when implementation touches auth files', () => {
    const config = makeConfig({ autoMerge: true });
    const task = createFullPipelineTask({
      riskLevel: 'low',
      implOutput: 'Modified auth middleware to use JWT tokens',
      reviewResults: [
        { role: 'architect', passed: true, issues: [] },
        { role: 'qa', passed: true, issues: [] },
        { role: 'security', passed: true, issues: [] },
      ],
    });

    const decision = evaluateAutoMerge(db, task, config);
    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons.some(r => r.includes('security-sensitive'))).toBe(true);
  });

  it('should approve when implementation touches non-sensitive files', () => {
    const config = makeConfig({ autoMerge: true });
    const task = createFullPipelineTask({
      riskLevel: 'low',
      implOutput: 'Added formatDate utility function to utils.ts',
      reviewResults: [
        { role: 'architect', passed: true, issues: [] },
        { role: 'qa', passed: true, issues: [] },
        { role: 'security', passed: true, issues: [] },
      ],
    });

    const decision = evaluateAutoMerge(db, task, config);
    expect(decision.canAutoMerge).toBe(true);
  });
});

describe('Auto-Merge Gate — Multiple Rejection Reasons', () => {
  it('should accumulate all rejection reasons', () => {
    const config = makeConfig({ autoMerge: true });
    const task = createFullPipelineTask({
      riskLevel: 'high',
      implOutput: 'Modified auth/password.ts with new secret handling',
      reviewResults: [
        { role: 'architect', passed: false, issues: ['Bad pattern'] },
        { role: 'qa', passed: false, issues: ['No tests'] },
        { role: 'security', passed: false, issues: ['Hardcoded secret'] },
      ],
    });

    const decision = evaluateAutoMerge(db, task, config);
    expect(decision.canAutoMerge).toBe(false);
    // Should have: risk level + 3 reviewers failed + issues count + sensitive content
    expect(decision.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
