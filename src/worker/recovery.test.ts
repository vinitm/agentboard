import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test/helpers.js';
import * as queries from '../db/queries.js';
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

  it('recovers stalled subtask chains: promotes first backlog child when no active child exists', () => {
    const db = createTestDb();
    const project = queries.createProject(db, { name: 'p', path: '/p', configPath: '/p/.agentboard/config.json' });

    // Parent is 'implementing' — simulates a subtask chain
    const parent = queries.createTask(db, {
      projectId: project.id,
      title: 'parent',
      status: 'implementing',
    });

    // All children are 'backlog' (stalled chain — no active child)
    const child1 = queries.createTask(db, {
      projectId: project.id,
      title: 'child1',
      status: 'backlog',
      parentTaskId: parent.id,
    });
    queries.createTask(db, {
      projectId: project.id,
      title: 'child2',
      status: 'backlog',
      parentTaskId: parent.id,
    });

    const count = recoverStaleTasks(db);
    expect(count).toBeGreaterThanOrEqual(1);

    // First backlog child should be promoted to ready
    const updatedChild1 = queries.getTaskById(db, child1.id)!;
    expect(updatedChild1.status).toBe('ready');
  });

  it('does NOT promote when an active child exists', () => {
    const db = createTestDb();
    const project = queries.createProject(db, { name: 'p', path: '/p', configPath: '/p/.agentboard/config.json' });

    const parent = queries.createTask(db, {
      projectId: project.id,
      title: 'parent',
      status: 'implementing',
    });

    // One child is 'ready' (active), another is 'backlog'
    queries.createTask(db, {
      projectId: project.id,
      title: 'child-active',
      status: 'ready',
      parentTaskId: parent.id,
    });
    const backlogChild = queries.createTask(db, {
      projectId: project.id,
      title: 'child-backlog',
      status: 'backlog',
      parentTaskId: parent.id,
    });

    recoverStaleTasks(db);

    // Backlog child should remain backlog
    const updated = queries.getTaskById(db, backlogChild.id)!;
    expect(updated.status).toBe('backlog');
  });
});
