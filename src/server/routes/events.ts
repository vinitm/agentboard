import { Router } from 'express';
import type Database from 'better-sqlite3';
import * as queries from '../../db/queries.js';

export function createEventRoutes(db: Database.Database): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const { taskId, projectId, limit, cursor } = req.query as {
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

    if (!taskId) {
      res.status(400).json({ error: 'taskId or projectId query param is required' });
      return;
    }

    const events = queries.listEventsByTask(db, taskId);
    res.json(events);
  });

  return router;
}
