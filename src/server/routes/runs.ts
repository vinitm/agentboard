import { Router } from 'express';
import type Database from 'better-sqlite3';
import * as queries from '../../db/queries.js';

// NOTE: Run lifecycle events (run:started, run:updated, run:completed) are
// emitted by the worker process, not by these read-only API routes.
export function createRunRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/runs — list runs (query param: taskId required)
  router.get('/', (req, res) => {
    const { taskId } = req.query as { taskId?: string };
    if (!taskId) {
      res.status(400).json({ error: 'taskId query param is required' });
      return;
    }
    const runs = queries.listRunsByTask(db, taskId);
    res.json(runs);
  });

  // GET /api/runs/:id — get run by id
  router.get('/:id', (req, res) => {
    const run = queries.getRunById(db, req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  });

  return router;
}
