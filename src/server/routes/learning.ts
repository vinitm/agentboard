import { Router } from 'express';
import path from 'node:path';
import type Database from 'better-sqlite3';
import * as queries from '../../db/queries.js';
import { analyzeLearningHistory, loadLearningHistory } from '../../worker/stages/learner.js';

export function createLearningRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/projects/:projectId/learning — get learning analytics for a project
  router.get('/:projectId/learning', (req, res) => {
    const project = queries.getProjectById(db, req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const configDir = path.dirname(project.configPath);
    const analysis = analyzeLearningHistory(configDir);
    res.json(analysis);
  });

  // GET /api/projects/:projectId/learning/history — get raw learning history
  router.get('/:projectId/learning/history', (req, res) => {
    const project = queries.getProjectById(db, req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    const configDir = path.dirname(project.configPath);
    const history = loadLearningHistory(configDir, limit);
    res.json(history);
  });

  return router;
}
