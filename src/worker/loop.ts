import { EventEmitter } from 'node:events';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { AgentboardConfig, Task, Stage } from '../types/index.js';
import { broadcast, broadcastLog } from '../server/ws.js';
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
  listGitRefsByTask,
} from '../db/queries.js';
import { createWorktree, cleanupWorktree, commitChanges } from './git.js';
import { runPlanning } from './stages/planner.js';
import { runImplementation } from './stages/implementer.js';
import { runChecks } from './stages/checks.js';
import { runSpecReview } from './stages/review-spec.js';
import { runCodeReview } from './stages/review-code.js';
import { createPR } from './stages/pr-creator.js';
import { createHooks, loadRufloHooks, runHook } from './hooks.js';
import type { HookContext } from './hooks.js';
import { loadMemory, saveMemory, recordFailure, recordConvention } from './memory.js';
import { notify } from './notifications.js';

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
  let tickInProgress = false;
  const emitter = new EventEmitter();

  // Initialize hooks
  const hooks = createHooks();
  loadRufloHooks(hooks, config);

  // Initialize memory
  const configDir = path.join(process.cwd(), '.agentboard');
  const memory = loadMemory(configDir);

  /**
   * Helper to build a HookContext for a given task/stage/worktree.
   */
  function makeHookContext(task: Task, stage: Stage, worktreePath: string): HookContext {
    return { task, stage, worktreePath, config };
  }

  /**
   * Create a log streaming callback for a task + run that broadcasts
   * output chunks to WebSocket clients in real time.
   */
  function createLogStreamer(taskId: string, runId: string): (chunk: string) => void {
    return (chunk: string) => {
      broadcastLog(io, {
        taskId,
        runId,
        chunk,
        timestamp: new Date().toISOString(),
      });
    };
  }

  /**
   * Try to pick up and process a ready task.
   */
  async function tick(): Promise<void> {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
      if (!running) return;
      if (activeTasks >= config.maxConcurrentTasks) return;

      // Get all projects to find ready tasks across them
      const projects = listProjects(db);
      const allReadyTasks: Task[] = [];

      for (const project of projects) {
        const readyTasks = listTasksByStatus(db, project.id, 'ready');
        allReadyTasks.push(...readyTasks);
      }

      // Loop through ready tasks trying to claim one
      for (const readyTask of allReadyTasks) {
        if (!running) return;
        if (activeTasks >= config.maxConcurrentTasks) return;

        // Atomic claim
        const claimed = claimTask(db, readyTask.id, WORKER_ID);
        if (!claimed) continue;

        activeTasks++;
        // Re-fetch task after claim
        const task = getTaskById(db, readyTask.id);
        if (!task) {
          activeTasks--;
          continue;
        }

        // Process in background (don't block the tick)
        processTask(task).finally(() => {
          activeTasks--;
        });
      }
    } finally {
      tickInProgress = false;
    }
  }

  /**
   * Run the implementation → checks loop for a task.
   * Attempts implementation up to maxAttemptsPerTask times.
   */
  async function runImplementationLoop(
    task: Task,
    worktreePath: string,
    config: AgentboardConfig,
    io: Server,
    db: Database.Database
  ): Promise<void> {
    // Move to implementing
    updateTask(db, task.id, { status: 'implementing' });
    createEvent(db, {
      taskId: task.id,
      type: 'status_changed',
      payload: JSON.stringify({ from: 'planning', to: 'implementing' }),
    });
    broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

    for (let attempt = 1; attempt <= config.maxAttemptsPerTask; attempt++) {
      // Run implementer stage
      await runHook(hooks, 'beforeStage', makeHookContext(task, 'implementing', worktreePath));
      const implResult = await runImplementation(
        db,
        task,
        worktreePath,
        config,
        attempt,
        createLogStreamer(task.id, `impl-${attempt}`)
      );
      await runHook(hooks, 'afterStage', makeHookContext(task, 'implementing', worktreePath));

      // If needs user input → block the task
      if (implResult.needsUserInput && implResult.needsUserInput.length > 0) {
        updateTask(db, task.id, {
          status: 'blocked',
          blockedReason: `Implementation needs input:\n${implResult.needsUserInput.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
        });
        unclaimTask(db, task.id);
        createEvent(db, {
          taskId: task.id,
          type: 'status_changed',
          payload: JSON.stringify({
            from: 'implementing',
            to: 'blocked',
            reason: 'needs_user_input',
            questions: implResult.needsUserInput,
          }),
        });
        broadcast(io, 'task:updated', { taskId: task.id, status: 'blocked' });
        notify('Task Blocked', `"${task.title}" needs human input`, config);
        return;
      }

      // If implementation failed, record and try again
      if (!implResult.success) {
        createEvent(db, {
          taskId: task.id,
          type: 'implementation_failed',
          payload: JSON.stringify({
            attempt,
            output: implResult.output.slice(0, 2000),
          }),
        });

        if (attempt >= config.maxAttemptsPerTask) {
          break; // Will fall through to failed state
        }
        continue;
      }

      // Implementation succeeded — run checks
      updateTask(db, task.id, { status: 'checks' });
      createEvent(db, {
        taskId: task.id,
        type: 'status_changed',
        payload: JSON.stringify({ from: 'implementing', to: 'checks' }),
      });
      broadcast(io, 'task:updated', { taskId: task.id, status: 'checks' });

      await runHook(hooks, 'beforeStage', makeHookContext(task, 'checks', worktreePath));
      const checksResult = await runChecks(db, task, worktreePath, config);
      await runHook(hooks, 'afterStage', makeHookContext(task, 'checks', worktreePath));

      if (checksResult.passed) {
        // Commit the implementation
        await commitChanges(
          worktreePath,
          `feat: implement ${task.title}`
        );

        // Run review cycle and PR creation
        await runReviewAndPR(task, worktreePath, config, io, db);
        return;
      }

      // Checks failed — record failure summary and retry
      const failedChecks = checksResult.results.filter((r) => !r.passed);
      for (const fc of failedChecks) {
        recordFailure(memory, `check:${fc.name}`, fc.output.slice(0, 500));
      }
      saveMemory(configDir, memory);

      createEvent(db, {
        taskId: task.id,
        type: 'checks_failed',
        payload: JSON.stringify({
          attempt,
          results: checksResult.results.map((r) => ({
            name: r.name,
            passed: r.passed,
            output: r.output.slice(0, 1000),
          })),
          formattingFixed: checksResult.formattingFixed,
        }),
      });

      // Move back to implementing for next attempt
      if (attempt < config.maxAttemptsPerTask) {
        updateTask(db, task.id, { status: 'implementing' });
        createEvent(db, {
          taskId: task.id,
          type: 'status_changed',
          payload: JSON.stringify({ from: 'checks', to: 'implementing' }),
        });
        broadcast(io, 'task:updated', {
          taskId: task.id,
          status: 'implementing',
        });
      }
    }

    // All attempts exhausted → failed
    updateTask(db, task.id, { status: 'failed' });
    unclaimTask(db, task.id);
    createEvent(db, {
      taskId: task.id,
      type: 'status_changed',
      payload: JSON.stringify({
        from: task.status,
        to: 'failed',
        reason: 'max_attempts_exhausted',
      }),
    });
    broadcast(io, 'task:updated', { taskId: task.id, status: 'failed' });
    notify('Task Failed', `"${task.title}" failed after ${config.maxAttemptsPerTask} attempts`, config);
    await runHook(hooks, 'onError', makeHookContext(task, 'implementing', worktreePath));
  }

  /**
   * Run the review stages (spec + code) and PR creation.
   * If a review fails, cycle back to implementing (up to maxReviewCycles).
   * If cycles are exhausted, create the PR anyway with a note.
   */
  async function runReviewAndPR(
    task: Task,
    worktreePath: string,
    config: AgentboardConfig,
    io: Server,
    db: Database.Database
  ): Promise<void> {
    let reviewCycle = 0;

    while (reviewCycle < config.maxReviewCycles) {
      reviewCycle++;

      // ── Spec review ──────────────────────────────────────────────────
      updateTask(db, task.id, { status: 'review_spec' });
      createEvent(db, {
        taskId: task.id,
        type: 'status_changed',
        payload: JSON.stringify({ from: task.status, to: 'review_spec', reviewCycle }),
      });
      broadcast(io, 'task:updated', { taskId: task.id, status: 'review_spec' });

      await runHook(hooks, 'beforeStage', makeHookContext(task, 'review_spec', worktreePath));
      const specResult = await runSpecReview(db, task, worktreePath, config);
      await runHook(hooks, 'afterStage', makeHookContext(task, 'review_spec', worktreePath));

      if (!specResult.passed) {
        createEvent(db, {
          taskId: task.id,
          type: 'review_spec_failed',
          payload: JSON.stringify({
            reviewCycle,
            feedback: specResult.feedback,
            issues: specResult.issues,
          }),
        });

        if (reviewCycle >= config.maxReviewCycles) {
          // Exhausted review cycles — proceed to PR with note
          break;
        }

        // Cycle back to implementing with review feedback
        updateTask(db, task.id, { status: 'implementing' });
        createEvent(db, {
          taskId: task.id,
          type: 'status_changed',
          payload: JSON.stringify({
            from: 'review_spec',
            to: 'implementing',
            reason: 'spec_review_failed',
            reviewCycle,
          }),
        });
        broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

        // Re-run implementation with feedback
        const implResult = await runImplementation(db, task, worktreePath, config, reviewCycle + 1, createLogStreamer(task.id, `review-impl-${reviewCycle}`));
        if (!implResult.success) {
          break; // Will fall through to PR creation with note
        }

        // Re-run checks
        updateTask(db, task.id, { status: 'checks' });
        createEvent(db, {
          taskId: task.id,
          type: 'status_changed',
          payload: JSON.stringify({ from: 'implementing', to: 'checks' }),
        });
        broadcast(io, 'task:updated', { taskId: task.id, status: 'checks' });

        const checksResult = await runChecks(db, task, worktreePath, config);
        if (!checksResult.passed) {
          break; // Will fall through to PR creation with note
        }

        await commitChanges(worktreePath, `feat: address spec review feedback (cycle ${reviewCycle})`);
        continue; // Go back to spec review
      }

      // ── Code review ──────────────────────────────────────────────────
      updateTask(db, task.id, { status: 'review_code' });
      createEvent(db, {
        taskId: task.id,
        type: 'status_changed',
        payload: JSON.stringify({ from: 'review_spec', to: 'review_code', reviewCycle }),
      });
      broadcast(io, 'task:updated', { taskId: task.id, status: 'review_code' });

      await runHook(hooks, 'beforeStage', makeHookContext(task, 'review_code', worktreePath));
      const codeResult = await runCodeReview(db, task, worktreePath, config);
      await runHook(hooks, 'afterStage', makeHookContext(task, 'review_code', worktreePath));

      if (!codeResult.passed) {
        createEvent(db, {
          taskId: task.id,
          type: 'review_code_failed',
          payload: JSON.stringify({
            reviewCycle,
            feedback: codeResult.feedback,
            issues: codeResult.issues,
          }),
        });

        if (reviewCycle >= config.maxReviewCycles) {
          // Exhausted review cycles — proceed to PR with note
          break;
        }

        // Cycle back to implementing with review feedback
        updateTask(db, task.id, { status: 'implementing' });
        createEvent(db, {
          taskId: task.id,
          type: 'status_changed',
          payload: JSON.stringify({
            from: 'review_code',
            to: 'implementing',
            reason: 'code_review_failed',
            reviewCycle,
          }),
        });
        broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

        // Re-run implementation with feedback
        const implResult = await runImplementation(db, task, worktreePath, config, reviewCycle + 1, createLogStreamer(task.id, `review-impl-${reviewCycle}`));
        if (!implResult.success) {
          break; // Will fall through to PR creation with note
        }

        // Re-run checks
        updateTask(db, task.id, { status: 'checks' });
        createEvent(db, {
          taskId: task.id,
          type: 'status_changed',
          payload: JSON.stringify({ from: 'implementing', to: 'checks' }),
        });
        broadcast(io, 'task:updated', { taskId: task.id, status: 'checks' });

        const checksResult = await runChecks(db, task, worktreePath, config);
        if (!checksResult.passed) {
          break; // Will fall through to PR creation with note
        }

        await commitChanges(worktreePath, `feat: address code review feedback (cycle ${reviewCycle})`);
        continue; // Go back to spec review
      }

      // Both reviews passed — proceed to PR creation
      break;
    }

    // ── PR creation ──────────────────────────────────────────────────────
    try {
      await runHook(hooks, 'beforeStage', makeHookContext(task, 'pr_creation', worktreePath));
      const prResult = await createPR(db, task, worktreePath, config);
      await runHook(hooks, 'afterStage', makeHookContext(task, 'pr_creation', worktreePath));

      createEvent(db, {
        taskId: task.id,
        type: 'pr_created',
        payload: JSON.stringify({
          prUrl: prResult.prUrl,
          prNumber: prResult.prNumber,
          reviewCycles: reviewCycle,
        }),
      });
      notify('PR Created', `PR for "${task.title}" is ready for review`, config);

      // Record any conventions learned from successful PR creation
      recordConvention(memory, `task:${task.id}:pr`, `PR #${prResult.prNumber} created successfully`);
      saveMemory(configDir, memory);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      createEvent(db, {
        taskId: task.id,
        type: 'pr_creation_failed',
        payload: JSON.stringify({ error: errorMessage }),
      });
      // Even if PR creation fails, move to needs_human_review
      // so a human can manually create the PR
    }

    // Move to needs_human_review
    updateTask(db, task.id, { status: 'needs_human_review' });
    unclaimTask(db, task.id);
    createEvent(db, {
      taskId: task.id,
      type: 'status_changed',
      payload: JSON.stringify({
        from: task.status,
        to: 'needs_human_review',
        reviewCycles: reviewCycle,
      }),
    });
    broadcast(io, 'task:updated', {
      taskId: task.id,
      status: 'needs_human_review',
    });
    notify('Task Complete', `"${task.title}" is ready for human review`, config);
    await runHook(hooks, 'onTaskComplete', makeHookContext(task, 'pr_creation', worktreePath));
  }

  /**
   * Process a single task through the planning stage.
   */
  async function processTask(task: Task): Promise<void> {
    let worktreePath: string | undefined;
    let isSubtask = false;
    let repoPath: string | undefined;

    try {
      // Find the project to get the repo path
      const projects = listProjects(db);
      const project = projects.find((p) => p.id === task.projectId);
      if (!project) {
        throw new Error(`Project not found for task ${task.id}`);
      }
      repoPath = project.path;

      // Check if this is a subtask that should reuse parent's worktree
      if (task.parentTaskId) {
        isSubtask = true;
        const parentGitRefs = listGitRefsByTask(db, task.parentTaskId);
        if (parentGitRefs.length > 0 && parentGitRefs[0].worktreePath) {
          worktreePath = parentGitRefs[0].worktreePath;

          // Skip planning for subtasks — go directly to implementation loop
          await runImplementationLoop(task, worktreePath, config, io, db);
          return;
        }
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
      await runHook(hooks, 'beforeStage', makeHookContext(task, 'planning', worktreePath));
      const planResult = await runPlanning(db, task, worktreePath, config);
      await runHook(hooks, 'afterStage', makeHookContext(task, 'planning', worktreePath));

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
        notify('Task Blocked', `"${task.title}" has planning questions`, config);
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

        // Move parent to blocked until subtasks complete
        updateTask(db, task.id, {
          status: 'blocked',
          blockedReason: 'Waiting for subtasks to complete',
        });
        createEvent(db, {
          taskId: task.id,
          type: 'subtasks_created',
          payload: JSON.stringify({
            count: planResult.subtasks.length,
          }),
        });
        broadcast(io, 'task:updated', {
          taskId: task.id,
          status: 'blocked',
        });
        // Unclaim the parent — children will be picked up individually
        unclaimTask(db, task.id);
        return;
      }

      // No questions, no subtasks — proceed to implementation
      await runImplementationLoop(task, worktreePath, config, io, db);
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

      // Attempt worktree cleanup on failure (skip for subtasks reusing parent worktree)
      if (worktreePath && !isSubtask && repoPath) {
        try {
          await cleanupWorktree(repoPath, worktreePath);
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
        // Call tick() in a loop to fill all concurrent slots quickly
        let hadWork = true;
        while (hadWork && running && activeTasks < config.maxConcurrentTasks) {
          const before = activeTasks;
          await tick();
          hadWork = activeTasks > before;
        }
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
