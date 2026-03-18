import { Router } from 'express';
import type Database from 'better-sqlite3';
import * as queries from '../../db/queries.js';

function parseTaskId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error(`Invalid task ID: ${raw}`), { status: 400 });
  }
  return id;
}

export function createEventRoutes(db: Database.Database): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const { taskId: rawTaskId, projectId, limit, cursor } = req.query as {
      taskId?: string;
      projectId?: string;
      limit?: string;
      cursor?: string;
    };

    if (projectId) {
      const events = queries.listEventsByProject(
        db,
        projectId,
        limit ? parseInt(limit, 10) : 50,
        cursor || undefined
      );
      res.json(events);
      return;
    }

    if (!rawTaskId) {
      res.status(400).json({ error: 'taskId or projectId query param is required' });
      return;
    }

    let taskId: number;
    try { taskId = parseTaskId(rawTaskId); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const events = queries.listEventsByTask(db, taskId);
    res.json(events);
  });

  return router;
}
