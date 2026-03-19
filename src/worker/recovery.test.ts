import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test/helpers.js';
import * as queries from '../db/queries.js';
import { createStageLog, listStageLogsByTask } from '../db/stage-log-queries.js';
import { recoverStaleTasks } from './recovery.js';

function makeStaleTime(): string {
  // 35 minutes ago — past the 30-minute threshold
  return new Date(Date.now() - 35 * 60 * 1000).toISOString();
}

function makeRecentTime(): string {
  // 5 minutes ago — within the 30-minute threshold
  return new Date(Date.now() - 5 * 60 * 1000).toISOString();
}

describe('recoverStaleTasks', () => {
  it('recovers tasks claimed >30 min ago: resets to ready and clears claim', () => {
    const db = createTestDb();
    const project = queries.createProject(db, { name: 'p', path: '/p', configPath: '/p/.agentboard/config.json' });
    const task = queries.createTask(db, { projectId: project.id, title: 'stale', status: 'planning' });

    // Manually set claimed_at to 35 minutes ago
    db.prepare(`UPDATE tasks SET claimed_at = ?, claimed_by = 'worker-1' WHERE id = ?`).run(makeStaleTime(), task.id);

    const count = recoverStaleTasks(db);
    expect(count).toBeGreaterThanOrEqual(1);

    const updated = queries.getTaskById(db, task.id)!;
    expect(updated.status).toBe('ready');
    expect(updated.claimedAt).toBeNull();
    expect(updated.claimedBy).toBeNull();
  });

  it('does NOT recover tasks claimed <30 min ago', () => {
    const db = createTestDb();
    const project = queries.createProject(db, { name: 'p', path: '/p', configPath: '/p/.agentboard/config.json' });
    const task = queries.createTask(db, { projectId: project.id, title: 'fresh', status: 'planning' });

    db.prepare(`UPDATE tasks SET claimed_at = ?, claimed_by = 'worker-1' WHERE id = ?`).run(makeRecentTime(), task.id);

    recoverStaleTasks(db);

    const updated = queries.getTaskById(db, task.id)!;
    expect(updated.status).toBe('planning');
    expect(updated.claimedAt).not.toBeNull();
  });

  it('marks stale stage_logs as failed', () => {
    const db = createTestDb();
    const project = queries.createProject(db, { name: 'p', path: '/p', configPath: '/p/.agentboard/config.json' });
    const task = queries.createTask(db, { projectId: project.id, title: 'stale-log-task', status: 'planning' });

    // Set claimed_at so the task recovery also runs cleanly
    db.prepare(`UPDATE tasks SET claimed_at = ?, claimed_by = 'worker-1' WHERE id = ?`).run(makeStaleTime(), task.id);

    const staleTime = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    createStageLog(db, {
      taskId: task.id,
      projectId: project.id,
      stage: 'planning',
      filePath: 'test.log',
      startedAt: staleTime,
    });

    recoverStaleTasks(db);

    const logs = listStageLogsByTask(db, task.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('failed');
    expect(logs[0].completedAt).not.toBeNull();
  });

});
