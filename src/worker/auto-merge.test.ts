import { describe, it, expect } from 'vitest';
import { createTestDb, createTestConfig } from '../test/helpers.js';
import { createProject, createTask, createRun, updateRun } from '../db/queries.js';
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

  it('returns false when autoMergeMode is off', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: false, autoMergeMode: 'off' });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toContain('Auto-merge is disabled in config');
  });

  it('returns false for draft-only mode with descriptive reason', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMergeMode: 'draft-only' });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons[0]).toContain('draft-only');
  });

  it('returns false when risk level is not low in low-risk mode', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'medium' });
    const config = createTestConfig({ autoMerge: true, autoMergeMode: 'low-risk' });

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
    const config = createTestConfig({ autoMerge: true, autoMergeMode: 'low-risk' });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("Risk level is 'high'"),
    ]));
  });

  it('returns false when no final review runs exist', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true, autoMergeMode: 'low-risk' });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toContain('No successful final review runs found');
  });

  it('does NOT false-positive on "auth" in log messages', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true, autoMergeMode: 'low-risk' });

    // Create passing final review
    const reviewRun = createRun(db, { taskId: task.id, stage: 'final_review' });
    updateRun(db, reviewRun.id, { status: 'success', finishedAt: new Date().toISOString() });

    // Create implementation run with "auth" in log messages but no sensitive file paths
    const implRun = createRun(db, { taskId: task.id, stage: 'implementing' });
    updateRun(db, implRun.id, {
      status: 'success',
      output: 'Authentication module updated successfully. All auth tests passing.',
      finishedAt: new Date().toISOString(),
    });

    const decision = evaluateAutoMerge(db, task, config);

    // Should NOT block — "auth" in text is not a sensitive file path
    expect(decision.canAutoMerge).toBe(true);
  });

  it('detects .env files in implementation output file paths', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true, autoMergeMode: 'low-risk' });

    const reviewRun = createRun(db, { taskId: task.id, stage: 'final_review' });
    updateRun(db, reviewRun.id, { status: 'success', finishedAt: new Date().toISOString() });

    const implRun = createRun(db, { taskId: task.id, stage: 'implementing' });
    updateRun(db, implRun.id, {
      status: 'success',
      output: 'Modified files:\n  .env.production\n  src/index.ts',
      finishedAt: new Date().toISOString(),
    });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('security-sensitive file'),
    ]));
  });

  it('returns true when all conditions are met', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true, autoMergeMode: 'low-risk' });

    // Create passing final review
    const reviewRun = createRun(db, { taskId: task.id, stage: 'final_review' });
    updateRun(db, reviewRun.id, { status: 'success', finishedAt: new Date().toISOString() });

    // Create clean implementation run
    const implRun = createRun(db, { taskId: task.id, stage: 'implementing' });
    updateRun(db, implRun.id, {
      status: 'success',
      output: 'Modified files: src/utils/helpers.ts src/utils/helpers.test.ts',
      finishedAt: new Date().toISOString(),
    });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it('allows all risk levels when autoMergeMode is all', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'high' });
    const config = createTestConfig({ autoMerge: true, autoMergeMode: 'all' });

    const reviewRun = createRun(db, { taskId: task.id, stage: 'final_review' });
    updateRun(db, reviewRun.id, { status: 'success', finishedAt: new Date().toISOString() });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(true);
  });

  it('returns true when implementation has no output', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true, autoMergeMode: 'low-risk' });

    // Create passing final review
    const reviewRun = createRun(db, { taskId: task.id, stage: 'final_review' });
    updateRun(db, reviewRun.id, { status: 'success', finishedAt: new Date().toISOString() });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it('accumulates multiple failure reasons', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'high' });
    const config = createTestConfig({ autoMerge: true, autoMergeMode: 'low-risk' });

    // No final review runs, high risk => at least 2 reasons
    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
