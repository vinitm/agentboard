import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDb, createTestApp } from '../../test/helpers.js';
import * as queries from '../../db/queries.js';

let db: Database.Database;
let app: ReturnType<typeof createTestApp>['app'];
let projectId: string;
let taskId: number;

function uniquePath(label = 'project'): string {
  return `/test/${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

beforeEach(() => {
  db = createTestDb();
  ({ app } = createTestApp(db));
  const project = queries.createProject(db, {
    name: 'Runs Project',
    path: uniquePath('runs-proj'),
    configPath: '/test/.agentboard/config.json',
  });
  projectId = project.id;
  const task = queries.createTask(db, { projectId, title: 'Task For Runs' });
  taskId = task.id;
});

afterEach(() => {
  db.close();
});

describe('GET /api/runs', () => {
  it('returns 400 when taskId is missing', async () => {
    const res = await request(app).get('/api/runs');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/taskId/i);
  });

  it('lists runs by task', async () => {
    queries.createRun(db, { taskId, stage: 'planning' });
    queries.createRun(db, { taskId, stage: 'implementing' });

    const res = await request(app).get(`/api/runs?taskId=${taskId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body[0].taskId).toBe(taskId);
  });

  it('returns empty array when no runs exist for task', async () => {
    const res = await request(app).get(`/api/runs?taskId=${taskId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/runs/:id', () => {
  it('returns a run by id', async () => {
    const run = queries.createRun(db, { taskId, stage: 'planning' });

    const res = await request(app).get(`/api/runs/${run.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(run.id);
    expect(res.body.stage).toBe('planning');
    expect(res.body.taskId).toBe(taskId);
  });

  it('returns 404 for unknown run id', async () => {
    const res = await request(app).get('/api/runs/not-a-real-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
