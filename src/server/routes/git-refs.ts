import { Router } from 'express';
import type Database from 'better-sqlite3';
import { getTaskById, listGitRefsByTask } from '../../db/queries.js';

function parseTaskId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error(`Invalid task ID: ${raw}`), { status: 400 });
  }
  return id;
}

export function createGitRefRoutes(db: Database.Database): Router {
  const router = Router({ mergeParams: true });

  // GET /api/tasks/:id/git-refs
  router.get('/', (req, res) => {
    const params = req.params as Record<string, string>;
    let id: number;
    try { id = parseTaskId(params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = getTaskById(db, id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const refs = listGitRefsByTask(db, id);
    res.json(refs);
  });

  return router;
}
