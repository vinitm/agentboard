import { Router } from 'express';
import type Database from 'better-sqlite3';
import * as queries from '../../db/queries.js';

export function createArtifactRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/artifacts — list artifacts (query param: runId required)
  router.get('/', (req, res) => {
    const { runId } = req.query as { runId?: string };
    if (!runId) {
      res.status(400).json({ error: 'runId query param is required' });
      return;
    }
    const artifacts = queries.listArtifactsByRun(db, runId);
    res.json(artifacts);
  });

  // GET /api/artifacts/:id/content — get artifact content
  router.get('/:id/content', (req, res) => {
    const artifact = queries.getArtifactById(db, req.params.id);
    if (!artifact) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }
    res.json({ content: artifact.content });
  });

  return router;
}
