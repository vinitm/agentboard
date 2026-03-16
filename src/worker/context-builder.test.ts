import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test/helpers.js';
import * as queries from '../db/queries.js';
import { buildTaskPacket } from './context-builder.js';

function setupProject(db: ReturnType<typeof createTestDb>) {
  return queries.createProject(db, {
    name: 'test-project',
    path: '/repo',
    configPath: '/repo/.agentboard/config.json',
  });
}

describe('buildTaskPacket', () => {
  it('includes task title and description', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = queries.createTask(db, {
      projectId: project.id,
      title: 'My Task',
      description: 'Do something important',
    });

    const packet = buildTaskPacket(db, task);
    expect(packet).toContain('My Task');
    expect(packet).toContain('Do something important');
  });

  it('includes spec when present', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = queries.createTask(db, {
      projectId: project.id,
      title: 'Task with spec',
      description: 'desc',
      spec: 'This is the spec content',
    });

    const packet = buildTaskPacket(db, task);
    expect(packet).toContain('This is the spec content');
  });

  it('includes file hints from planning run (JSON parsed)', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = queries.createTask(db, {
      projectId: project.id,
      title: 'Hinted Task',
      description: 'needs hints',
    });

    const run = queries.createRun(db, { taskId: task.id, stage: 'planning' });
    queries.updateRun(db, run.id, {
      status: 'success',
      output: JSON.stringify({ fileHints: ['src/foo.ts', 'src/bar.ts'] }),
    });

    const packet = buildTaskPacket(db, task);
    expect(packet).toContain('src/foo.ts');
    expect(packet).toContain('src/bar.ts');
  });

  it('includes failure summary from previous failed run', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = queries.createTask(db, {
      projectId: project.id,
      title: 'Failed Task',
      description: 'tried before',
    });

    const run = queries.createRun(db, { taskId: task.id, stage: 'implementing' });
    queries.updateRun(db, run.id, {
      status: 'failed',
      output: 'Error: TypeScript type mismatch on line 42',
    });

    const packet = buildTaskPacket(db, task);
    expect(packet).toContain('Previous Failure');
    expect(packet).toContain('TypeScript type mismatch');
  });

  it('excludes failure summary when includeFailures is false', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = queries.createTask(db, {
      projectId: project.id,
      title: 'Failed Task',
      description: 'tried before',
    });

    const run = queries.createRun(db, { taskId: task.id, stage: 'implementing' });
    queries.updateRun(db, run.id, {
      status: 'failed',
      output: 'Error: something broke',
    });

    const packet = buildTaskPacket(db, task, { includeFailures: false });
    expect(packet).not.toContain('Previous Failure');
    expect(packet).not.toContain('something broke');
  });

  it('includes user answers from events', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = queries.createTask(db, {
      projectId: project.id,
      title: 'Task with Q&A',
      description: 'has answers',
    });

    queries.createEvent(db, {
      taskId: task.id,
      type: 'answer_provided',
      payload: JSON.stringify({ question: 'What framework?', answer: 'React' }),
    });

    const packet = buildTaskPacket(db, task);
    expect(packet).toContain('What framework?');
    expect(packet).toContain('React');
  });

  it('handles missing planning artifacts gracefully', () => {
    const db = createTestDb();
    const project = setupProject(db);
    const task = queries.createTask(db, {
      projectId: project.id,
      title: 'No Plan',
      description: 'no planning run',
    });

    // No planning run exists
    expect(() => buildTaskPacket(db, task)).not.toThrow();
    const packet = buildTaskPacket(db, task);
    expect(packet).toContain('No Plan');
  });
});
