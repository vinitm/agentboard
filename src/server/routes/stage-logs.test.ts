import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb, createTestApp } from '../../test/helpers.js';
import { createProject, createTask } from '../../db/queries.js';
import { createStageLog } from '../../db/stage-log-queries.js';

describe('GET /api/tasks/:id/stages', () => {
  it('returns empty stages for a task with no stage logs', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const project = createProject(db, { name: 'proj', path: '/tmp/proj', configPath: '' });
    const task = createTask(db, { projectId: project.id, title: 'T1' });

    const res = await request(app).get(`/api/tasks/${task.id}/stages`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stages: [] });
  });

  it('returns 400 for non-numeric task id', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const res = await request(app).get('/api/tasks/nonexistent/stages');
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent task', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const res = await request(app).get('/api/tasks/99999/stages');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Task not found');
  });

  it('returns ordered stages and strips filePath, projectId, createdAt', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const project = createProject(db, { name: 'proj', path: '/tmp/proj', configPath: '' });
    const task = createTask(db, { projectId: project.id, title: 'T1' });

    const log1 = createStageLog(db, {
      taskId: task.id,
      projectId: project.id,
      stage: 'planning',
      filePath: '.agentboard/logs/stage-planning.log',
      startedAt: new Date(Date.now() - 1000).toISOString(),
    });
    const log2 = createStageLog(db, {
      taskId: task.id,
      projectId: project.id,
      stage: 'implementing',
      filePath: '.agentboard/logs/stage-implementing.log',
      startedAt: new Date().toISOString(),
    });

    const res = await request(app).get(`/api/tasks/${task.id}/stages`);
    expect(res.status).toBe(200);

    const { stages } = res.body as { stages: Record<string, unknown>[] };
    expect(stages).toHaveLength(2);

    // Ordered by started_at ASC
    expect(stages[0].id).toBe(log1.id);
    expect(stages[1].id).toBe(log2.id);

    // Strips internal fields
    for (const stage of stages) {
      expect(stage).not.toHaveProperty('filePath');
      expect(stage).not.toHaveProperty('projectId');
      expect(stage).not.toHaveProperty('createdAt');
    }

    // Exposes expected fields
    expect(stages[0]).toHaveProperty('stage', 'planning');
    expect(stages[0]).toHaveProperty('status', 'running');
    expect(stages[0]).toHaveProperty('taskId', task.id);
  });
});

describe('GET /api/tasks/:id/stages/:stageLogId/logs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-stage-log-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 400 when task id is non-numeric', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const res = await request(app).get('/api/tasks/nonexistent/stages/someid/logs');
    expect(res.status).toBe(400);
  });

  it('returns 404 when task does not exist', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const res = await request(app).get('/api/tasks/99999/stages/someid/logs');
    expect(res.status).toBe(404);
  });

  it('returns 404 when stage log does not exist', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const project = createProject(db, { name: 'proj', path: tmpDir, configPath: '' });
    const task = createTask(db, { projectId: project.id, title: 'T1' });

    const res = await request(app).get(`/api/tasks/${task.id}/stages/nonexistent/logs`);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Stage log not found');
  });

  it('returns 404 when stage log belongs to a different task', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const project = createProject(db, { name: 'proj', path: tmpDir, configPath: '' });
    const task1 = createTask(db, { projectId: project.id, title: 'T1' });
    const task2 = createTask(db, { projectId: project.id, title: 'T2' });

    const logFile = path.join(tmpDir, 'stage.log');
    fs.writeFileSync(logFile, 'hello');

    const stageLog = createStageLog(db, {
      taskId: task2.id,
      projectId: project.id,
      stage: 'planning',
      filePath: 'stage.log',
      startedAt: new Date().toISOString(),
    });

    const res = await request(app).get(`/api/tasks/${task1.id}/stages/${stageLog.id}/logs`);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Stage log not found');
  });

  it('returns 404 when log file does not exist on disk', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const project = createProject(db, { name: 'proj', path: tmpDir, configPath: '' });
    const task = createTask(db, { projectId: project.id, title: 'T1' });

    const stageLog = createStageLog(db, {
      taskId: task.id,
      projectId: project.id,
      stage: 'planning',
      filePath: 'missing-file.log',
      startedAt: new Date().toISOString(),
    });

    const res = await request(app).get(`/api/tasks/${task.id}/stages/${stageLog.id}/logs`);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Log file not found');
  });

  it('returns full file content with 200', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const project = createProject(db, { name: 'proj', path: tmpDir, configPath: '' });
    const task = createTask(db, { projectId: project.id, title: 'T1' });

    const logContent = 'line1\nline2\nline3\n';
    const logFile = 'stage-planning.log';
    fs.writeFileSync(path.join(tmpDir, logFile), logContent);

    const stageLog = createStageLog(db, {
      taskId: task.id,
      projectId: project.id,
      stage: 'planning',
      filePath: logFile,
      startedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get(`/api/tasks/${task.id}/stages/${stageLog.id}/logs`)
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.body).toBe(logContent);
  });

  it('returns partial content with 206 for byte range request', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const project = createProject(db, { name: 'proj', path: tmpDir, configPath: '' });
    const task = createTask(db, { projectId: project.id, title: 'T1' });

    const logContent = 'Hello, World!';
    const logFile = 'stage.log';
    fs.writeFileSync(path.join(tmpDir, logFile), logContent);

    const stageLog = createStageLog(db, {
      taskId: task.id,
      projectId: project.id,
      stage: 'implementing',
      filePath: logFile,
      startedAt: new Date().toISOString(),
    });

    // Request bytes 0-4 → "Hello"
    const res = await request(app)
      .get(`/api/tasks/${task.id}/stages/${stageLog.id}/logs`)
      .set('Range', 'bytes=0-4')
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    expect(res.status).toBe(206);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-range']).toBe(`bytes 0-4/${logContent.length}`);
    expect(res.headers['content-length']).toBe('5');
    expect(res.body).toBe('Hello');
  });

  it('returns 416 for out-of-range byte request', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const project = createProject(db, { name: 'proj', path: tmpDir, configPath: '' });
    const task = createTask(db, { projectId: project.id, title: 'T1' });

    const logContent = 'Hi';
    const logFile = 'stage.log';
    fs.writeFileSync(path.join(tmpDir, logFile), logContent);

    const stageLog = createStageLog(db, {
      taskId: task.id,
      projectId: project.id,
      stage: 'checks',
      filePath: logFile,
      startedAt: new Date().toISOString(),
    });

    // Request beyond file size
    const res = await request(app)
      .get(`/api/tasks/${task.id}/stages/${stageLog.id}/logs`)
      .set('Range', 'bytes=100-200');

    expect(res.status).toBe(416);
  });

  it('returns 416 for invalid range header', async () => {
    const db = createTestDb();
    const { app } = createTestApp(db);

    const project = createProject(db, { name: 'proj', path: tmpDir, configPath: '' });
    const task = createTask(db, { projectId: project.id, title: 'T1' });

    const logFile = 'stage.log';
    fs.writeFileSync(path.join(tmpDir, logFile), 'data');

    const stageLog = createStageLog(db, {
      taskId: task.id,
      projectId: project.id,
      stage: 'checks',
      filePath: logFile,
      startedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get(`/api/tasks/${task.id}/stages/${stageLog.id}/logs`)
      .set('Range', 'invalid-range');

    expect(res.status).toBe(416);
  });
});
