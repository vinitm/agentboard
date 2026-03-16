import fs from 'node:fs';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { getTaskLogByTaskId, listTaskLogsByProject } from '../../db/queries.js';

export function createLogRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/logs?taskId=X — get log file content for a task
  router.get('/', (req, res) => {
    const { taskId, projectId } = req.query as { taskId?: string; projectId?: string };

    if (taskId) {
      const taskLog = getTaskLogByTaskId(db, taskId);
      if (!taskLog) {
        res.status(404).json({ error: 'No log found for this task' });
        return;
      }

      if (!fs.existsSync(taskLog.logPath)) {
        res.status(404).json({ error: 'Log file not found on disk' });
        return;
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const stream = fs.createReadStream(taskLog.logPath, 'utf-8');
      stream.pipe(res);
      return;
    }

    if (projectId) {
      const logs = listTaskLogsByProject(db, projectId);
      res.json(logs);
      return;
    }

    res.status(400).json({ error: 'taskId or projectId query param is required' });
  });

  // GET /api/logs/:taskId/metadata — get log metadata for a task
  router.get('/:taskId/metadata', (req, res) => {
    const taskLog = getTaskLogByTaskId(db, req.params.taskId);
    if (!taskLog) {
      res.status(404).json({ error: 'No log found for this task' });
      return;
    }
    res.json(taskLog);
  });

  // GET /api/logs/:taskId/download — download the log file
  router.get('/:taskId/download', (req, res) => {
    const taskLog = getTaskLogByTaskId(db, req.params.taskId);
    if (!taskLog) {
      res.status(404).json({ error: 'No log found for this task' });
      return;
    }

    if (!fs.existsSync(taskLog.logPath)) {
      res.status(404).json({ error: 'Log file not found on disk' });
      return;
    }

    res.setHeader('Content-Disposition', `attachment; filename="${req.params.taskId}.log"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const stream = fs.createReadStream(taskLog.logPath, 'utf-8');
    stream.pipe(res);
  });

  return router;
}
