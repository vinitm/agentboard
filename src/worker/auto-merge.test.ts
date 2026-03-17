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

  it('returns false when no final review runs exist', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true });

    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons).toContain('No successful final review runs found');
  });

  it('returns false when implementation touches sensitive files', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = createTask(db, { projectId: project.id, title: 'Test task', riskLevel: 'low' });
    const config = createTestConfig({ autoMerge: true });

    // Create passing final review
    const reviewRun = createRun(db, { taskId: task.id, stage: 'final_review' });
    updateRun(db, reviewRun.id, { status: 'success', finishedAt: new Date().toISOString() });

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

    // Create passing final review
    const reviewRun = createRun(db, { taskId: task.id, stage: 'final_review' });
    updateRun(db, reviewRun.id, { status: 'success', finishedAt: new Date().toISOString() });

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
    const config = createTestConfig({ autoMerge: true });

    // No final review runs, high risk => at least 2 reasons
    const decision = evaluateAutoMerge(db, task, config);

    expect(decision.canAutoMerge).toBe(false);
    expect(decision.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
