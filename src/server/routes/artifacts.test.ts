import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDb, createTestApp } from '../../test/helpers.js';
import * as queries from '../../db/queries.js';

let db: Database.Database;
let app: ReturnType<typeof createTestApp>['app'];
let runId: string;

function uniquePath(label = 'project'): string {
  return `/test/${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

beforeEach(() => {
  db = createTestDb();
  ({ app } = createTestApp(db));
  const project = queries.createProject(db, {
    name: 'Artifacts Project',
    path: uniquePath('artifacts-proj'),
    configPath: '/test/.agentboard/config.json',
  });
  const task = queries.createTask(db, { projectId: project.id, title: 'Task For Artifacts' });
  const run = queries.createRun(db, { taskId: task.id, stage: 'planning' });
  runId = run.id;
});

afterEach(() => {
  db.close();
});

describe('GET /api/artifacts', () => {
  it('returns 400 when runId is missing', async () => {
    const res = await request(app).get('/api/artifacts');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/runId/i);
  });

  it('lists artifacts by run', async () => {
    queries.createArtifact(db, {
      runId,
      type: 'plan',
      name: 'plan.md',
      content: '# Plan',
    });
    queries.createArtifact(db, {
      runId,
      type: 'diff',
      name: 'changes.diff',
      content: '+added line',
    });

    const res = await request(app).get(`/api/artifacts?runId=${runId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body[0].runId).toBe(runId);
  });

  it('returns empty array when no artifacts exist for run', async () => {
    const res = await request(app).get(`/api/artifacts?runId=${runId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/artifacts/:id/content', () => {
  it('returns artifact content', async () => {
    const artifact = queries.createArtifact(db, {
      runId,
      type: 'plan',
      name: 'plan.md',
      content: '# My Plan\n\nStep 1: Do the thing',
    });

    const res = await request(app).get(`/api/artifacts/${artifact.id}/content`);
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('# My Plan\n\nStep 1: Do the thing');
  });

  it('returns 404 for unknown artifact id', async () => {
    const res = await request(app).get('/api/artifacts/not-a-real-id/content');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
