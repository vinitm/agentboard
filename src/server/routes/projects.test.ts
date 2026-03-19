import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDb, createTestApp } from '../../test/helpers.js';

let db: Database.Database;
let app: ReturnType<typeof createTestApp>['app'];

function uniquePath(label = 'project'): string {
  return `/test/${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

beforeEach(() => {
  db = createTestDb();
  ({ app } = createTestApp(db));
});

afterEach(() => {
  db.close();
});

describe('POST /api/projects', () => {
  it('creates a project and returns 201', async () => {
    const path = uniquePath('create');
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'My Project', path });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('My Project');
    expect(res.body.path).toBe(path);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ path: uniquePath() });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('returns 400 when path is missing', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'No Path Project' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('returns 400 when both name and path are missing', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('GET /api/projects', () => {
  it('lists all projects', async () => {
    // Create two projects
    await request(app).post('/api/projects').send({ name: 'P1', path: uniquePath('p1') });
    await request(app).post('/api/projects').send({ name: 'P2', path: uniquePath('p2') });

    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty array when no projects exist', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/projects/:id', () => {
  it('returns a project by id', async () => {
    const createRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Find Me', path: uniquePath('findme') });
    const { id } = createRes.body;

    const res = await request(app).get(`/api/projects/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.name).toBe('Find Me');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/projects/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

describe('PUT /api/projects/:id', () => {
  it('updates a project', async () => {
    const createRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Original', path: uniquePath('update') });
    const { id } = createRes.body;

    const res = await request(app)
      .put(`/api/projects/${id}`)
      .send({ name: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated');
    expect(res.body.id).toBe(id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .put('/api/projects/does-not-exist')
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
