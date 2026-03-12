import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { TaskStatus } from '../../types/index.js';
import * as queries from '../../db/queries.js';
import { broadcast } from '../ws.js';

const AGENT_CONTROLLED_COLUMNS: TaskStatus[] = [
  'planning',
  'implementing',
  'checks',
  'review_spec',
  'review_code',
];

export function createTaskRoutes(db: Database.Database, io: Server): Router {
  const router = Router();

  // GET /api/tasks — list tasks (query params: projectId, status)
  router.get('/', (req, res) => {
    const { projectId, status } = req.query as { projectId?: string; status?: string };
    if (!projectId) {
      res.status(400).json({ error: 'projectId query param is required' });
      return;
    }
    if (status) {
      const tasks = queries.listTasksByStatus(db, projectId, status as TaskStatus);
      res.json(tasks);
    } else {
      const tasks = queries.listTasksByProject(db, projectId);
      res.json(tasks);
    }
  });

  // POST /api/tasks — create task
  router.post('/', (req, res) => {
    const { projectId, title, description, spec, riskLevel, priority } = req.body as {
      projectId?: string;
      title?: string;
      description?: string;
      spec?: string;
      riskLevel?: string;
      priority?: number;
    };
    if (!projectId || !title) {
      res.status(400).json({ error: 'projectId and title are required' });
      return;
    }
    const task = queries.createTask(db, {
      projectId,
      title,
      description,
      spec: spec ?? null,
      riskLevel: (riskLevel as queries.CreateTaskData['riskLevel']) ?? 'low',
      priority: priority ?? 0,
    });
    broadcast(io, 'task:created', task);
    res.status(201).json(task);
  });

  // GET /api/tasks/:id — get task by id
  router.get('/:id', (req, res) => {
    const task = queries.getTaskById(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  });

  // PUT /api/tasks/:id — update task
  router.put('/:id', (req, res) => {
    const existing = queries.getTaskById(db, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const { title, description, status, riskLevel, priority, columnPosition, spec, blockedReason, parentTaskId } =
      req.body as queries.UpdateTaskData;
    const task = queries.updateTask(db, req.params.id, {
      title,
      description,
      status,
      riskLevel,
      priority,
      columnPosition,
      spec,
      blockedReason,
      parentTaskId,
    });
    broadcast(io, 'task:updated', task);
    res.json(task);
  });

  // DELETE /api/tasks/:id — delete task
  router.delete('/:id', (req, res) => {
    const existing = queries.getTaskById(db, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    queries.deleteTask(db, req.params.id);
    broadcast(io, 'task:deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  // POST /api/tasks/:id/move — move task to column
  router.post('/:id/move', (req, res) => {
    const task = queries.getTaskById(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const { column } = req.body as { column?: TaskStatus };
    if (!column) {
      res.status(400).json({ error: 'column is required' });
      return;
    }

    // Guardrails: can't manually move to agent-controlled columns
    if (AGENT_CONTROLLED_COLUMNS.includes(column)) {
      res.status(400).json({ error: `Cannot manually move task to agent-controlled column: ${column}` });
      return;
    }

    // Can move to cancelled from any state
    if (column === 'cancelled') {
      const updated = queries.moveToColumn(db, req.params.id, column, 0);
      broadcast(io, 'task:moved', updated);
      res.json(updated);
      return;
    }

    // Can move to ready from backlog (requires spec)
    if (column === 'ready') {
      if (task.status !== 'backlog' && task.status !== 'failed' && task.status !== 'blocked') {
        res.status(400).json({
          error: 'Can only move to ready from backlog, failed, or blocked',
        });
        return;
      }
      if (task.status === 'backlog' && !task.spec) {
        res.status(400).json({ error: 'Task must have a spec before moving to ready' });
        return;
      }
      const updated = queries.moveToColumn(db, req.params.id, column, 0);
      broadcast(io, 'task:moved', updated);
      res.json(updated);
      return;
    }

    // Can move to done or needs_human_review
    if (column === 'done' || column === 'needs_human_review') {
      const updated = queries.moveToColumn(db, req.params.id, column, 0);
      broadcast(io, 'task:moved', updated);
      res.json(updated);
      return;
    }

    // Can move to backlog
    if (column === 'backlog') {
      const updated = queries.moveToColumn(db, req.params.id, column, 0);
      broadcast(io, 'task:moved', updated);
      res.json(updated);
      return;
    }

    // For blocked/failed — these are set by the system but allow manual move
    if (column === 'blocked' || column === 'failed') {
      const updated = queries.moveToColumn(db, req.params.id, column, 0);
      broadcast(io, 'task:moved', updated);
      res.json(updated);
      return;
    }

    res.status(400).json({ error: `Invalid target column: ${column}` });
  });

  // POST /api/tasks/:id/answer — provide answers to blocked task
  router.post('/:id/answer', (req, res) => {
    const task = queries.getTaskById(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (task.status !== 'blocked') {
      res.status(400).json({ error: 'Task is not blocked' });
      return;
    }
    const { answers } = req.body as { answers?: string };
    if (!answers) {
      res.status(400).json({ error: 'answers is required' });
      return;
    }
    // Store the answer and move back to ready
    const updated = queries.updateTask(db, req.params.id, {
      blockedReason: null,
      status: 'ready',
    });
    broadcast(io, 'task:updated', updated);
    res.json(updated);
  });

  // POST /api/tasks/:id/retry — retry failed task
  router.post('/:id/retry', (req, res) => {
    const task = queries.getTaskById(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (task.status !== 'failed') {
      res.status(400).json({ error: 'Task is not in failed state' });
      return;
    }
    const updated = queries.updateTask(db, req.params.id, {
      status: 'ready',
    });
    broadcast(io, 'task:updated', updated);
    res.json(updated);
  });

  return router;
}
