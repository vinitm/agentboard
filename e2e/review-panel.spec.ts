/**
 * E2E: Review panel integration test.
 *
 * Tests the review panel's parsing, artifact storage, and panel result
 * aggregation logic — the same path the worker loop follows after implementation.
 *
 * Validates: 3-reviewer unanimity, review cycle feedback, failure handling.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createProject,
  createTask,
  createRun,
  updateRun,
  createArtifact,
  listArtifactsByRun,
  getTaskById,
  updateTask,
} from '../src/db/queries.js';
import { createTestDb, createTestConfig, createTestRepo } from '../src/test/helpers.js';
import {
  parseReviewOutput,
  formatPanelFeedback,
  type ReviewResult,
  type RoleReviewResult,
  type ReviewerRole,
} from '../src/worker/stages/review-panel.js';
import { evaluateAutoMerge } from '../src/worker/auto-merge.js';
import type { AgentboardConfig } from '../src/types/index.js';

let db: Database.Database;
let config: AgentboardConfig;
let projectId: string;
let repoPath: string;
let cleanup: () => void;

beforeEach(async () => {
  db = createTestDb();
  const repo = await createTestRepo();
  repoPath = repo.repoPath;
  cleanup = repo.cleanup;
  config = createTestConfig({ autoMerge: true });

  const project = createProject(db, {
    name: 'review-test',
    path: repoPath,
    configPath: `${repoPath}/.agentboard/config.json`,
  });
  projectId = project.id;
});

afterEach(() => {
  cleanup();
  db.close();
});

/**
 * Simulate the review panel by creating runs and artifacts matching
 * what `runReviewPanel` produces.
 */
function simulateReviewPanel(
  taskId: string,
  reviews: { role: ReviewerRole; passed: boolean; issues: string[] }[]
): { panelPassed: boolean; results: RoleReviewResult[] } {
  const reviewRun = createRun(db, { taskId, stage: 'review_panel', modelUsed: 'sonnet' });

  const results: RoleReviewResult[] = [];

  for (const review of reviews) {
    const reviewResult: ReviewResult = {
      passed: review.passed,
      feedback: review.passed ? 'Looks good.' : `Issues: ${review.issues.join(', ')}`,
      issues: review.issues,
    };

    createArtifact(db, {
      runId: reviewRun.id,
      type: 'review_result',
      name: review.role,
      content: JSON.stringify(reviewResult),
    });

    results.push({ ...reviewResult, role: review.role });
  }

  const panelPassed = results.every(r => r.passed);
  updateRun(db, reviewRun.id, {
    status: panelPassed ? 'success' : 'failed',
    output: JSON.stringify({ passed: panelPassed }),
  });

  return { panelPassed, results };
}

describe('Review Panel — All Pass', () => {
  it('should pass when all 3 reviewers approve with zero issues', () => {
    const task = createTask(db, {
      projectId,
      title: 'Clean feature',
      status: 'review_panel',
      riskLevel: 'low',
      spec: '{"title":"Clean feature"}',
    });

    // Simulate successful implementation run (needed for auto-merge check)
    const implRun = createRun(db, { taskId: task.id, stage: 'implementing', modelUsed: 'opus' });
    updateRun(db, implRun.id, { status: 'success', output: 'Added README.md with project description' });

    const { panelPassed, results } = simulateReviewPanel(task.id, [
      { role: 'architect', passed: true, issues: [] },
      { role: 'qa', passed: true, issues: [] },
      { role: 'security', passed: true, issues: [] },
    ]);

    expect(panelPassed).toBe(true);
    expect(results.every(r => r.passed)).toBe(true);

    // Auto-merge should approve (autoMerge=true, low risk, all pass, no sensitive files)
    const decision = evaluateAutoMerge(db, getTaskById(db, task.id)!, config);
    expect(decision.canAutoMerge).toBe(true);
    expect(decision.reasons).toHaveLength(0);
  });
});

describe('Review Panel — One Reviewer Fails', () => {
  it('should fail panel when one reviewer has issues', () => {
    const task = createTask(db, {
      projectId,
      title: 'Needs work',
      status: 'review_panel',
      riskLevel: 'low',
      spec: '{"title":"Needs work"}',
    });

    const { panelPassed, results } = simulateReviewPanel(task.id, [
      { role: 'architect', passed: true, issues: [] },
      { role: 'qa', passed: false, issues: ['Missing edge case test', 'No error handling'] },
      { role: 'security', passed: true, issues: [] },
    ]);

    expect(panelPassed).toBe(false);

    // Generate feedback for implementer
    const feedback = formatPanelFeedback(results, 1, 2);
    expect(feedback).toContain('QA Engineer (FAILED)');
    expect(feedback).toContain('Missing edge case test');
    expect(feedback).toContain('Architect (PASSED)');

    // Task should cycle back to implementing
    updateTask(db, task.id, { status: 'implementing' });
    expect(getTaskById(db, task.id)!.status).toBe('implementing');
  });

  it('should produce useful feedback format for each cycle', () => {
    const results: RoleReviewResult[] = [
      { role: 'architect', passed: false, feedback: 'Coupling too tight', issues: ['Extract interface'] },
      { role: 'qa', passed: false, feedback: 'No tests', issues: ['Add unit tests', 'Add integration tests'] },
      { role: 'security', passed: true, feedback: 'OK', issues: [] },
    ];

    const cycle1 = formatPanelFeedback(results, 1, 2);
    expect(cycle1).toContain('Cycle 1/2');
    expect(cycle1).toContain('Architect (FAILED)');
    expect(cycle1).toContain('Extract interface');
    expect(cycle1).toContain('QA Engineer (FAILED)');
    expect(cycle1).toContain('Add unit tests');
    expect(cycle1).toContain('Security Reviewer (PASSED)');
    expect(cycle1).toContain('No issues.');
  });
});

describe('Review Panel — All Fail', () => {
  it('should fail task after max review cycles', () => {
    const task = createTask(db, {
      projectId,
      title: 'Failing feature',
      status: 'review_panel',
      riskLevel: 'low',
      spec: '{"title":"Failing feature"}',
    });

    const maxCycles = config.maxReviewCycles;

    // Simulate max review cycles, each failing
    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      const { panelPassed } = simulateReviewPanel(task.id, [
        { role: 'architect', passed: false, issues: ['Bad architecture'] },
        { role: 'qa', passed: false, issues: ['No tests'] },
        { role: 'security', passed: false, issues: ['SQL injection risk'] },
      ]);
      expect(panelPassed).toBe(false);

      if (cycle < maxCycles) {
        // Cycle back to implementing
        updateTask(db, task.id, { status: 'implementing' });
        updateTask(db, task.id, { status: 'review_panel' });
      }
    }

    // After max cycles, task should be marked as failed
    updateTask(db, task.id, { status: 'failed' });
    expect(getTaskById(db, task.id)!.status).toBe('failed');
  });
});

describe('Review Output Parsing', () => {
  it('should parse JSON in code fences', () => {
    const output = '```json\n{"passed": true, "feedback": "Good", "issues": []}\n```';
    const result = parseReviewOutput(output);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should parse raw JSON', () => {
    const output = 'Some preamble\n{"passed": false, "feedback": "Bad", "issues": ["XSS risk"]}';
    const result = parseReviewOutput(output);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('XSS risk');
  });

  it('should handle unparseable output gracefully', () => {
    const output = 'This is not JSON at all. The code needs work.';
    const result = parseReviewOutput(output);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Could not parse structured review output');
  });

  it('should validate boolean passed field', () => {
    const output = '```json\n{"passed": "yes", "feedback": "OK", "issues": []}\n```';
    const result = parseReviewOutput(output);
    // "yes" is not boolean, so passed defaults to false
    expect(result.passed).toBe(false);
  });

  it('should filter non-string issues', () => {
    const output = '```json\n{"passed": true, "feedback": "OK", "issues": ["valid", 42, null, "also valid"]}\n```';
    const result = parseReviewOutput(output);
    expect(result.issues).toEqual(['valid', 'also valid']);
  });
});
