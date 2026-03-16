import { describe, it, expect } from 'vitest';
import { createTestDb, createTestConfig } from '../test/helpers.js';
import { createProject, createTask, createRun, updateRun, createArtifact } from '../db/queries.js';
import { evaluateAutoMerge } from './auto-merge.js';

function setupProject(db: ReturnType<typeof createTestDb>) {
  return createProject(db, { name: 'test', path: '/tmp/test', configPath: '/tmp/test/.agentboard' });
}

describe('evaluateAutoMerge', () => {
  it('returns false when autoMerge is disabled in config', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: false });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toContain('Auto-merge is disabled in config');
  });

  it('returns false when risk level is not low', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'medium' });
    const config = createTestConfig({ autoMerge: true });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("Risk level is 'medium'"),
    ]));
  });

  it('returns false when risk level is high', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'high' });
    const config = createTestConfig({ autoMerge: true });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("Risk level is 'high'"),
    ]));
  });

  it('returns false when no review panel runs exist', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toContain('No successful review panel runs found');
  });

  it('returns false when a reviewer did not pass', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true });

    // Create a successful review_panel run with a failing reviewer
    const run = createRun(db, { taskId: task.id, stage: 'review_panel' });
    updateRun(db, run.id, { status: 'success', finishedAt: new Date().toISOString() });
    createArtifact(db, {
      runId: run.id,
      type: 'review_result',
      name: 'code-quality',
      content: JSON.stringify({ passed: false, issues: ['Missing error handling'] }),
    });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("Reviewer 'code-quality' did not pass"),
    ]));
  });

  it('returns false when review has issues even if passed', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true });

    const run = createRun(db, { taskId: task.id, stage: 'review_panel' });
    updateRun(db, run.id, { status: 'success', finishedAt: new Date().toISOString() });
    createArtifact(db, {
      runId: run.id,
      type: 'review_result',
      name: 'code-quality',
      content: JSON.stringify({ passed: true, issues: ['Minor style nit'] }),
    });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('1 issue(s)'),
    ]));
  });

  it('returns false when implementation touches sensitive files', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true });

    // Create passing review
    const reviewRun = createRun(db, { taskId: task.id, stage: 'review_panel' });
    updateRun(db, reviewRun.id, { status: 'success', finishedAt: new Date().toISOString() });
    createArtifact(db, {
      runId: reviewRun.id,
      type: 'review_result',
      name: 'code-quality',
      content: JSON.stringify({ passed: true, issues: [] }),
    });

    // Create implementation run that touched .env
    const implRun = createRun(db, { taskId: task.id, stage: 'implementing' });
    updateRun(db, implRun.id, {
      status: 'success',
      output: 'Modified files: .env.production, src/index.ts',
      finishedAt: new Date().toISOString(),
    });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('security-sensitive content'),
    ]));
  });

  it('returns true when all conditions are met', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true });

    // Create passing review with zero issues
    const reviewRun = createRun(db, { taskId: task.id, stage: 'review_panel' });
    updateRun(db, reviewRun.id, { status: 'success', finishedAt: new Date().toISOString() });
    createArtifact(db, {
      runId: reviewRun.id,
      type: 'review_result',
      name: 'code-quality',
      content: JSON.stringify({ passed: true, issues: [] }),
    });
    createArtifact(db, {
      runId: reviewRun.id,
      type: 'review_result',
      name: 'security',
      content: JSON.stringify({ passed: true, issues: [] }),
    });

    // Create clean implementation run
    const implRun = createRun(db, { taskId: task.id, stage: 'implementing' });
    updateRun(db, implRun.id, {
      status: 'success',
      output: 'Modified files: src/utils/helpers.ts, src/utils/helpers.test.ts',
      finishedAt: new Date().toISOString(),
    });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it('returns true when implementation has no output', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true });

    // Create passing review
    const reviewRun = createRun(db, { taskId: task.id, stage: 'review_panel' });
    updateRun(db, reviewRun.id, { status: 'success', finishedAt: new Date().toISOString() });
    createArtifact(db, {
      runId: reviewRun.id,
      type: 'review_result',
      name: 'code-quality',
      content: JSON.stringify({ passed: true, issues: [] }),
    });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it('accumulates multiple failure reasons', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'high' });
    const config = createTestConfig({ autoMerge: true });

    // No review runs, high risk => at least 2 reasons
    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('handles unparseable review artifact content gracefully', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true });

    const reviewRun = createRun(db, { taskId: task.id, stage: 'review_panel' });
    updateRun(db, reviewRun.id, { status: 'success', finishedAt: new Date().toISOString() });
    createArtifact(db, {
      runId: reviewRun.id,
      type: 'review_result',
      name: 'broken-reviewer',
      content: 'not valid json',
    });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("Could not parse review result for 'broken-reviewer'"),
    ]));
  });
});
