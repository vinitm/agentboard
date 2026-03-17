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
  getNextBacklogSubtask,
  createArtifact,
  getLatestRunByTaskAndStage,
  listEventsByTask,
} from '../db/queries.js';
import { createWorktree, cleanupWorktree, commitChanges } from './git.js';
import { runPlanning } from './stages/planner.js';
import { runImplementation } from './stages/implementer.js';
import { runChecks } from './stages/checks.js';
import { runReviewPanel, formatPanelFeedback } from './stages/review-panel.js';
import { createPR } from './stages/pr-creator.js';
import { createHooks, loadRufloHooks, runHook } from './hooks.js';
import type { HookContext } from './hooks.js';
import { loadMemory, saveMemory, recordFailure, recordConvention } from './memory.js';
import type { WorkerMemory } from './memory.js';
import { notify } from './notifications.js';
import { normalizeConfig } from './config-compat.js';
import { runRalphLoop } from './ralph-loop.js';
import { evaluateAutoMerge } from './auto-merge.js';
import { collectTaskMetrics, recordLearning, extractLearnings } from './stages/learner.js';
import { createTaskLogger, openTaskLogger, cleanupOldLogs, createBufferedWriter } from './log-writer.js';
import type { TaskLogger } from './log-writer.js';
import {
  createTaskLog,
  getTaskLogByTaskId,
  updateTaskLogSize,
} from '../db/queries.js';

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

  /** After a subtask reaches a terminal state, promote next sibling or update parent. */
  async function checkAndUpdateParentStatus(task: Task): Promise<void> {
    if (!task.parentTaskId) return;

    // Re-fetch the task to get current status (the in-memory task object may be stale)
    const freshTask = getTaskById(db, task.id);
    if (!freshTask) return;

    const parent = getTaskById(db, task.parentTaskId);
    const terminalStatuses: TaskStatus[] = ['done', 'failed', 'cancelled'];
    const successStatuses: TaskStatus[] = ['done'];

    // Skip if parent is already terminal (e.g., manually cancelled)
    if (!parent || terminalStatuses.includes(parent.status)) return;

    // If this subtask succeeded, promote the next backlog sibling to ready
    if (successStatuses.includes(freshTask.status)) {
      const nextSubtask = getNextBacklogSubtask(db, task.parentTaskId);
      if (nextSubtask) {
        updateTask(db, nextSubtask.id, { status: 'ready' });
        createAndBroadcastEvent(
          nextSubtask.id,
          'status_changed',
          JSON.stringify({
            from: 'backlog',
            to: 'ready',
            reason: 'previous_subtask_completed',
          })
        );
        broadcast(io, 'task:updated', { taskId: nextSubtask.id, status: 'ready' });
        // Wake up the worker loop immediately
        emitter.emit('task:ready');
        return; // Not all siblings are done yet — don't update parent
      }
    }
    // If subtask failed/cancelled, cancel remaining backlog siblings so parent can resolve
    if (!successStatuses.includes(freshTask.status)) {
      const siblings = getSubtasksByParentId(db, task.parentTaskId);
      for (const sibling of siblings) {
        if (sibling.status === 'backlog') {
          updateTask(db, sibling.id, { status: 'cancelled' });
          createAndBroadcastEvent(
            sibling.id,
            'status_changed',
            JSON.stringify({
              from: 'backlog',
              to: 'cancelled',
              reason: 'sibling_failed',
            })
          );
          broadcast(io, 'task:updated', { taskId: sibling.id, status: 'cancelled' });
        }
      }
    }

    const siblings = getSubtasksByParentId(db, task.parentTaskId);
    const allTerminal = siblings.every(s => terminalStatuses.includes(s.status));
    if (!allTerminal) return;

    const anyFailed = siblings.some(s => s.status === 'failed');

    // If all subtasks succeeded, create a single PR for the parent
    if (!anyFailed) {
      const parentGitRefs = listGitRefsByTask(db, task.parentTaskId);
      if (parentGitRefs.length > 0 && parentGitRefs[0].worktreePath) {
        const worktreePath = parentGitRefs[0].worktreePath;

        // Load per-project config for PR creation
        const project = getProjectById(db, parent.projectId);
        if (project) {
          const projectConfigDir = path.join(project.path, '.agentboard');
          let projectConfig: AgentboardConfig;
          try {
            const raw = fs.readFileSync(path.join(projectConfigDir, 'config.json'), 'utf-8');
            projectConfig = normalizeConfig(JSON.parse(raw));
          } catch {
            projectConfig = config;
          }

          // Open parent's logger if it exists
          const parentTaskLog = getTaskLogByTaskId(db, parent.id);
          const parentLogger = parentTaskLog ? openTaskLogger(parentTaskLog.logPath) : undefined;

          try {
            await runHook(hooks, 'beforeStage', makeHookContext(parent, 'pr_creation', worktreePath, projectConfig));
            parentLogger?.stageStart('pr_creation', `pr-${parent.id}`, 1, 'n/a');
            const prResult = await createPR(db, parent, worktreePath, projectConfig, createLogStreamer(parent.id, `pr-${parent.id}`, parentLogger));
            parentLogger?.stageEnd('success');
            await runHook(hooks, 'afterStage', makeHookContext(parent, 'pr_creation', worktreePath, projectConfig));

            createAndBroadcastEvent(
              parent.id,
              'pr_created',
              JSON.stringify({
                prUrl: prResult.prUrl,
                prNumber: prResult.prNumber,
              })
            );
            parentLogger?.event('pr_created', `PR #${prResult.prNumber} — ${prResult.prUrl}`);
            notify('PR Created', `PR for "${parent.title}" is ready for review`, projectConfig);

            const memory = loadMemory(projectConfigDir);
            recordConvention(memory, `task:${parent.id}:pr`, `PR #${prResult.prNumber} created successfully`);
            saveMemory(projectConfigDir, memory);

            if (parentTaskLog) {
              updateTaskLogSize(db, parentTaskLog.id, parentLogger?.sizeBytes() ?? 0);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            parentLogger?.error(`PR creation failed: ${errorMessage}`);
            createAndBroadcastEvent(
              parent.id,
              'pr_creation_failed',
              JSON.stringify({ error: errorMessage })
            );
          }
        }
      }
    }

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
   * output chunks to WebSocket clients in real time AND writes to the
   * task's persistent log file.
   */
  function createLogStreamer(taskId: string, runId: string, logger?: TaskLogger): (chunk: string) => void {
    return (chunk: string) => {
      broadcastLog(io, {
        taskId,
        runId,
        chunk,
        timestamp: new Date().toISOString(),
      });
      logger?.write(chunk);
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
   * Process a subtask autonomously: run the ralph loop and go directly
   * to done/failed. No intermediate status broadcasts, no review panel,
   * no auto-merge evaluation.
   */
  async function processSubtask(
    task: Task,
    worktreePath: string,
    config: AgentboardConfig,
    configDir: string,
    logger?: TaskLogger
  ): Promise<void> {
    const maxIterations = config.maxRalphIterations ?? config.maxAttemptsPerTask;

    const ralphResult = await runRalphLoop({
      db,
      task,
      worktreePath,
      config,
      maxIterations,
      onOutput: createLogStreamer(task.id, `ralph-${task.id}`, logger),
      onIterationComplete: (iteration, passed) => {
        // Still log events for debugging, but no status broadcasts
        createAndBroadcastEvent(
          task.id,
          passed ? 'ralph_iteration_passed' : 'ralph_iteration_failed',
          JSON.stringify({ iteration, maxIterations })
        );
        logger?.event(
          passed ? 'ralph_iteration_passed' : 'ralph_iteration_failed',
          `iteration=${iteration}/${maxIterations}`
        );
      },
    });

    if (ralphResult.passed) {
      createAndBroadcastEvent(
        task.id,
        'ralph_loop_completed',
        JSON.stringify({ iterations: ralphResult.iterations })
      );

      // Go directly to done — no review panel, no PR creation
      updateTask(db, task.id, { status: 'done' });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: 'ready', to: 'done', reason: 'subtask_completed' })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'done' });

      // Record learning
      const metrics = collectTaskMetrics(db, task, 'success');
      recordLearning(configDir, metrics);

      // Fire-and-forget: non-blocking learning extraction
      extractLearnings(metrics, worktreePath, config.modelDefaults.learning, createLogStreamer(task.id, `learning-${task.id}`, logger))
        .then(result => { if (result.saved) console.log(`[learner] Extracted skill "${result.pattern}" for task ${task.id}`); })
        .catch(() => { /* already logged inside extractLearnings */ });

      await checkAndUpdateParentStatus(task);
      return;
    }

    // Ralph loop exhausted → failed
    updateTask(db, task.id, { status: 'failed' });
    unclaimTask(db, task.id);
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({
        from: 'ready',
        to: 'failed',
        reason: 'ralph_loop_exhausted',
        iterations: ralphResult.iterations,
      })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'failed' });

    const failedMetrics = collectTaskMetrics(db, task, 'failed');
    recordLearning(configDir, failedMetrics);

    // Fire-and-forget: non-blocking learning extraction
    extractLearnings(failedMetrics, worktreePath, config.modelDefaults.learning, createLogStreamer(task.id, `learning-${task.id}`, logger))
      .then(result => { if (result.saved) console.log(`[learner] Extracted skill "${result.pattern}" for task ${task.id}`); })
      .catch(() => { /* already logged inside extractLearnings */ });

    await checkAndUpdateParentStatus(task);
  }

  /**
   * Run the implementation → checks ralph loop for a task.
   * Uses the ralph loop pattern: fresh Claude session per iteration,
   * progress persists in git + .agentboard-progress.md.
   */
  async function runImplementationLoop(
    task: Task,
    worktreePath: string,
    config: AgentboardConfig,
    io: Server,
    db: Database.Database,
    memory: WorkerMemory,
    configDir: string,
    logger?: TaskLogger
  ): Promise<void> {
    // Move to implementing
    updateTask(db, task.id, { status: 'implementing' });
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({ from: 'planning', to: 'implementing' })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

    await runHook(hooks, 'beforeStage', makeHookContext(task, 'implementing', worktreePath, config));

    const maxIterations = config.maxRalphIterations ?? config.maxAttemptsPerTask;

    const ralphResult = await runRalphLoop({
      db,
      task,
      worktreePath,
      config,
      maxIterations,
      onOutput: createLogStreamer(task.id, `ralph-${task.id}`, logger),
      onIterationComplete: (iteration, passed) => {
        createAndBroadcastEvent(
          task.id,
          passed ? 'ralph_iteration_passed' : 'ralph_iteration_failed',
          JSON.stringify({ iteration, maxIterations })
        );
        logger?.event(
          passed ? 'ralph_iteration_passed' : 'ralph_iteration_failed',
          `iteration=${iteration}/${maxIterations}`
        );

        if (!passed) {
          // Update UI status cycling
          broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });
        }
      },
    });

    await runHook(hooks, 'afterStage', makeHookContext(task, 'implementing', worktreePath, config));

    if (ralphResult.passed) {
      createAndBroadcastEvent(
        task.id,
        'ralph_loop_completed',
        JSON.stringify({ iterations: ralphResult.iterations })
      );

      // Run review cycle and PR creation
      await runReviewAndPR(task, worktreePath, config, io, db, memory, configDir, logger);
      return;
    }

    // All iterations exhausted → failed
    updateTask(db, task.id, { status: 'failed' });
    unclaimTask(db, task.id);
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({
        from: task.status,
        to: 'failed',
        reason: 'ralph_loop_exhausted',
        iterations: ralphResult.iterations,
      })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'failed' });
    notify('Task Failed', `"${task.title}" failed after ${ralphResult.iterations} ralph loop iterations`, config);

    // Record learning for failed task
    const failedMetrics = collectTaskMetrics(db, task, 'failed');
    recordLearning(configDir, failedMetrics);

    // Fire-and-forget: non-blocking learning extraction
    extractLearnings(failedMetrics, worktreePath, config.modelDefaults.learning, createLogStreamer(task.id, `learning-${task.id}`, logger))
      .then(result => { if (result.saved) console.log(`[learner] Extracted skill "${result.pattern}" for task ${task.id}`); })
      .catch(() => { /* already logged inside extractLearnings */ });

    await checkAndUpdateParentStatus(task);
    await runHook(hooks, 'onError', makeHookContext(task, 'implementing', worktreePath, config));
  }

  /**
   * Run the review panel (3 parallel reviewers) and PR creation.
   * If the panel fails, cycle back to implementing (up to maxReviewCycles).
   */
  async function runReviewAndPR(
    task: Task,
    worktreePath: string,
    config: AgentboardConfig,
    io: Server,
    db: Database.Database,
    memory: WorkerMemory,
    configDir: string,
    logger?: TaskLogger
  ): Promise<void> {
    let reviewCycle = 0;
    let panelPassed = false;

    while (reviewCycle < config.maxReviewCycles) {
      reviewCycle++;

      // ── Review panel (3 parallel reviewers) ────────────────────────
      updateTask(db, task.id, { status: 'review_panel' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: task.status, to: 'review_panel', reviewCycle })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'review_panel' });

      await runHook(hooks, 'beforeStage', makeHookContext(task, 'review_panel', worktreePath, config));
      logger?.stageStart('review_panel', `review-panel-${task.id}`, reviewCycle, config.modelDefaults.review);
      const panelResult = await runReviewPanel(db, task, worktreePath, config, createLogStreamer(task.id, `review-panel-${task.id}`), logger);
      logger?.stageEnd(panelResult.passed ? 'passed' : 'failed');
      await runHook(hooks, 'afterStage', makeHookContext(task, 'review_panel', worktreePath, config));

      if (panelResult.passed) {
        panelPassed = true;

        createAndBroadcastEvent(
          task.id,
          'review_panel_completed',
          JSON.stringify({
            reviewCycle,
            results: panelResult.results.map(r => ({ role: r.role, passed: r.passed, issues: r.issues })),
          })
        );
        break;
      }

      // Panel failed — emit event with per-role details
      createAndBroadcastEvent(
        task.id,
        'review_panel_failed',
        JSON.stringify({
          reviewCycle,
          results: panelResult.results.map(r => ({ role: r.role, passed: r.passed, issues: r.issues })),
        })
      );

      if (reviewCycle >= config.maxReviewCycles) {
        break;
      }

      // Format and store feedback for the implementer
      const feedbackText = formatPanelFeedback(panelResult.results, reviewCycle, config.maxReviewCycles);

      createAndBroadcastEvent(
        task.id,
        'review_panel_feedback',
        JSON.stringify({ feedback: feedbackText, reviewCycle })
      );

      // Cycle back to implementing with combined feedback
      updateTask(db, task.id, { status: 'implementing' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({
          from: 'review_panel',
          to: 'implementing',
          reason: 'review_panel_failed',
          reviewCycle,
        })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

      // Re-run implementation with review feedback
      logger?.stageStart('implementing', `review-impl-${reviewCycle}`, reviewCycle + 1, config.modelDefaults.implementation);
      const implResult = await runImplementation(db, task, worktreePath, config, reviewCycle + 1, createLogStreamer(task.id, `review-impl-${reviewCycle}`, logger));
      logger?.stageEnd(implResult.success ? 'success' : 'failed');
      if (!implResult.success) {
        break;
      }

      // Re-run checks
      updateTask(db, task.id, { status: 'checks' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: 'implementing', to: 'checks' })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'checks' });

      logger?.stageStart('checks', `checks-review-${task.id}`, reviewCycle, 'n/a');
      const checksResult = await runChecks(db, task, worktreePath, config, createLogStreamer(task.id, `checks-review-${task.id}`, logger));
      logger?.stageEnd(checksResult.passed ? 'passed' : 'failed');
      if (!checksResult.passed) {
        break;
      }

      await commitChanges(worktreePath, `feat: address review panel feedback (cycle ${reviewCycle})`);
      continue;
    }

    // If panel didn't pass, fail the task
    if (!panelPassed) {
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

      // Record learning for failed task
      const failedMetrics = collectTaskMetrics(db, task, 'failed');
      recordLearning(configDir, failedMetrics);

      // Fire-and-forget: non-blocking learning extraction
      extractLearnings(failedMetrics, worktreePath, config.modelDefaults.learning, createLogStreamer(task.id, `learning-${task.id}`, logger))
        .then(result => { if (result.saved) console.log(`[learner] Extracted skill "${result.pattern}" for task ${task.id}`); })
        .catch(() => { /* already logged inside extractLearnings */ });

      await checkAndUpdateParentStatus(task);
      return;
    }

    // ── PR creation (skip for subtasks) ────────────────────────────────
    if (!task.parentTaskId) {
      try {
        await runHook(hooks, 'beforeStage', makeHookContext(task, 'pr_creation', worktreePath, config));
        logger?.stageStart('pr_creation', `pr-${task.id}`, 1, 'n/a');
        const prResult = await createPR(db, task, worktreePath, config, createLogStreamer(task.id, `pr-${task.id}`, logger));
        logger?.stageEnd('success');
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
        logger?.event('pr_created', `PR #${prResult.prNumber} — ${prResult.prUrl}`);
        notify('PR Created', `PR for "${task.title}" is ready for review`, config);

        recordConvention(memory, `task:${task.id}:pr`, `PR #${prResult.prNumber} created successfully`);
        saveMemory(configDir, memory);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger?.error(`PR creation failed: ${errorMessage}`);
        createAndBroadcastEvent(
          task.id,
          'pr_creation_failed',
          JSON.stringify({ error: errorMessage })
        );
      }
    }

    // ── Auto-merge evaluation ────────────────────────────────────────
    const autoMergeDecision = evaluateAutoMerge(db, task, config);

    if (autoMergeDecision.canAutoMerge) {
      // Auto-advance to done — skip human review
      updateTask(db, task.id, { status: 'done' });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(
        task.id,
        'auto_merged',
        JSON.stringify({
          reviewCycles: reviewCycle,
          reasons: ['All review criteria met for auto-merge'],
        })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'done' });
      notify('Task Auto-Merged', `"${task.title}" passed all gates and was auto-merged`, config);

      // Record learning for successful auto-merged task
      const successMetrics = collectTaskMetrics(db, task, 'success');
      recordLearning(configDir, successMetrics);

      // Fire-and-forget: non-blocking learning extraction
      extractLearnings(successMetrics, worktreePath, config.modelDefaults.learning, createLogStreamer(task.id, `learning-${task.id}`, logger))
        .then(result => { if (result.saved) console.log(`[learner] Extracted skill "${result.pattern}" for task ${task.id}`); })
        .catch(() => { /* already logged inside extractLearnings */ });

      await checkAndUpdateParentStatus(task);
      await runHook(hooks, 'onTaskComplete', makeHookContext(task, 'pr_creation', worktreePath, config));
      return;
    }

    // Move to needs_human_review
    updateTask(db, task.id, { status: 'needs_human_review' });
    unclaimTask(db, task.id);
    await checkAndUpdateParentStatus(task);
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({
        from: task.status,
        to: 'needs_human_review',
        reviewCycles: reviewCycle,
        autoMergeReasons: autoMergeDecision.reasons,
      })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'needs_human_review' });
    notify('Task Complete', `"${task.title}" is ready for human review`, config);

    // Record learning for successful task (pending human review)
    const successMetrics = collectTaskMetrics(db, task, 'success');
    recordLearning(configDir, successMetrics);

    // Fire-and-forget: non-blocking learning extraction
    extractLearnings(successMetrics, worktreePath, config.modelDefaults.learning, createLogStreamer(task.id, `learning-${task.id}`, logger))
      .then(result => { if (result.saved) console.log(`[learner] Extracted skill "${result.pattern}" for task ${task.id}`); })
      .catch(() => { /* already logged inside extractLearnings */ });

    await runHook(hooks, 'onTaskComplete', makeHookContext(task, 'pr_creation', worktreePath, config));
  }

  /**
   * Process a single task through the planning stage.
   */
  async function processTask(task: Task): Promise<void> {
    let worktreePath: string | undefined;
    let branchName: string | undefined;
    let isSubtask = false;
    let repoPath: string | undefined;
    let logger: TaskLogger | undefined;

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
        projectConfig = normalizeConfig(JSON.parse(raw));
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

        // Subtasks append to parent's log file
        const parentLog = getTaskLogByTaskId(db, task.parentTaskId);
        if (parentLog) {
          logger = openTaskLogger(parentLog.logPath);
          // Find subtask index among siblings
          const siblings = getSubtasksByParentId(db, task.parentTaskId);
          const index = siblings.findIndex(s => s.id === task.id) + 1;
          logger.subtaskStart(index, siblings.length, task.title, task.id);
        }

        const parentGitRefs = listGitRefsByTask(db, task.parentTaskId);
        if (parentGitRefs.length > 0 && parentGitRefs[0].worktreePath) {
          worktreePath = parentGitRefs[0].worktreePath;

          // Subtasks are fully autonomous — run ralph loop, go directly to done/failed
          await processSubtask(task, worktreePath, projectConfig, projectConfigDir, logger);

          // Update parent log size
          if (parentLog) {
            updateTaskLogSize(db, parentLog.id, logger?.sizeBytes() ?? 0);
          }
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
      branchName = branch;

      // Record git ref in DB
      createGitRef(db, {
        taskId: task.id,
        branch,
        worktreePath,
        status: 'local',
      });

      // Create persistent task logger
      logger = createTaskLogger(projectConfigDir, task.id, task.title, task.riskLevel);
      const taskLogRecord = createTaskLog(db, {
        taskId: task.id,
        projectId: task.projectId,
        logPath: logger.logPath,
      });

      // Check if plan was already approved (task returning from needs_plan_review)
      const existingPlanRun = getLatestRunByTaskAndStage(db, task.id, 'planning');
      const events = listEventsByTask(db, task.id);
      const planApproved = events.some((e) => e.type === 'plan_review_approved');

      if (existingPlanRun?.status === 'success' && planApproved) {
        // Plan was approved by engineer — skip planning, proceed to implementation
        console.log(`[worker] Task ${task.id} has approved plan — skipping planning`);

        // Check for edited subtasks from the approval event
        const approvalEvent = [...events].reverse().find((e) => e.type === 'plan_review_approved');
        let subtasksToCreate: Array<{ title: string; description: string }> = [];

        if (approvalEvent) {
          try {
            const payload = JSON.parse(approvalEvent.payload) as {
              edits?: { subtasks?: Array<{ title: string; description: string }> };
            };
            if (payload.edits?.subtasks) {
              subtasksToCreate = payload.edits.subtasks;
            }
          } catch { /* use plan result subtasks */ }
        }

        // Fall back to original plan subtasks if no edits
        if (subtasksToCreate.length === 0 && existingPlanRun.output) {
          try {
            const planOutput = JSON.parse(existingPlanRun.output) as {
              subtasks?: Array<{ title: string; description: string }>;
            };
            if (planOutput.subtasks) {
              subtasksToCreate = planOutput.subtasks;
            }
          } catch { /* proceed without subtasks */ }
        }

        // Create subtasks if the plan has them
        if (subtasksToCreate.length > 0) {
          const MAX_SUBTASKS = 10;
          const cappedSubtasks = subtasksToCreate.slice(0, MAX_SUBTASKS);
          if (subtasksToCreate.length > MAX_SUBTASKS) {
            console.warn(`[worker] Plan has ${subtasksToCreate.length} subtasks for task ${task.id}, capping at ${MAX_SUBTASKS}`);
          }

          for (let i = 0; i < cappedSubtasks.length; i++) {
            const subtask = cappedSubtasks[i];
            const childTask = createTask(db, {
              projectId: task.projectId,
              parentTaskId: task.id,
              title: subtask.title,
              description: subtask.description,
              status: i === 0 ? 'ready' : 'backlog',
              priority: task.priority,
              riskLevel: task.riskLevel,
            });
            createAndBroadcastEvent(
              childTask.id,
              'task_created',
              JSON.stringify({ parentTaskId: task.id, index: i })
            );
            broadcast(io, 'task:created', { task: childTask });
          }

          updateTask(db, task.id, { status: 'implementing', blockedReason: null });
          logger.event('subtasks_created', `${cappedSubtasks.length} subtask(s) created — executing serially`);
          createAndBroadcastEvent(
            task.id,
            'subtasks_created',
            JSON.stringify({ count: cappedSubtasks.length })
          );
          broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });
          unclaimTask(db, task.id);
          return;
        }

        // No subtasks — proceed directly to implementation
      } else {
        // No approved plan yet — run planning, then pause for review

        // Move to planning
        updateTask(db, task.id, { status: 'planning' });
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({ from: 'ready', to: 'planning' })
        );
        broadcast(io, 'task:updated', { taskId: task.id, status: 'planning' });

        // Run planning stage
        await runHook(hooks, 'beforeStage', makeHookContext(task, 'planning', worktreePath, projectConfig));
        logger.stageStart('planning', `planning-${task.id}`, 1, projectConfig.modelDefaults.planning);
        const planResult = await runPlanning(db, task, worktreePath, projectConfig, createLogStreamer(task.id, `planning-${task.id}`, logger));
        logger.stageEnd('success');
        await runHook(hooks, 'afterStage', makeHookContext(task, 'planning', worktreePath, projectConfig));

        // Log assumptions if any were made
        if (planResult.assumptions.length > 0) {
          console.log(`[worker] Task ${task.id} planner made ${planResult.assumptions.length} assumption(s):`);
          for (const assumption of planResult.assumptions) {
            console.log(`[worker]   - ${assumption}`);
          }
          createAndBroadcastEvent(
            task.id,
            'assumptions_made',
            JSON.stringify({ assumptions: planResult.assumptions })
          );

          const planningRun = getLatestRunByTaskAndStage(db, task.id, 'planning');
          if (planningRun) {
            createArtifact(db, {
              runId: planningRun.id,
              type: 'assumptions',
              name: 'planning_assumptions',
              content: JSON.stringify(planResult.assumptions),
            });
          }
        }

        // Pause for engineer plan review — do NOT proceed to implementation
        updateTask(db, task.id, { status: 'needs_plan_review' });
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({ from: 'planning', to: 'needs_plan_review' })
        );
        broadcast(io, 'task:updated', { taskId: task.id, status: 'needs_plan_review' });
        logger.event('plan_review_requested', 'Plan generated — awaiting engineer review');
        console.log(`[worker] Task ${task.id} plan complete — pausing for engineer review`);
        unclaimTask(db, task.id);
        return;
      }

      // No subtasks — proceed to implementation
      await runImplementationLoop(task, worktreePath, projectConfig, io, db, memory, projectConfigDir, logger);

      // Update log file size in DB
      updateTaskLogSize(db, taskLogRecord.id, logger.sizeBytes());
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[worker] Task ${task.id} failed:`, errorMessage);
      logger?.error(errorMessage);

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
      await checkAndUpdateParentStatus(task);

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
          await cleanupWorktree(repoPath, worktreePath, branchName);
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

      // Cleanup old log files across all projects
      try {
        const projects = listProjects(db);
        for (const project of projects) {
          const configDir = path.join(project.path, '.agentboard');
          cleanupOldLogs(configDir);
        }
      } catch (e) {
        console.error('[worker] Log cleanup error:', e);
      }

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
