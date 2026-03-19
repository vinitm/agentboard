import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { Server } from 'socket.io';
import { createTestDb } from '../test/helpers.js';
import { createProject, createTask } from '../db/queries.js';
import { listStageLogsByTask } from '../db/stage-log-queries.js';
import { createStageRunner } from './stage-runner.js';

describe('StageRunner', () => {
  let db: Database.Database;
  let io: Server;
  let projectId: string;
  let taskId: number;
  let logsDir: string;

  beforeEach(() => {
    db = createTestDb();
    io = { emit: vi.fn() } as unknown as Server;
    const project = createProject(db, { name: 'test', path: '/tmp/test', configPath: '/tmp/test/.agentboard/config.json' });
    projectId = project.id;
    const task = createTask(db, { projectId, title: 'test', description: '' });
    taskId = task.id;
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-runner-test-'));
  });

  afterEach(() => {
    fs.rmSync(logsDir, { recursive: true, force: true });
  });

  it('creates stage_logs row, file, and emits events', async () => {
    const runner = createStageRunner({ taskId, projectId, io, db, logsDir, projectRoot: logsDir });

    await runner.execute('planning', (onOutput) => {
      onOutput('chunk 1');
      onOutput('chunk 2');
      return Promise.resolve({ plan: '3 subtasks', tokens: 1000 });
    }, {
      summarize: (r) => ({ summary: 'Found ' + r.plan, tokensUsed: r.tokens }),
    });

    const logs = listStageLogsByTask(db, taskId);
    expect(logs).toHaveLength(1);
    expect(logs[0].stage).toBe('planning');
    expect(logs[0].status).toBe('completed');
    expect(logs[0].summary).toBe('Found 3 subtasks');

    const filePath = path.join(logsDir, String(taskId), 'planning.log');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('chunk 1');
    expect(content).toContain('chunk 2');

    expect(io.emit).toHaveBeenCalledWith('stage:transition', expect.objectContaining({ stage: 'planning', status: 'running' }));
    expect(io.emit).toHaveBeenCalledWith('stage:transition', expect.objectContaining({ stage: 'planning', status: 'completed' }));
    expect(io.emit).toHaveBeenCalledWith('run:log', expect.objectContaining({ stage: 'planning', chunk: 'chunk 1' }));
  });

  it('marks stage as failed when function throws', async () => {
    const runner = createStageRunner({ taskId, projectId, io, db, logsDir, projectRoot: logsDir });

    await expect(
      runner.execute('implementing', () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    const logs = listStageLogsByTask(db, taskId);
    expect(logs[0].status).toBe('failed');
  });

  it('handles retry attempts with suffixed filenames', async () => {
    const runner = createStageRunner({ taskId, projectId, io, db, logsDir, projectRoot: logsDir });

    await runner.execute('planning', (onOutput) => {
      onOutput('attempt 1');
      return Promise.resolve({ attempt: 1 });
    });

    await runner.execute('planning', (onOutput) => {
      onOutput('attempt 2');
      return Promise.resolve({ attempt: 2 });
    }, { attempt: 2 });

    const logs = listStageLogsByTask(db, taskId);
    expect(logs).toHaveLength(2);
    expect(logs[1].attempt).toBe(2);

    const retryFile = path.join(logsDir, String(taskId), 'planning-2.log');
    expect(fs.existsSync(retryFile)).toBe(true);
  });

  it('works without summarize option', async () => {
    const runner = createStageRunner({ taskId, projectId, io, db, logsDir, projectRoot: logsDir });

    await runner.execute('checks', () => Promise.resolve({ passed: true }));

    const logs = listStageLogsByTask(db, taskId);
    expect(logs[0].status).toBe('completed');
    expect(logs[0].summary).toBeNull();
  });
});
