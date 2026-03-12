import { Router } from 'express';
import type Database from 'better-sqlite3';
import * as queries from '../../db/queries.js';

export function createProjectRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/projects — list all projects
  router.get('/', (_req, res) => {
    const projects = queries.listProjects(db);
    res.json(projects);
  });

  // POST /api/projects — create project
  router.post('/', (req, res) => {
    const { name, path: projectPath } = req.body as { name?: string; path?: string };
    if (!name || !projectPath) {
      res.status(400).json({ error: 'name and path are required' });
      return;
    }
    const project = queries.createProject(db, {
      name,
      path: projectPath,
      configPath: `${projectPath}/.agentboard/config.json`,
    });
    res.status(201).json(project);
  });

  // GET /api/projects/:id — get project by id
  router.get('/:id', (req, res) => {
    const project = queries.getProjectById(db, req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(project);
  });

  // PUT /api/projects/:id — update project
  router.put('/:id', (req, res) => {
    const existing = queries.getProjectById(db, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { name, path: projectPath, configPath } = req.body as {
      name?: string;
      path?: string;
      configPath?: string;
    };
    const project = queries.updateProject(db, req.params.id, {
      name,
      path: projectPath,
      configPath,
    });
    res.json(project);
  });

  return router;
}
