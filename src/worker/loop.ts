import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { AgentboardConfig, Task } from '../types/index.js';
import { broadcast } from '../server/ws.js';
import {
  listTasksByStatus,
  claimTask,
  updateTask,
  unclaimTask,
  createEvent,
  createTask,
  createGitRef,
  getTaskById,
  listProjects,
} from '../db/queries.js';
import { createWorktree, cleanupWorktree } from './git.js';
import { runPlanning } from './stages/planner.js';

const POLL_INTERVAL_MS = 5_000;
const WORKER_ID = `worker-${process.pid}`;

export interface WorkerLoop {
  start(): void;
  stop(): Promise<void>;
  isRunning: boolean;
  emitter: EventEmitter;
}

/**
 * Create the main worker loop that picks up tasks and orchestrates agent stages.
 */
export function createWorkerLoop(
  db: Database.Database,
  config: AgentboardConfig,
  io: Server
): WorkerLoop {
  let running = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let activeTasks = 0;
  const emitter = new EventEmitter();

  /**
   * Try to pick up and process a ready task.
   */
  async function tick(): Promise<void> {
    if (!running) return;
    if (activeTasks >= config.maxConcurrentTasks) return;

    // Get all projects to find ready tasks across them
    const projects = listProjects(db);
    let readyTask: Task | undefined;

    for (const project of projects) {
      const readyTasks = listTasksByStatus(db, project.id, 'ready');
      if (readyTasks.length > 0) {
        readyTask = readyTasks[0];
        break;
      }
    }

    if (!readyTask) return;

    // Atomic claim
    const claimed = claimTask(db, readyTask.id, WORKER_ID);
    if (!claimed) return;

    activeTasks++;
    // Re-fetch task after claim
    const task = getTaskById(db, readyTask.id);
    if (!task) {
      activeTasks--;
      return;
    }

    // Process in background (don't block the tick)
    processTask(task).finally(() => {
      activeTasks--;
    });
  }

  /**
   * Process a single task through the planning stage.
   */
  async function processTask(task: Task): Promise<void> {
    let worktreePath: string | undefined;

    try {
      // Find the project to get the repo path
      const projects = listProjects(db);
      const project = projects.find((p) => p.id === task.projectId);
      if (!project) {
        throw new Error(`Project not found for task ${task.id}`);
      }

      // Create a slug from the task title
      const slug = task.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30);

      // Create worktree + branch
      const { worktreePath: wtPath, branch } = await createWorktree(
        project.path,
        task.id,
        slug,
        config.baseBranch,
        config.branchPrefix
      );
      worktreePath = wtPath;

      // Record git ref in DB
      createGitRef(db, {
        taskId: task.id,
        branch,
        worktreePath,
        status: 'local',
      });

      // Move to planning
      updateTask(db, task.id, { status: 'planning' });
      createEvent(db, {
        taskId: task.id,
        type: 'status_changed',
        payload: JSON.stringify({
          from: 'ready',
          to: 'planning',
        }),
      });
      broadcast(io, 'task:updated', { taskId: task.id, status: 'planning' });

      // Run planning stage
      const planResult = await runPlanning(db, task, worktreePath, config);

      // Handle planning result
      if (planResult.questions.length > 0) {
        // Block the task — needs human answers
        updateTask(db, task.id, {
          status: 'blocked',
          blockedReason: `Planning has questions:\n${planResult.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
        });
        unclaimTask(db, task.id);
        createEvent(db, {
          taskId: task.id,
          type: 'status_changed',
          payload: JSON.stringify({
            from: 'planning',
            to: 'blocked',
            reason: 'questions',
            questions: planResult.questions,
          }),
        });
        broadcast(io, 'task:updated', {
          taskId: task.id,
          status: 'blocked',
        });
        return;
      }

      if (planResult.subtasks.length > 0) {
        // Create child tasks
        for (let i = 0; i < planResult.subtasks.length; i++) {
          const subtask = planResult.subtasks[i];
          const childTask = createTask(db, {
            projectId: task.projectId,
            parentTaskId: task.id,
            title: subtask.title,
            description: subtask.description,
            status: 'ready',
            priority: task.priority,
            riskLevel: task.riskLevel,
          });
          createEvent(db, {
            taskId: childTask.id,
            type: 'task_created',
            payload: JSON.stringify({
              parentTaskId: task.id,
              index: i,
            }),
          });
          broadcast(io, 'task:created', { task: childTask });
        }

        // Parent stays in planning until children complete
        createEvent(db, {
          taskId: task.id,
          type: 'subtasks_created',
          payload: JSON.stringify({
            count: planResult.subtasks.length,
          }),
        });
        // Unclaim the parent — children will be picked up individually
        unclaimTask(db, task.id);
        return;
      }

      // No questions, no subtasks — ready for implementation
      updateTask(db, task.id, { status: 'implementing' });
      unclaimTask(db, task.id);
      createEvent(db, {
        taskId: task.id,
        type: 'status_changed',
        payload: JSON.stringify({
          from: 'planning',
          to: 'implementing',
        }),
      });
      broadcast(io, 'task:updated', {
        taskId: task.id,
        status: 'implementing',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[worker] Task ${task.id} failed:`, errorMessage);

      updateTask(db, task.id, { status: 'failed' });
      unclaimTask(db, task.id);
      createEvent(db, {
        taskId: task.id,
        type: 'status_changed',
        payload: JSON.stringify({
          from: task.status,
          to: 'failed',
          error: errorMessage,
        }),
      });
      broadcast(io, 'task:updated', { taskId: task.id, status: 'failed' });

      // Attempt worktree cleanup on failure
      if (worktreePath) {
        try {
          await cleanupWorktree(worktreePath);
        } catch {
          // Best effort cleanup
        }
      }
    }
  }

  /**
   * Schedule the next poll tick.
   */
  function scheduleTick(): void {
    if (!running) return;
    pollTimer = setTimeout(async () => {
      try {
        await tick();
      } catch (error) {
        console.error('[worker] Tick error:', error);
      }
      scheduleTick();
    }, POLL_INTERVAL_MS);
  }

  // Listen for immediate wake-up events
  emitter.on('task:ready', () => {
    if (running) {
      // Wake up immediately instead of waiting for poll
      tick().catch((error) => {
        console.error('[worker] Immediate tick error:', error);
      });
    }
  });

  return {
    get isRunning() {
      return running;
    },

    start() {
      if (running) return;
      running = true;
      console.log('[worker] Starting worker loop');
      scheduleTick();
    },

    async stop() {
      if (!running) return;
      running = false;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      // Wait for active tasks to drain (with timeout)
      const deadline = Date.now() + 30_000;
      while (activeTasks > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (activeTasks > 0) {
        console.warn(
          `[worker] Stopping with ${activeTasks} active tasks still running`
        );
      }
      console.log('[worker] Worker loop stopped');
    },

    emitter,
  };
}
