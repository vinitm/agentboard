import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { StageLog } from '../../types/index.js';
import { getStageLogById, listStageLogsByTask, listStageLogsBySubtask } from '../../db/stage-log-queries.js';
import { getTaskById, getProjectById } from '../../db/queries.js';

/** Strip server-internal fields before sending to client. */
function toClientStageLog(log: StageLog): Omit<StageLog, 'filePath' | 'projectId' | 'createdAt'> {
  const { filePath, projectId, createdAt, ...clientLog } = log;
  return clientLog;
}

function parseTaskId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error(`Invalid task ID: ${raw}`), { status: 400 });
  }
  return id;
}

export function createStageLogRoutes(db: Database.Database): Router {
  const router = Router({ mergeParams: true });

  // GET /api/tasks/:id/stages
  router.get('/', (req, res) => {
    const params = req.params as Record<string, string>;
    let id: number;
    try { id = parseTaskId(params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = getTaskById(db, id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // For subtasks, query by subtask_id since stage logs are stored under the parent's task_id
    const stages = task.parentTaskId
      ? listStageLogsBySubtask(db, id).map(toClientStageLog)
      : listStageLogsByTask(db, id).map(toClientStageLog);
    res.json({ stages });
  });

  // GET /api/tasks/:id/stages/:stageLogId/logs
  router.get('/:stageLogId/logs', (req, res) => {
    const params = req.params as Record<string, string>;
    let id: number;
    try { id = parseTaskId(params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const stageLogId = params.stageLogId;
    const stageLog = getStageLogById(db, stageLogId);

    const ownsStageLog = stageLog && (stageLog.taskId === id || stageLog.subtaskId === id);
    if (!stageLog || !ownsStageLog) {
      return res.status(404).json({ error: 'Stage log not found' });
    }

    // For subtask requests, resolve the parent task for project lookup
    const task = getTaskById(db, stageLog.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const project = getProjectById(db, task.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const absolutePath = path.resolve(project.path, stageLog.filePath);

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Log file not found' });
    }

    const stat = fs.statSync(absolutePath);
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) return res.status(416).json({ error: 'Invalid range' });

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;

      if (start >= stat.size || end >= stat.size) {
        return res.status(416).json({ error: 'Range not satisfiable' });
      }

      res.status(206);
      res.set('Content-Type', 'text/plain');
      res.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.set('Content-Length', String(end - start + 1));
      fs.createReadStream(absolutePath, { start, end }).pipe(res);
    } else {
      res.set('Content-Type', 'text/plain');
      res.set('Content-Length', String(stat.size));
      fs.createReadStream(absolutePath).pipe(res);
    }
  });

  return router;
}
