import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { AgentboardConfig, Task, TaskStatus, Stage } from '../types/index.js';
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
  getProjectById,
  listProjects,
  listGitRefsByTask,
  getSubtasksByParentId,
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
import type { WorkerMemory } from './memory.js';
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

  /** After a subtask reaches a terminal state, check if all siblings are done and update parent. */
  function checkAndUpdateParentStatus(task: Task): void {
    if (!task.parentTaskId) return;

    const parent = getTaskById(db, task.parentTaskId);
    const terminalStatuses: TaskStatus[] = ['needs_human_review', 'done', 'failed', 'cancelled'];

    // Skip if parent is already terminal (e.g., manually cancelled)
    if (!parent || terminalStatuses.includes(parent.status)) return;

    const siblings = getSubtasksByParentId(db, task.parentTaskId);
    const allTerminal = siblings.every(s => terminalStatuses.includes(s.status));
    if (!allTerminal) return;

    const anyFailed = siblings.some(s => s.status === 'failed');
    const newParentStatus: TaskStatus = anyFailed ? 'failed' : 'needs_human_review';

    updateTask(db, task.parentTaskId, {
      status: newParentStatus,
      blockedReason: null,
    });
    createAndBroadcastEvent(
      task.parentTaskId,
      'status_changed',
      JSON.stringify({
        from: parent.status,
        to: newParentStatus,
        reason: 'all_subtasks_terminal',
      })
    );
    broadcast(io, 'task:updated', {
      taskId: task.parentTaskId,
      status: newParentStatus,
    });
  }

  /**
   * Helper to build a HookContext for a given task/stage/worktree.
   */
  function makeHookContext(task: Task, stage: Stage, worktreePath: string, taskConfig: AgentboardConfig): HookContext {
    return { task, stage, worktreePath, config: taskConfig };
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
   * Create an event in the DB and immediately broadcast it to WebSocket clients.
   * Always broadcasts the returned event object (which includes the DB-assigned id)
   * so the EventsTimeline component can deduplicate correctly.
   */
  function createAndBroadcastEvent(
    taskId: string,
    type: string,
    payload: string,
    runId?: string
  ): void {
    const event = createEvent(db, { taskId, type, payload, runId });
    broadcast(io, 'task:event', event);
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
    db: Database.Database,
    memory: WorkerMemory,
    configDir: string
  ): Promise<void> {
    // Move to implementing
    updateTask(db, task.id, { status: 'implementing' });
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({ from: 'planning', to: 'implementing' })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

    for (let attempt = 1; attempt <= config.maxAttemptsPerTask; attempt++) {
      // Run implementer stage
      await runHook(hooks, 'beforeStage', makeHookContext(task, 'implementing', worktreePath, config));
      const implResult = await runImplementation(
        db,
        task,
        worktreePath,
        config,
        attempt,
        createLogStreamer(task.id, `impl-${attempt}`)
      );
      await runHook(hooks, 'afterStage', makeHookContext(task, 'implementing', worktreePath, config));

      // If needs user input → block the task
      if (implResult.needsUserInput && implResult.needsUserInput.length > 0) {
        updateTask(db, task.id, {
          status: 'blocked',
          blockedReason: `Implementation needs input:\n${implResult.needsUserInput.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
        });
        unclaimTask(db, task.id);
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({
            from: 'implementing',
            to: 'blocked',
            reason: 'needs_user_input',
            questions: implResult.needsUserInput,
          })
        );
        broadcast(io, 'task:updated', { taskId: task.id, status: 'blocked' });
        notify('Task Blocked', `"${task.title}" needs human input`, config);
        return;
      }

      // If implementation failed, record and try again
      if (!implResult.success) {
        createAndBroadcastEvent(
          task.id,
          'implementation_failed',
          JSON.stringify({
            attempt,
            output: implResult.output.slice(0, 2000),
          })
        );

        if (attempt >= config.maxAttemptsPerTask) {
          break; // Will fall through to failed state
        }
        continue;
      }

      // Implementation succeeded — run checks
      updateTask(db, task.id, { status: 'checks' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: 'implementing', to: 'checks' })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'checks' });

      await runHook(hooks, 'beforeStage', makeHookContext(task, 'checks', worktreePath, config));
      const checksResult = await runChecks(db, task, worktreePath, config, createLogStreamer(task.id, `checks-${task.id}`));
      await runHook(hooks, 'afterStage', makeHookContext(task, 'checks', worktreePath, config));

      if (checksResult.passed) {
        // Commit the implementation
        await commitChanges(
          worktreePath,
          `feat: implement ${task.title}`
        );

        // Run review cycle and PR creation
        await runReviewAndPR(task, worktreePath, config, io, db, memory, configDir);
        return;
      }

      // Checks failed — record failure summary and retry
      const failedChecks = checksResult.results.filter((r) => !r.passed);
      for (const fc of failedChecks) {
        recordFailure(memory, `check:${fc.name}`, fc.output.slice(0, 500));
      }
      saveMemory(configDir, memory);

      createAndBroadcastEvent(
        task.id,
        'checks_failed',
        JSON.stringify({
          attempt,
          results: checksResult.results.map((r) => ({
            name: r.name,
            passed: r.passed,
            output: r.output.slice(0, 1000),
          })),
          formattingFixed: checksResult.formattingFixed,
        })
      );

      // Move back to implementing for next attempt
      if (attempt < config.maxAttemptsPerTask) {
        updateTask(db, task.id, { status: 'implementing' });
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({ from: 'checks', to: 'implementing' })
        );
        broadcast(io, 'task:updated', {
          taskId: task.id,
          status: 'implementing',
        });
      }
    }

    // All attempts exhausted → failed
    updateTask(db, task.id, { status: 'failed' });
    unclaimTask(db, task.id);
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({
        from: task.status,
        to: 'failed',
        reason: 'max_attempts_exhausted',
      })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'failed' });
    notify('Task Failed', `"${task.title}" failed after ${config.maxAttemptsPerTask} attempts`, config);
    checkAndUpdateParentStatus(task);
    await runHook(hooks, 'onError', makeHookContext(task, 'implementing', worktreePath, config));
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
    db: Database.Database,
    memory: WorkerMemory,
    configDir: string
  ): Promise<void> {
    let reviewCycle = 0;
    let specPassed = false;
    let codePassed = false;

    while (reviewCycle < config.maxReviewCycles) {
      reviewCycle++;

      // ── Spec review ──────────────────────────────────────────────────
      updateTask(db, task.id, { status: 'review_spec' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: task.status, to: 'review_spec', reviewCycle })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'review_spec' });

      await runHook(hooks, 'beforeStage', makeHookContext(task, 'review_spec', worktreePath, config));
      const specResult = await runSpecReview(db, task, worktreePath, config, createLogStreamer(task.id, `review-spec-${task.id}`));
      await runHook(hooks, 'afterStage', makeHookContext(task, 'review_spec', worktreePath, config));

      if (!specResult.passed) {
        createAndBroadcastEvent(
          task.id,
          'review_spec_failed',
          JSON.stringify({
            reviewCycle,
            feedback: specResult.feedback,
            issues: specResult.issues,
          })
        );

        if (reviewCycle >= config.maxReviewCycles) {
          // Exhausted review cycles — proceed to PR with note
          break;
        }

        // Cycle back to implementing with review feedback
        updateTask(db, task.id, { status: 'implementing' });
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({
            from: 'review_spec',
            to: 'implementing',
            reason: 'spec_review_failed',
            reviewCycle,
          })
        );
        broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

        // Re-run implementation with feedback
        const implResult = await runImplementation(db, task, worktreePath, config, reviewCycle + 1, createLogStreamer(task.id, `review-impl-${reviewCycle}`));
        if (!implResult.success) {
          break; // Will fall through to PR creation with note
        }

        // Re-run checks
        updateTask(db, task.id, { status: 'checks' });
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({ from: 'implementing', to: 'checks' })
        );
        broadcast(io, 'task:updated', { taskId: task.id, status: 'checks' });

        const checksResult = await runChecks(db, task, worktreePath, config, createLogStreamer(task.id, `checks-review-${task.id}`));
        if (!checksResult.passed) {
          break; // Will fall through to PR creation with note
        }

        await commitChanges(worktreePath, `feat: address spec review feedback (cycle ${reviewCycle})`);
        continue; // Go back to spec review
      }

      specPassed = true;

      // ── Code review ──────────────────────────────────────────────────
      updateTask(db, task.id, { status: 'review_code' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: 'review_spec', to: 'review_code', reviewCycle })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'review_code' });

      await runHook(hooks, 'beforeStage', makeHookContext(task, 'review_code', worktreePath, config));
      const codeResult = await runCodeReview(db, task, worktreePath, config, createLogStreamer(task.id, `review-code-${task.id}`));
      await runHook(hooks, 'afterStage', makeHookContext(task, 'review_code', worktreePath, config));

      if (!codeResult.passed) {
        createAndBroadcastEvent(
          task.id,
          'review_code_failed',
          JSON.stringify({
            reviewCycle,
            feedback: codeResult.feedback,
            issues: codeResult.issues,
          })
        );

        if (reviewCycle >= config.maxReviewCycles) {
          // Exhausted review cycles — proceed to PR with note
          break;
        }

        // Cycle back to implementing with review feedback
        updateTask(db, task.id, { status: 'implementing' });
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({
            from: 'review_code',
            to: 'implementing',
            reason: 'code_review_failed',
            reviewCycle,
          })
        );
        broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

        // Re-run implementation with feedback
        const implResult = await runImplementation(db, task, worktreePath, config, reviewCycle + 1, createLogStreamer(task.id, `review-impl-${reviewCycle}`));
        if (!implResult.success) {
          break; // Will fall through to PR creation with note
        }

        // Re-run checks
        updateTask(db, task.id, { status: 'checks' });
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({ from: 'implementing', to: 'checks' })
        );
        broadcast(io, 'task:updated', { taskId: task.id, status: 'checks' });

        const checksResult = await runChecks(db, task, worktreePath, config, createLogStreamer(task.id, `checks-review-${task.id}`));
        if (!checksResult.passed) {
          break; // Will fall through to PR creation with note
        }

        await commitChanges(worktreePath, `feat: address code review feedback (cycle ${reviewCycle})`);
        continue; // Go back to spec review
      }

      // Both reviews passed — proceed to PR creation
      specPassed = true;
      codePassed = true;
      break;
    }

    // If reviews didn't pass, fail the task instead of creating a broken PR
    if (!specPassed || !codePassed) {
      updateTask(db, task.id, { status: 'failed' });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({
          from: task.status,
          to: 'failed',
          reason: 'review_cycles_exhausted',
        })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'failed' });
      notify('Task Failed', `"${task.title}" failed: review cycles exhausted`, config);
      checkAndUpdateParentStatus(task);
      return;
    }

    // ── PR creation ──────────────────────────────────────────────────────
    try {
      await runHook(hooks, 'beforeStage', makeHookContext(task, 'pr_creation', worktreePath, config));
      const prResult = await createPR(db, task, worktreePath, config, createLogStreamer(task.id, `pr-${task.id}`));
      await runHook(hooks, 'afterStage', makeHookContext(task, 'pr_creation', worktreePath, config));

      createAndBroadcastEvent(
        task.id,
        'pr_created',
        JSON.stringify({
          prUrl: prResult.prUrl,
          prNumber: prResult.prNumber,
          reviewCycles: reviewCycle,
        })
      );
      notify('PR Created', `PR for "${task.title}" is ready for review`, config);

      // Record any conventions learned from successful PR creation
      recordConvention(memory, `task:${task.id}:pr`, `PR #${prResult.prNumber} created successfully`);
      saveMemory(configDir, memory);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      createAndBroadcastEvent(
        task.id,
        'pr_creation_failed',
        JSON.stringify({ error: errorMessage })
      );
      // Even if PR creation fails, move to needs_human_review
      // so a human can manually create the PR
    }

    // Move to needs_human_review
    updateTask(db, task.id, { status: 'needs_human_review' });
    unclaimTask(db, task.id);
    // Check if parent should be updated now that this subtask is done
    checkAndUpdateParentStatus(task);
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({
        from: task.status,
        to: 'needs_human_review',
        reviewCycles: reviewCycle,
      })
    );
    broadcast(io, 'task:updated', {
      taskId: task.id,
      status: 'needs_human_review',
    });
    notify('Task Complete', `"${task.title}" is ready for human review`, config);
    await runHook(hooks, 'onTaskComplete', makeHookContext(task, 'pr_creation', worktreePath, config));
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
      const project = getProjectById(db, task.projectId);
      if (!project) {
        throw new Error(`Project not found for task ${task.id}`);
      }
      repoPath = project.path;

      // Load per-project config (MUST happen before subtask check or createWorktree)
      const projectConfigDir = path.join(project.path, '.agentboard');
      let projectConfig: AgentboardConfig;
      try {
        const raw = fs.readFileSync(path.join(projectConfigDir, 'config.json'), 'utf-8');
        projectConfig = JSON.parse(raw) as AgentboardConfig;
      } catch (err) {
        throw new Error(
          `Failed to read per-project config at ${projectConfigDir}/config.json: ${err instanceof Error ? err.message : err}`
        );
      }

      // Load per-project memory
      const memory = loadMemory(projectConfigDir);

      // Check if this is a subtask that should reuse parent's worktree
      if (task.parentTaskId) {
        isSubtask = true;
        const parentGitRefs = listGitRefsByTask(db, task.parentTaskId);
        if (parentGitRefs.length > 0 && parentGitRefs[0].worktreePath) {
          worktreePath = parentGitRefs[0].worktreePath;

          // Skip planning for subtasks — go directly to implementation loop
          await runImplementationLoop(task, worktreePath, projectConfig, io, db, memory, projectConfigDir);
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
        projectConfig.baseBranch,
        projectConfig.branchPrefix
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
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({
          from: 'ready',
          to: 'planning',
        })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'planning' });

      // Run planning stage
      await runHook(hooks, 'beforeStage', makeHookContext(task, 'planning', worktreePath, projectConfig));
      const planResult = await runPlanning(db, task, worktreePath, projectConfig, createLogStreamer(task.id, `planning-${task.id}`));
      await runHook(hooks, 'afterStage', makeHookContext(task, 'planning', worktreePath, projectConfig));

      // Handle planning result
      if (planResult.questions.length > 0) {
        // Block the task — needs human answers
        updateTask(db, task.id, {
          status: 'blocked',
          blockedReason: `Planning has questions:\n${planResult.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
        });
        unclaimTask(db, task.id);
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({
            from: 'planning',
            to: 'blocked',
            reason: 'questions',
            questions: planResult.questions,
          })
        );
        broadcast(io, 'task:updated', {
          taskId: task.id,
          status: 'blocked',
        });
        notify('Task Blocked', `"${task.title}" has planning questions`, projectConfig);
        return;
      }

      if (planResult.subtasks.length > 0) {
        const MAX_SUBTASKS = 10;
        if (planResult.subtasks.length > MAX_SUBTASKS) {
          console.warn(
            `[worker] Planner returned ${planResult.subtasks.length} subtasks for task ${task.id}, capping at ${MAX_SUBTASKS}`
          );
          planResult.subtasks = planResult.subtasks.slice(0, MAX_SUBTASKS);
        }

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
          createAndBroadcastEvent(
            childTask.id,
            'task_created',
            JSON.stringify({
              parentTaskId: task.id,
              index: i,
            })
          );
          broadcast(io, 'task:created', { task: childTask });
        }

        // Keep parent in implementing while subtasks run
        updateTask(db, task.id, {
          status: 'implementing',
          blockedReason: null,
        });
        createAndBroadcastEvent(
          task.id,
          'subtasks_created',
          JSON.stringify({
            count: planResult.subtasks.length,
          })
        );
        broadcast(io, 'task:updated', {
          taskId: task.id,
          status: 'implementing',
        });
        // Unclaim the parent — children will be picked up individually
        unclaimTask(db, task.id);
        return;
      }

      // No questions, no subtasks — proceed to implementation
      await runImplementationLoop(task, worktreePath, projectConfig, io, db, memory, projectConfigDir);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[worker] Task ${task.id} failed:`, errorMessage);

      // Wrap all error-handling DB/IO ops so a secondary failure
      // doesn't leave the task permanently claimed
      try {
        updateTask(db, task.id, { status: 'failed' });
      } catch (e) {
        console.error(`[worker] Failed to update task ${task.id} status:`, e);
      }
      try {
        unclaimTask(db, task.id);
      } catch (e) {
        console.error(`[worker] Failed to unclaim task ${task.id}:`, e);
      }
      // Check if parent should be updated now that this subtask failed
      checkAndUpdateParentStatus(task);

      // Broadcast error to live logs
      try {
        broadcastLog(io, {
          taskId: task.id,
          runId: task.id,
          chunk: `[error] Task failed: ${errorMessage}\n`,
          timestamp: new Date().toISOString(),
        });

        createAndBroadcastEvent(
          task.id,
          'task_error',
          JSON.stringify({ error: errorMessage })
        );

        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({
            from: task.status,
            to: 'failed',
            error: errorMessage,
          })
        );
        broadcast(io, 'task:updated', { taskId: task.id, status: 'failed' });
      } catch (e) {
        console.error(`[worker] Failed to broadcast error for task ${task.id}:`, e);
      }

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
