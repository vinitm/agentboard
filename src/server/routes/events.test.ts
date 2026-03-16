import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDb, createTestApp } from '../../test/helpers.js';
import * as queries from '../../db/queries.js';

let db: Database.Database;
let app: ReturnType<typeof createTestApp>['app'];
let projectId: string;

function uniquePath(label = 'project'): string {
  return `/test/${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

beforeEach(() => {
  db = createTestDb();
  ({ app } = createTestApp(db));
  const project = queries.createProject(db, {
    name: 'Events Project',
    path: uniquePath('events-proj'),
    configPath: '/test/.agentboard/config.json',
  });
  projectId = project.id;
});

afterEach(() => {
  db.close();
});

describe('GET /api/events', () => {
  it('returns 400 when neither taskId nor projectId is provided', async () => {
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/taskId or projectId/i);
  });

  it('lists events by taskId', async () => {
    const task = queries.createTask(db, { projectId, title: 'Task With Events' });
    queries.createEvent(db, { taskId: task.id, type: 'task:started', payload: '{}' });
    queries.createEvent(db, { taskId: task.id, type: 'task:progress', payload: '{}' });

    const res = await request(app).get(`/api/events?taskId=${task.id}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body[0].taskId).toBe(task.id);
  });

  it('returns empty array when no events exist for task', async () => {
    const task = queries.createTask(db, { projectId, title: 'No Events Task' });

    const res = await request(app).get(`/api/events?taskId=${task.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('lists events by projectId with cursor pagination', async () => {
    const task = queries.createTask(db, { projectId, title: 'Project Events Task' });
    queries.createEvent(db, { taskId: task.id, type: 'event:one', payload: '{}' });
    queries.createEvent(db, { taskId: task.id, type: 'event:two', payload: '{}' });
    queries.createEvent(db, { taskId: task.id, type: 'event:three', payload: '{}' });

    // Fetch all events for the project
    const res = await request(app).get(`/api/events?projectId=${projectId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(3);
    // Each event should have taskTitle joined from the tasks table
    expect(res.body[0].taskTitle).toBe('Project Events Task');
  });

  it('supports limit param with projectId', async () => {
    const task = queries.createTask(db, { projectId, title: 'Limit Test Task' });
    queries.createEvent(db, { taskId: task.id, type: 'event:a', payload: '{}' });
    queries.createEvent(db, { taskId: task.id, type: 'event:b', payload: '{}' });
    queries.createEvent(db, { taskId: task.id, type: 'event:c', payload: '{}' });

    const res = await request(app).get(`/api/events?projectId=${projectId}&limit=2`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('supports cursor param with projectId', async () => {
    const task = queries.createTask(db, { projectId, title: 'Cursor Test Task' });
    queries.createEvent(db, { taskId: task.id, type: 'event:1', payload: '{}' });
    queries.createEvent(db, { taskId: task.id, type: 'event:2', payload: '{}' });
    queries.createEvent(db, { taskId: task.id, type: 'event:3', payload: '{}' });

    // Get all events first to find a cursor id
    const allRes = await request(app).get(`/api/events?projectId=${projectId}`);
    expect(allRes.body.length).toBe(3);

    // Use the last event's id as cursor — should return fewer results
    const lastId = allRes.body[allRes.body.length - 1].id;
    const cursorRes = await request(app).get(`/api/events?projectId=${projectId}&cursor=${lastId}`);
    expect(cursorRes.status).toBe(200);
    // There should be fewer items when using cursor (items with id < lastId)
    expect(cursorRes.body.length).toBeLessThan(3);
  });
});
