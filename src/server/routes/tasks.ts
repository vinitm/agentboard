import { Router } from 'express';
import { spawn } from 'node:child_process';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { TaskStatus } from '../../types/index.js';
import * as queries from '../../db/queries.js';
import { broadcast } from '../ws.js';
import { cleanupWorktree } from '../../worker/git.js';

const AGENT_CONTROLLED_COLUMNS: TaskStatus[] = [
  'planning',
  'implementing',
  'checks',
  'review_spec',
  'review_code',
];

export function createTaskRoutes(db: Database.Database, io: Server): Router {
  const router = Router();

  /**
   * After a subtask reaches a terminal state via the API, promote next sibling
   * or update parent. Mirrors the worker loop's checkAndUpdateParentStatus.
   */
  function handleSubtaskTerminal(task: { parentTaskId: string | null; status: TaskStatus }): void {
    if (!task.parentTaskId) return;

    const parent = queries.getTaskById(db, task.parentTaskId);
    const terminalStatuses: TaskStatus[] = ['needs_human_review', 'done', 'failed', 'cancelled'];
    const successStatuses: TaskStatus[] = ['needs_human_review', 'done'];

    if (!parent || terminalStatuses.includes(parent.status)) return;

    // If succeeded, promote next backlog sibling
    if (successStatuses.includes(task.status)) {
      const nextSubtask = queries.getNextBacklogSubtask(db, task.parentTaskId);
      if (nextSubtask) {
        queries.updateTask(db, nextSubtask.id, { status: 'ready' });
        broadcast(io, 'task:updated', { taskId: nextSubtask.id, status: 'ready' });
        return;
      }
    }

    // Check if all siblings are terminal
    const siblings = queries.getSubtasksByParentId(db, task.parentTaskId);
    const allTerminal = siblings.every(s => terminalStatuses.includes(s.status));
    if (!allTerminal) return;

    const anyFailed = siblings.some(s => s.status === 'failed');
    const newStatus: TaskStatus = anyFailed ? 'failed' : 'needs_human_review';
    queries.updateTask(db, task.parentTaskId, { status: newStatus, blockedReason: null });
    broadcast(io, 'task:updated', { taskId: task.parentTaskId, status: newStatus });
  }

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

  // POST /api/tasks/parse — parse a short description into structured task fields using AI
  router.post('/parse', (req, res) => {
    const { description } = req.body as { description?: string };
    if (!description?.trim()) {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    const prompt = `You are a task parser. Given a short task description, extract structured fields for a software engineering task. Return ONLY valid JSON with no markdown fences or extra text.

The JSON must have this exact shape:
{
  "title": "short imperative title (max 80 chars)",
  "description": "1-2 sentence expanded description",
  "riskLevel": "low" | "medium" | "high",
  "priority": 0-10 (0=lowest, 10=highest),
  "spec": {
    "context": "what is the context/background for this task",
    "acceptanceCriteria": "when is this task considered done",
    "constraints": "technical constraints or limitations",
    "verification": "how to verify this task is correct",
    "infrastructureAllowed": "what infrastructure changes are allowed"
  }
}

Guidelines for field inference:
- riskLevel: "high" for DB migrations, auth changes, infra; "medium" for API changes, refactors; "low" for UI tweaks, docs, tests
- priority: higher for bugs, security fixes, blockers; lower for nice-to-haves, cleanup
- Leave spec fields as empty strings if not inferable from the description

Task description: ${description.trim()}`;

    const child = spawn('claude', ['--print'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill();
    }, 30_000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        res.status(500).json({ error: `AI parsing failed: ${stderr || 'unknown error'}` });
        return;
      }
      // Extract JSON from the response (handle possible markdown fences)
      let jsonStr = stdout.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }
      try {
        const parsed = JSON.parse(jsonStr);
        res.json(parsed);
      } catch {
        res.status(500).json({ error: 'Failed to parse AI response as JSON', raw: stdout });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      res.status(500).json({ error: `Failed to spawn claude: ${err.message}` });
    });

    child.stdin.write(prompt);
    child.stdin.end();
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
    // If a spec is provided, task is ready to be picked up by the worker
    const initialStatus = spec ? 'ready' : 'backlog';
    const task = queries.createTask(db, {
      projectId,
      title,
      description,
      spec: spec ?? null,
      riskLevel: (riskLevel as queries.CreateTaskData['riskLevel']) ?? 'low',
      priority: priority ?? 0,
      status: initialStatus,
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
    // Strip `status` — all status changes must go through POST /:id/move
    const { title, description, riskLevel, priority, columnPosition, spec, blockedReason, parentTaskId } =
      req.body as Omit<queries.UpdateTaskData, 'status'>;
    const task = queries.updateTask(db, req.params.id, {
      title,
      description,
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
  router.delete('/:id', async (req, res) => {
    const existing = queries.getTaskById(db, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    // Unclaim if currently claimed
    queries.unclaimTask(db, req.params.id);
    // Best-effort worktree cleanup before deleting DB records (cascade)
    await cleanupTaskWorktree(db, req.params.id).catch(() => {});
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
      // Unclaim if claimed
      queries.unclaimTask(db, req.params.id);
      const updated = queries.moveToColumn(db, req.params.id, column, 0);
      broadcast(io, 'task:moved', updated);
      // Best-effort worktree cleanup in background
      cleanupTaskWorktree(db, req.params.id).catch(() => {});
      // Promote next sibling or update parent
      handleSubtaskTerminal({ parentTaskId: task.parentTaskId, status: 'cancelled' });
      res.json(updated);
      return;
    }

    // Can move to ready from backlog (requires spec), failed, or blocked
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

    // Can move to backlog from ready only
    if (column === 'backlog') {
      if (task.status !== 'ready') {
        res.status(400).json({ error: 'Can only move to backlog from ready' });
        return;
      }
      const updated = queries.moveToColumn(db, req.params.id, column, 0);
      broadcast(io, 'task:moved', updated);
      res.json(updated);
      return;
    }

    // Can move to done from needs_human_review (after human reviews the PR)
    if (column === 'done') {
      if (task.status !== 'needs_human_review') {
        res.status(400).json({ error: 'Can only move to done from needs_human_review' });
        return;
      }
      const updated = queries.moveToColumn(db, req.params.id, column, 0);
      broadcast(io, 'task:moved', updated);
      // Best-effort worktree cleanup in background
      cleanupTaskWorktree(db, req.params.id).catch(() => {});
      // Promote next sibling or update parent
      handleSubtaskTerminal({ parentTaskId: task.parentTaskId, status: 'done' });
      res.json(updated);
      return;
    }

    // blocked, and failed are agent-controlled — no manual moves allowed
    res.status(400).json({ error: `Cannot manually move task to column: ${column}` });
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
    // Record the answers as an event
    queries.createEvent(db, {
      taskId: req.params.id,
      type: 'answer_provided',
      payload: JSON.stringify({ answers }),
    });

    // Move the task back to ready and clear the blocked reason.
    // TODO(worker): The worker should check event history to determine which
    // stage the task was blocked at and resume from that exact stage instead
    // of starting over from 'ready'. For now we set 'ready' as a pragmatic
    // fallback — the M2 worker loop will implement exact resumption logic.
    const updated = queries.updateTask(db, req.params.id, {
      blockedReason: null,
      status: 'ready',
    });
    broadcast(io, 'task:updated', updated);
    res.json(updated);
  });

  // POST /api/tasks/:id/retry — retry failed task (deletes subtasks, cleans up worktrees, starts fresh)
  router.post('/:id/retry', async (req, res) => {
    const task = queries.getTaskById(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (task.status !== 'failed') {
      res.status(400).json({ error: 'Task is not in failed state' });
      return;
    }

    // Clean up subtasks first (worktrees, git refs, then delete)
    const subtasks = queries.getSubtasksByParentId(db, task.id);
    for (const subtask of subtasks) {
      await cleanupTaskWorktree(db, subtask.id);
      const subtaskRefs = queries.listGitRefsByTask(db, subtask.id);
      for (const ref of subtaskRefs) {
        queries.deleteGitRef(db, ref.id);
      }
      queries.deleteTask(db, subtask.id);
      broadcast(io, 'task:deleted', { id: subtask.id });
    }

    // Clean up parent's worktree and git refs
    await cleanupTaskWorktree(db, req.params.id);
    const oldRefs = queries.listGitRefsByTask(db, req.params.id);
    for (const ref of oldRefs) {
      queries.deleteGitRef(db, ref.id);
    }

    const updated = queries.updateTask(db, req.params.id, {
      status: 'ready',
    });
    broadcast(io, 'task:updated', updated);
    res.json(updated);
  });

  /**
   * Best-effort cleanup of a task's git worktree and update git ref status.
   */
  async function cleanupTaskWorktree(database: Database.Database, taskId: string): Promise<void> {
    const gitRefs = queries.listGitRefsByTask(database, taskId);
    if (gitRefs.length === 0) return;

    const ref = gitRefs[0];
    if (!ref.worktreePath) return;

    // Find the project to get the repo path
    const task = queries.getTaskById(database, taskId);
    if (!task) return;

    const projects = queries.listProjects(database);
    const project = projects.find((p) => p.id === task.projectId);
    if (!project) return;

    try {
      await cleanupWorktree(project.path, ref.worktreePath);
      queries.updateGitRef(database, ref.id, { worktreePath: null });
    } catch {
      // Best effort — worktree may already be gone
    }
  }

  return router;
}
