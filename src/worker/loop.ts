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
import { createPR } from './stages/pr-creator.js';
import { runSpecReview } from './stages/spec-review.js';
import { runCodeQuality } from './stages/code-quality.js';
import { runFinalReview } from './stages/final-review.js';
import { runInlineFix } from './inline-fix.js';
import { createHooks, loadRufloHooks, runHook } from './hooks.js';
import type { HookContext } from './hooks.js';
import { loadMemory, saveMemory, recordFailure, recordConvention } from './memory.js';
import type { WorkerMemory } from './memory.js';
import { notify } from './notifications.js';
import { normalizeConfig } from './config-compat.js';
import { evaluateAutoMerge } from './auto-merge.js';
import { collectTaskMetrics, recordLearning, extractLearnings } from './stages/learner.js';
import { createTaskLogger, openTaskLogger, cleanupOldLogs, createBufferedWriter } from './log-writer.js';
import type { TaskLogger } from './log-writer.js';
import { createStageRunner } from './stage-runner.js';
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

    // If all subtasks succeeded, run final review + PR creation for the parent
    if (!anyFailed) {
      const parentGitRefs = listGitRefsByTask(db, task.parentTaskId);
      if (parentGitRefs.length > 0 && parentGitRefs[0].worktreePath) {
        const worktreePath = parentGitRefs[0].worktreePath;

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

          const parentTaskLog = getTaskLogByTaskId(db, parent.id);
          const parentLogger = parentTaskLog ? openTaskLogger(parentTaskLog.logPath) : undefined;
          const memory = loadMemory(projectConfigDir);

          // Claim the parent so runFinalReviewAndPR can update its status
          claimTask(db, parent.id, WORKER_ID);

          try {
            await runFinalReviewAndPR(parent, worktreePath, projectConfig, projectConfigDir, memory, parentLogger);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            parentLogger?.error(`Final review / PR creation failed: ${errorMessage}`);
            createAndBroadcastEvent(parent.id, 'task_error', JSON.stringify({ error: errorMessage }));
            // Fall through to set parent status below
          }

          if (parentTaskLog) {
            updateTaskLogSize(db, parentTaskLog.id, parentLogger?.sizeBytes() ?? 0);
          }

          // runFinalReviewAndPR already set the parent status — return early
          return;
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
  function createLogStreamer(
    taskId: number,
    runId: string,
    logger?: TaskLogger,
    stage?: string,
    subtaskId?: number
  ): (chunk: string) => void {
    return (chunk: string) => {
      broadcastLog(io, {
        taskId,
        runId,
        stage,
        subtaskId,
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
    taskId: number,
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
   * Process a subtask through the new per-subtask pipeline:
   * implement (single shot) → checks → inline fix (if fail) → code_quality
   *
   * Subtasks go directly to done/failed — no final review, no PR creation,
   * no auto-merge evaluation.
   */
  async function processSubtaskV2(
    task: Task,
    worktreePath: string,
    taskConfig: AgentboardConfig,
    configDir: string,
    logger?: TaskLogger
  ): Promise<void> {
    const onOutput = createLogStreamer(task.id, `subtask-${task.id}`, logger);

    // Create StageRunner scoped to the subtask
    const project = getProjectById(db, task.projectId);
    const subtaskStageRunner = createStageRunner({
      taskId: task.parentTaskId ?? task.id,
      projectId: task.projectId,
      subtaskId: task.id,
      io,
      db,
      logsDir: path.join(configDir, 'logs'),
      projectRoot: project?.path ?? configDir,
    });

    // ── Step 1: Single-shot implementation ─────────────────────────
    await runHook(hooks, 'beforeStage', makeHookContext(task, 'implementing', worktreePath, taskConfig));
    updateTask(db, task.id, { status: 'implementing' });
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({ from: 'ready', to: 'implementing' })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

    logger?.stageStart('implementing', `impl-${task.id}`, 1, taskConfig.modelDefaults.implementation);
    const implResult = await subtaskStageRunner.execute('implementing', (stageOnOutput) =>
      runImplementation(db, task, worktreePath, taskConfig, 1, stageOnOutput),
      { summarize: (r) => ({ summary: r.status === 'DONE' ? 'Implementation complete' : `Status: ${r.status}` }) }
    );
    const implSuccess = implResult.status === 'DONE' || implResult.status === 'DONE_WITH_CONCERNS';
    logger?.stageEnd(implSuccess ? 'success' : implResult.status.toLowerCase());
    await runHook(hooks, 'afterStage', makeHookContext(task, 'implementing', worktreePath, taskConfig));

    // ── Status check ───────────────────────────────────────────────
    if (implResult.status === 'NEEDS_CONTEXT') {
      const reason = implResult.contextNeeded?.join('; ') ?? 'Implementation needs additional context';
      updateTask(db, task.id, { status: 'blocked', blockedReason: reason });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: 'implementing', to: 'blocked', reason })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'blocked' });
      await checkAndUpdateParentStatus(task);
      return;
    }

    if (implResult.status === 'BLOCKED') {
      const reason = implResult.blockerReason ?? 'Implementation is blocked';
      updateTask(db, task.id, { status: 'blocked', blockedReason: reason });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: 'implementing', to: 'blocked', reason })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'blocked' });
      await checkAndUpdateParentStatus(task);
      return;
    }

    // ── Step 2: Checks ─────────────────────────────────────────────
    updateTask(db, task.id, { status: 'checks' });
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({ from: 'implementing', to: 'checks' })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'checks' });

    logger?.stageStart('checks', `checks-${task.id}`, 1, 'n/a');
    const checksResult = await subtaskStageRunner.execute('checks', (stageOnOutput) =>
      runChecks(db, task, worktreePath, taskConfig, stageOnOutput),
      { summarize: (r) => ({ summary: r.passed ? 'All checks passed' : `${r.results.filter(c => !c.passed).length} check(s) failed` }) }
    );
    logger?.stageEnd(checksResult.passed ? 'passed' : 'failed');

    let checksPassed = checksResult.passed;

    // ── Step 2b: Inline fix if checks failed ───────────────────────
    if (!checksPassed) {
      createAndBroadcastEvent(
        task.id,
        'checks_failed',
        JSON.stringify({ failedChecks: checksResult.results.filter(r => !r.passed).map(r => r.name) })
      );
      logger?.event('checks_failed', 'Attempting inline fix');

      const failedChecks = checksResult.results.filter(r => !r.passed);
      const fixResult = await subtaskStageRunner.execute('inline_fix', (stageOnOutput) =>
        runInlineFix({
          db,
          task,
          worktreePath,
          config: taskConfig,
          failedChecks,
          onOutput: stageOnOutput,
        }),
        { summarize: (r) => ({ summary: r.fixed ? 'Fix applied successfully' : 'Fix attempt failed' }) }
      );

      if (fixResult.fixed) {
        checksPassed = true;
        createAndBroadcastEvent(task.id, 'inline_fix_passed', JSON.stringify({ output: fixResult.output.slice(0, 500) }));
        logger?.event('inline_fix_passed', 'Checks pass after inline fix');
      } else {
        // Inline fix failed → block the task
        updateTask(db, task.id, { status: 'blocked', blockedReason: 'Checks failed after inline fix attempt' });
        unclaimTask(db, task.id);
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({ from: 'checks', to: 'blocked', reason: 'inline_fix_failed' })
        );
        broadcast(io, 'task:updated', { taskId: task.id, status: 'blocked' });

        const failedMetrics = collectTaskMetrics(db, task, 'failed');
        recordLearning(configDir, failedMetrics);
        await checkAndUpdateParentStatus(task);
        return;
      }
    }

    // ── Step 3: Code quality review ────────────────────────────────
    await commitChanges(worktreePath, `feat: implement ${task.title}`);

    const MAX_QUALITY_CYCLES = 2;
    let qualityCycle = 0;
    let qualityPassed = false;

    while (qualityCycle < MAX_QUALITY_CYCLES) {
      qualityCycle++;

      updateTask(db, task.id, { status: 'code_quality' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: qualityCycle === 1 ? 'checks' : 'implementing', to: 'code_quality', cycle: qualityCycle })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'code_quality' });

      logger?.stageStart('code_quality', `quality-${task.id}`, qualityCycle, taskConfig.modelDefaults.review);
      const qualityResult = await subtaskStageRunner.execute('code_quality', (stageOnOutput) =>
        runCodeQuality(db, task, worktreePath, taskConfig, stageOnOutput),
        { attempt: qualityCycle, summarize: (r) => ({ summary: r.passed ? 'Quality passed' : `${r.issues.length} issue(s): ${r.summary}` }) }
      );
      logger?.stageEnd(qualityResult.passed ? 'passed' : 'failed');

      if (qualityResult.passed) {
        qualityPassed = true;
        createAndBroadcastEvent(task.id, 'code_quality_passed', JSON.stringify({ cycle: qualityCycle, summary: qualityResult.summary }));
        break;
      }

      // Check if only minor issues (those are acceptable)
      const hasCriticalOrImportant = qualityResult.issues.some(
        i => i.severity === 'critical' || i.severity === 'important'
      );
      if (!hasCriticalOrImportant) {
        qualityPassed = true;
        createAndBroadcastEvent(task.id, 'code_quality_passed', JSON.stringify({ cycle: qualityCycle, summary: qualityResult.summary, minorOnly: true }));
        break;
      }

      if (qualityCycle >= MAX_QUALITY_CYCLES) break;

      // Re-dispatch implementer to fix quality issues
      createAndBroadcastEvent(
        task.id,
        'code_quality_issues',
        JSON.stringify({ cycle: qualityCycle, issues: qualityResult.issues })
      );

      updateTask(db, task.id, { status: 'implementing' });
      broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

      logger?.stageStart('implementing', `quality-fix-${task.id}`, qualityCycle + 1, taskConfig.modelDefaults.implementation);
      const fixResult = await subtaskStageRunner.execute('implementing', (stageOnOutput) =>
        runImplementation(db, task, worktreePath, taskConfig, qualityCycle + 1, stageOnOutput),
        { attempt: qualityCycle + 1, summarize: (r) => ({ summary: r.status === 'DONE' ? 'Quality fix applied' : `Status: ${r.status}` }) }
      );
      const fixSuccess = fixResult.status === 'DONE' || fixResult.status === 'DONE_WITH_CONCERNS';
      logger?.stageEnd(fixSuccess ? 'success' : 'failed');

      if (!fixSuccess) break;

      await commitChanges(worktreePath, `fix: address code quality issues (cycle ${qualityCycle})`);
    }

    if (!qualityPassed) {
      updateTask(db, task.id, { status: 'blocked', blockedReason: 'Code quality review failed after maximum cycles' });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: 'code_quality', to: 'blocked', reason: 'quality_cycles_exhausted' })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'blocked' });

      const failedMetrics = collectTaskMetrics(db, task, 'failed');
      recordLearning(configDir, failedMetrics);
      await checkAndUpdateParentStatus(task);
      return;
    }

    // ── Subtask done ───────────────────────────────────────────────
    updateTask(db, task.id, { status: 'done' });
    unclaimTask(db, task.id);
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({ from: 'code_quality', to: 'done', reason: 'subtask_completed' })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'done' });

    const metrics = collectTaskMetrics(db, task, 'success');
    recordLearning(configDir, metrics);

    // Fire-and-forget: non-blocking learning extraction
    extractLearnings(metrics, worktreePath, taskConfig.modelDefaults.learning, createLogStreamer(task.id, `learning-${task.id}`, logger))
      .then(result => { if (result.saved) console.log(`[learner] Extracted skill "${result.pattern}" for task ${task.id}`); })
      .catch(() => { /* already logged inside extractLearnings */ });

    await checkAndUpdateParentStatus(task);
  }

  /**
   * Run the per-subtask pipeline for a top-level task (no subtasks):
   * implement → checks → inline fix (if fail) → code_quality → commit
   */
  async function runSubtaskPipeline(
    task: Task,
    worktreePath: string,
    taskConfig: AgentboardConfig,
    configDir: string,
    logger?: TaskLogger
  ): Promise<void> {
    const onOutput = createLogStreamer(task.id, `impl-${task.id}`, logger);

    // Create StageRunner for top-level task pipeline (no subtaskId)
    const project = getProjectById(db, task.projectId);
    const pipelineStageRunner = createStageRunner({
      taskId: task.id,
      projectId: task.projectId,
      io,
      db,
      logsDir: path.join(configDir, 'logs'),
      projectRoot: project?.path ?? configDir,
    });

    // ── Step 1: Implementation ─────────────────────────────────────
    updateTask(db, task.id, { status: 'implementing' });
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({ from: 'planning', to: 'implementing' })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

    await runHook(hooks, 'beforeStage', makeHookContext(task, 'implementing', worktreePath, taskConfig));
    logger?.stageStart('implementing', `impl-${task.id}`, 1, taskConfig.modelDefaults.implementation);
    const implResult = await pipelineStageRunner.execute('implementing', (stageOnOutput) =>
      runImplementation(db, task, worktreePath, taskConfig, 1, stageOnOutput),
      { summarize: (r) => ({ summary: r.status === 'DONE' ? 'Implementation complete' : `Status: ${r.status}` }) }
    );
    const implSuccess = implResult.status === 'DONE' || implResult.status === 'DONE_WITH_CONCERNS';
    logger?.stageEnd(implSuccess ? 'success' : implResult.status.toLowerCase());
    await runHook(hooks, 'afterStage', makeHookContext(task, 'implementing', worktreePath, taskConfig));

    if (implResult.status === 'NEEDS_CONTEXT') {
      const reason = implResult.contextNeeded?.join('; ') ?? 'Implementation needs additional context';
      updateTask(db, task.id, { status: 'blocked', blockedReason: reason });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(task.id, 'status_changed', JSON.stringify({ from: 'implementing', to: 'blocked', reason }));
      broadcast(io, 'task:updated', { taskId: task.id, status: 'blocked' });
      await runHook(hooks, 'onError', makeHookContext(task, 'implementing', worktreePath, taskConfig));
      return;
    }

    if (implResult.status === 'BLOCKED') {
      const reason = implResult.blockerReason ?? 'Implementation is blocked';
      updateTask(db, task.id, { status: 'blocked', blockedReason: reason });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(task.id, 'status_changed', JSON.stringify({ from: 'implementing', to: 'blocked', reason }));
      broadcast(io, 'task:updated', { taskId: task.id, status: 'blocked' });
      await runHook(hooks, 'onError', makeHookContext(task, 'implementing', worktreePath, taskConfig));
      return;
    }

    // ── Step 2: Checks ─────────────────────────────────────────────
    updateTask(db, task.id, { status: 'checks' });
    createAndBroadcastEvent(task.id, 'status_changed', JSON.stringify({ from: 'implementing', to: 'checks' }));
    broadcast(io, 'task:updated', { taskId: task.id, status: 'checks' });

    logger?.stageStart('checks', `checks-${task.id}`, 1, 'n/a');
    const checksResult = await pipelineStageRunner.execute('checks', (stageOnOutput) =>
      runChecks(db, task, worktreePath, taskConfig, stageOnOutput),
      { summarize: (r) => ({ summary: r.passed ? 'All checks passed' : `${r.results.filter(c => !c.passed).length} check(s) failed` }) }
    );
    logger?.stageEnd(checksResult.passed ? 'passed' : 'failed');

    let checksPassed = checksResult.passed;

    if (!checksPassed) {
      createAndBroadcastEvent(
        task.id,
        'checks_failed',
        JSON.stringify({ failedChecks: checksResult.results.filter(r => !r.passed).map(r => r.name) })
      );
      logger?.event('checks_failed', 'Attempting inline fix');

      const failedChecks = checksResult.results.filter(r => !r.passed);
      const fixResult = await pipelineStageRunner.execute('inline_fix', (stageOnOutput) =>
        runInlineFix({
          db,
          task,
          worktreePath,
          config: taskConfig,
          failedChecks,
          onOutput: stageOnOutput,
        }),
        { summarize: (r) => ({ summary: r.fixed ? 'Fix applied successfully' : 'Fix attempt failed' }) }
      );

      if (fixResult.fixed) {
        checksPassed = true;
        createAndBroadcastEvent(task.id, 'inline_fix_passed', JSON.stringify({ output: fixResult.output.slice(0, 500) }));
        logger?.event('inline_fix_passed', 'Checks pass after inline fix');
      } else {
        updateTask(db, task.id, { status: 'blocked', blockedReason: 'Checks failed after inline fix attempt' });
        unclaimTask(db, task.id);
        createAndBroadcastEvent(task.id, 'status_changed', JSON.stringify({ from: 'checks', to: 'blocked', reason: 'inline_fix_failed' }));
        broadcast(io, 'task:updated', { taskId: task.id, status: 'blocked' });
        notify('Task Blocked', `"${task.title}" blocked: checks failed after inline fix`, taskConfig);

        const failedMetrics = collectTaskMetrics(db, task, 'failed');
        recordLearning(configDir, failedMetrics);
        await runHook(hooks, 'onError', makeHookContext(task, 'checks', worktreePath, taskConfig));
        return;
      }
    }

    // ── Step 3: Code quality review ────────────────────────────────
    await commitChanges(worktreePath, `feat: implement ${task.title}`);

    const MAX_QUALITY_CYCLES = 2;
    let qualityCycle = 0;
    let qualityPassed = false;

    while (qualityCycle < MAX_QUALITY_CYCLES) {
      qualityCycle++;

      updateTask(db, task.id, { status: 'code_quality' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: qualityCycle === 1 ? 'checks' : 'implementing', to: 'code_quality', cycle: qualityCycle })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'code_quality' });

      await runHook(hooks, 'beforeStage', makeHookContext(task, 'code_quality', worktreePath, taskConfig));
      logger?.stageStart('code_quality', `quality-${task.id}`, qualityCycle, taskConfig.modelDefaults.review);
      const qualityResult = await pipelineStageRunner.execute('code_quality', (stageOnOutput) =>
        runCodeQuality(db, task, worktreePath, taskConfig, stageOnOutput),
        { attempt: qualityCycle, summarize: (r) => ({ summary: r.passed ? 'Quality passed' : `${r.issues.length} issue(s): ${r.summary}` }) }
      );
      logger?.stageEnd(qualityResult.passed ? 'passed' : 'failed');
      await runHook(hooks, 'afterStage', makeHookContext(task, 'code_quality', worktreePath, taskConfig));

      if (qualityResult.passed) {
        qualityPassed = true;
        createAndBroadcastEvent(task.id, 'code_quality_passed', JSON.stringify({ cycle: qualityCycle, summary: qualityResult.summary }));
        break;
      }

      const hasCriticalOrImportant = qualityResult.issues.some(
        i => i.severity === 'critical' || i.severity === 'important'
      );
      if (!hasCriticalOrImportant) {
        qualityPassed = true;
        createAndBroadcastEvent(task.id, 'code_quality_passed', JSON.stringify({ cycle: qualityCycle, summary: qualityResult.summary, minorOnly: true }));
        break;
      }

      if (qualityCycle >= MAX_QUALITY_CYCLES) break;

      createAndBroadcastEvent(task.id, 'code_quality_issues', JSON.stringify({ cycle: qualityCycle, issues: qualityResult.issues }));

      updateTask(db, task.id, { status: 'implementing' });
      broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

      logger?.stageStart('implementing', `quality-fix-${task.id}`, qualityCycle + 1, taskConfig.modelDefaults.implementation);
      const fixResult = await pipelineStageRunner.execute('implementing', (stageOnOutput) =>
        runImplementation(db, task, worktreePath, taskConfig, qualityCycle + 1, stageOnOutput),
        { attempt: qualityCycle + 1, summarize: (r) => ({ summary: r.status === 'DONE' ? 'Quality fix applied' : `Status: ${r.status}` }) }
      );
      const fixSuccess = fixResult.status === 'DONE' || fixResult.status === 'DONE_WITH_CONCERNS';
      logger?.stageEnd(fixSuccess ? 'success' : 'failed');

      if (!fixSuccess) break;

      await commitChanges(worktreePath, `fix: address code quality issues (cycle ${qualityCycle})`);
    }

    if (!qualityPassed) {
      updateTask(db, task.id, { status: 'failed' });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(task.id, 'status_changed', JSON.stringify({ from: 'code_quality', to: 'failed', reason: 'quality_cycles_exhausted' }));
      broadcast(io, 'task:updated', { taskId: task.id, status: 'failed' });
      notify('Task Failed', `"${task.title}" failed: code quality review exhausted`, taskConfig);

      const failedMetrics = collectTaskMetrics(db, task, 'failed');
      recordLearning(configDir, failedMetrics);
      await runHook(hooks, 'onError', makeHookContext(task, 'code_quality', worktreePath, taskConfig));
      return;
    }
  }

  /**
   * Run the final review and PR creation after all subtasks complete
   * (or after the subtask pipeline for a top-level task without subtasks).
   *
   * 1. Final review against spec + acceptance criteria
   * 2. If fail → one targeted fix attempt → re-review (max 2 tries)
   * 3. If pass → createPR → evaluateAutoMerge → done or needs_human_review
   */
  async function runFinalReviewAndPR(
    task: Task,
    worktreePath: string,
    taskConfig: AgentboardConfig,
    configDir: string,
    memory: WorkerMemory,
    logger?: TaskLogger
  ): Promise<void> {
    const onOutput = createLogStreamer(task.id, `final-${task.id}`, logger);

    // Create StageRunner for final review / PR / learner stages
    const project = getProjectById(db, task.projectId);
    const frStageRunner = createStageRunner({
      taskId: task.id,
      projectId: task.projectId,
      io,
      db,
      logsDir: path.join(configDir, 'logs'),
      projectRoot: project?.path ?? configDir,
    });

    const MAX_FINAL_REVIEW_ATTEMPTS = 2;
    let attempt = 0;
    let reviewPassed = false;

    while (attempt < MAX_FINAL_REVIEW_ATTEMPTS) {
      attempt++;

      updateTask(db, task.id, { status: 'final_review' });
      createAndBroadcastEvent(
        task.id,
        'status_changed',
        JSON.stringify({ from: attempt === 1 ? 'code_quality' : 'implementing', to: 'final_review', attempt })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'final_review' });

      await runHook(hooks, 'beforeStage', makeHookContext(task, 'final_review', worktreePath, taskConfig));
      logger?.stageStart('final_review', `final-review-${task.id}`, attempt, taskConfig.modelDefaults.review);
      const reviewResult = await frStageRunner.execute('final_review', (stageOnOutput) =>
        runFinalReview(db, task, worktreePath, taskConfig, stageOnOutput),
        { attempt, summarize: (r) => ({ summary: r.passed ? 'Review passed' : `Failed: ${r.summary}` }) }
      );
      logger?.stageEnd(reviewResult.passed ? 'passed' : 'failed');
      await runHook(hooks, 'afterStage', makeHookContext(task, 'final_review', worktreePath, taskConfig));

      if (reviewResult.passed) {
        reviewPassed = true;
        createAndBroadcastEvent(
          task.id,
          'final_review_passed',
          JSON.stringify({ attempt, summary: reviewResult.summary })
        );
        break;
      }

      createAndBroadcastEvent(
        task.id,
        'final_review_failed',
        JSON.stringify({
          attempt,
          missingRequirements: reviewResult.specCompliance.missingRequirements,
          integrationIssues: reviewResult.integrationIssues,
          summary: reviewResult.summary,
        })
      );

      if (attempt >= MAX_FINAL_REVIEW_ATTEMPTS) break;

      // Targeted fix attempt
      updateTask(db, task.id, { status: 'implementing' });
      broadcast(io, 'task:updated', { taskId: task.id, status: 'implementing' });

      logger?.stageStart('implementing', `final-fix-${task.id}`, attempt + 1, taskConfig.modelDefaults.implementation);
      const fixResult = await runImplementation(db, task, worktreePath, taskConfig, attempt + 1, onOutput);
      const fixSuccess = fixResult.status === 'DONE' || fixResult.status === 'DONE_WITH_CONCERNS';
      logger?.stageEnd(fixSuccess ? 'success' : 'failed');

      if (!fixSuccess) break;

      await commitChanges(worktreePath, `fix: address final review issues (attempt ${attempt})`);
    }

    if (!reviewPassed) {
      updateTask(db, task.id, { status: 'failed' });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(task.id, 'status_changed', JSON.stringify({ from: 'final_review', to: 'failed', reason: 'final_review_exhausted' }));
      broadcast(io, 'task:updated', { taskId: task.id, status: 'failed' });
      notify('Task Failed', `"${task.title}" failed: final review exhausted`, taskConfig);

      const failedMetrics = collectTaskMetrics(db, task, 'failed');
      recordLearning(configDir, failedMetrics);

      frStageRunner.execute('learner', (stageOnOutput) =>
        extractLearnings(failedMetrics, worktreePath, taskConfig.modelDefaults.learning, stageOnOutput),
        { summarize: (r) => ({ summary: r.saved ? `Extracted: ${r.pattern}` : 'No patterns found' }) }
      ).catch(() => { /* already logged */ });

      await checkAndUpdateParentStatus(task);
      await runHook(hooks, 'onError', makeHookContext(task, 'final_review', worktreePath, taskConfig));
      return;
    }

    // ── PR creation ────────────────────────────────────────────────
    if (!task.parentTaskId) {
      try {
        await runHook(hooks, 'beforeStage', makeHookContext(task, 'pr_creation', worktreePath, taskConfig));
        logger?.stageStart('pr_creation', `pr-${task.id}`, 1, 'n/a');
        const prResult = await frStageRunner.execute('pr_creation', (stageOnOutput) =>
          createPR(db, task, worktreePath, taskConfig, stageOnOutput),
          { summarize: (r) => ({ summary: `PR #${r.prNumber} created` }) }
        );
        logger?.stageEnd('success');
        await runHook(hooks, 'afterStage', makeHookContext(task, 'pr_creation', worktreePath, taskConfig));

        createAndBroadcastEvent(
          task.id,
          'pr_created',
          JSON.stringify({ prUrl: prResult.prUrl, prNumber: prResult.prNumber })
        );
        logger?.event('pr_created', `PR #${prResult.prNumber} — ${prResult.prUrl}`);
        notify('PR Created', `PR for "${task.title}" is ready for review`, taskConfig);

        recordConvention(memory, `task:${task.id}:pr`, `PR #${prResult.prNumber} created successfully`);
        saveMemory(configDir, memory);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger?.error(`PR creation failed: ${errorMessage}`);
        createAndBroadcastEvent(task.id, 'pr_creation_failed', JSON.stringify({ error: errorMessage }));
      }
    }

    // ── Auto-merge evaluation ──────────────────────────────────────
    const autoMergeDecision = evaluateAutoMerge(db, task, taskConfig);

    if (autoMergeDecision.canAutoMerge) {
      updateTask(db, task.id, { status: 'done' });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(
        task.id,
        'auto_merged',
        JSON.stringify({ reasons: ['All review criteria met for auto-merge'] })
      );
      broadcast(io, 'task:updated', { taskId: task.id, status: 'done' });
      notify('Task Auto-Merged', `"${task.title}" passed all gates and was auto-merged`, taskConfig);

      const successMetrics = collectTaskMetrics(db, task, 'success');
      recordLearning(configDir, successMetrics);

      frStageRunner.execute('learner', (stageOnOutput) =>
        extractLearnings(successMetrics, worktreePath, taskConfig.modelDefaults.learning, stageOnOutput),
        { summarize: (r) => ({ summary: r.saved ? `Extracted: ${r.pattern}` : 'No patterns found' }) }
      ).catch(() => { /* already logged */ });

      await checkAndUpdateParentStatus(task);
      await runHook(hooks, 'onTaskComplete', makeHookContext(task, 'pr_creation', worktreePath, taskConfig));
      return;
    }

    // Move to needs_human_review
    updateTask(db, task.id, { status: 'needs_human_review' });
    unclaimTask(db, task.id);
    await checkAndUpdateParentStatus(task);
    createAndBroadcastEvent(
      task.id,
      'status_changed',
      JSON.stringify({ from: 'final_review', to: 'needs_human_review', autoMergeReasons: autoMergeDecision.reasons })
    );
    broadcast(io, 'task:updated', { taskId: task.id, status: 'needs_human_review' });
    notify('Task Complete', `"${task.title}" is ready for human review`, taskConfig);

    const successMetrics = collectTaskMetrics(db, task, 'success');
    recordLearning(configDir, successMetrics);

    frStageRunner.execute('learner', (stageOnOutput) =>
      extractLearnings(successMetrics, worktreePath, taskConfig.modelDefaults.learning, stageOnOutput),
      { summarize: (r) => ({ summary: r.saved ? `Extracted: ${r.pattern}` : 'No patterns found' }) }
    ).catch(() => { /* already logged */ });

    await runHook(hooks, 'onTaskComplete', makeHookContext(task, 'pr_creation', worktreePath, taskConfig));
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

      // Create StageRunner for parent-level stage logging
      const stageRunner = createStageRunner({
        taskId: task.id,
        projectId: task.projectId,
        io,
        db,
        logsDir: path.join(projectConfigDir, 'logs'),
        projectRoot: project.path,
      });

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

          // Subtasks are fully autonomous — run per-subtask pipeline
          await processSubtaskV2(task, worktreePath, projectConfig, projectConfigDir, logger);

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
        // No approved plan yet — run spec review, then planning, then pause for review

        // ── Spec review ──────────────────────────────────────────
        updateTask(db, task.id, { status: 'spec_review' });
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({ from: 'ready', to: 'spec_review' })
        );
        broadcast(io, 'task:updated', { taskId: task.id, status: 'spec_review' });

        await runHook(hooks, 'beforeStage', makeHookContext(task, 'spec_review', worktreePath, projectConfig));
        logger.stageStart('spec_review', `spec-review-${task.id}`, 1, 'n/a');
        const specResult = await stageRunner.execute('spec_review', (onOutput) =>
          runSpecReview(db, task, projectConfig, onOutput),
          { summarize: (r) => ({ summary: r.passed ? 'Spec approved' : `${r.issues.length} issues found` }) }
        );
        logger.stageEnd(specResult.passed ? 'passed' : 'failed');
        await runHook(hooks, 'afterStage', makeHookContext(task, 'spec_review', worktreePath, projectConfig));

        if (!specResult.passed) {
          const issuesSummary = specResult.issues.map(i => `[${i.severity}] ${i.field}: ${i.message}`).join('; ');
          updateTask(db, task.id, { status: 'blocked', blockedReason: issuesSummary });
          unclaimTask(db, task.id);
          createAndBroadcastEvent(
            task.id,
            'status_changed',
            JSON.stringify({ from: 'spec_review', to: 'blocked', reason: 'spec_review_failed', issues: specResult.issues })
          );
          broadcast(io, 'task:updated', { taskId: task.id, status: 'blocked' });
          logger.event('spec_review_blocked', issuesSummary);
          console.log(`[worker] Task ${task.id} blocked: spec review failed`);
          return;
        }

        createAndBroadcastEvent(
          task.id,
          'spec_review_passed',
          JSON.stringify({ suggestions: specResult.suggestions })
        );

        // ── Planning ─────────────────────────────────────────────
        updateTask(db, task.id, { status: 'planning' });
        createAndBroadcastEvent(
          task.id,
          'status_changed',
          JSON.stringify({ from: 'spec_review', to: 'planning' })
        );
        broadcast(io, 'task:updated', { taskId: task.id, status: 'planning' });

        // Run planning stage
        await runHook(hooks, 'beforeStage', makeHookContext(task, 'planning', worktreePath, projectConfig));
        logger.stageStart('planning', `planning-${task.id}`, 1, projectConfig.modelDefaults.planning);
        const planResult = await stageRunner.execute('planning', (onOutput) =>
          runPlanning(db, task, worktreePath!, projectConfig, onOutput),
          { summarize: (r) => ({ summary: r.planSummary ?? 'Plan created' }) }
        );
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

      // No subtasks — proceed to implementation pipeline + final review + PR
      await runSubtaskPipeline(task, worktreePath, projectConfig, projectConfigDir, logger);

      // If task is still in a non-terminal state after pipeline, run final review + PR
      const freshTask = getTaskById(db, task.id);
      const terminalOrBlocked: TaskStatus[] = ['done', 'failed', 'cancelled', 'blocked', 'needs_human_review'];
      if (freshTask && !terminalOrBlocked.includes(freshTask.status)) {
        await runFinalReviewAndPR(task, worktreePath, projectConfig, projectConfigDir, memory, logger);
      }

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
          runId: String(task.id),
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
