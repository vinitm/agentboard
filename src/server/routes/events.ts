import { Router } from 'express';
import type Database from 'better-sqlite3';
import * as queries from '../../db/queries.js';

export function createEventRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/events — list events (query param: taskId)
  router.get('/', (req, res) => {
    const { taskId } = req.query as { taskId?: string };
    if (!taskId) {
      res.status(400).json({ error: 'taskId query param is required' });
      return;
    }
    const events = queries.listEventsByTask(db, taskId);
    res.json(events);
  });

  return router;
}
