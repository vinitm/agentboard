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
  createArtifact,
  getLatestRunByTaskAndStage,
  listEventsByTask,
  getStaleClaimed,
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

import type { PlanningResult } from './stages/planner.js';

/**
 * Generate a conventional commit message based on task title content.
 * Detects fix/refactor/test/docs patterns in the title, defaults to feat.
 */
function smartCommitMessage(title: string): string {
  const lower = title.toLowerCase();
  let prefix = 'feat';

  if (/\b(fix|bug|patch|hotfix|resolve|repair)\b/.test(lower)) {
    prefix = 'fix';
  } else if (/\b(refactor|restructure|reorganize|clean\s?up|simplify)\b/.test(lower)) {
    prefix = 'refactor';
  } else if (/\b(test|spec|coverage)\b/.test(lower)) {
    prefix = 'test';
  } else if (/\b(doc|readme|changelog|comment)\b/.test(lower)) {
    prefix = 'docs';
  } else if (/\b(perf|optim|speed|fast)\b/.test(lower)) {
    prefix = 'perf';
  } else if (/\b(style|format|lint|whitespace)\b/.test(lower)) {
    prefix = 'style';
  } else if (/\b(chore|bump|dep|upgrade|update dep)\b/.test(lower)) {
    prefix = 'chore';
  }

  return `${prefix}: ${title}`;
}

const POLL_INTERVAL_MS = 5_000;
const WORKER_ID = `worker-${process.pid}`;

/**
 * Determine if a plan can be auto-approved without human review.
 *
 * Auto-approves when ALL conditions are met:
 * - config.autoPlanApproval is true
 * - task.riskLevel is 'low'
 * - Plan has <= 3 subtasks
 * - Plan has no assumptions
 * - Plan touches <= 5 files total
 * - Planner confidence >= 0.85
 */
function shouldAutoApprovePlan(
  task: Task,
  plan: PlanningResult,
  config: AgentboardConfig
): boolean {
  if (!config.autoPlanApproval) return false;
  if (task.riskLevel !== 'low') return false;
  if (plan.subtasks.length > 3) return false;
  if (plan.assumptions.length > 0) return false;
  if (plan.fileMap.length > 5) return false;
  if (plan.confidence < 0.85) return false;
  return true;
}

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

  // Subtask orchestration removed — tasks are now flat (no parent/child relationships)

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

      // Recover stale claimed tasks (claimed > 15 minutes ago)
      try {
        const staleTasks = getStaleClaimed(db, 15);
        for (const stale of staleTasks) {
          console.log(`[worker] Recovering stale claim on task ${stale.id} (claimed by ${stale.claimedBy} at ${stale.claimedAt})`);
          unclaimTask(db, stale.id);
          broadcast(io, 'task:updated', { taskId: stale.id, status: stale.status });
        }
      } catch (e) {
        console.error('[worker] Stale claim recovery error:', e);
      }

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
   * Run the implementation pipeline for a task:
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
      updateTask(db, task.id, { status: 'blocked', blockedReason: reason, blockedAtStage: 'implementing' });
      unclaimTask(db, task.id);
      createAndBroadcastEvent(task.id, 'status_changed', JSON.stringify({ from: 'implementing', to: 'blocked', reason }));
      broadcast(io, 'task:updated', { taskId: task.id, status: 'blocked' });
      await runHook(hooks, 'onError', makeHookContext(task, 'implementing', worktreePath, taskConfig));
      return;
    }

    if (implResult.status === 'BLOCKED') {
      const reason = implResult.blockerReason ?? 'Implementation is blocked';
      updateTask(db, task.id, { status: 'blocked', blockedReason: reason, blockedAtStage: 'implementing' });
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
        updateTask(db, task.id, { status: 'blocked', blockedReason: 'Checks failed after inline fix attempt', blockedAtStage: 'checks' });
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
    await commitChanges(worktreePath, smartCommitMessage(task.title));

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

      await runHook(hooks, 'onError', makeHookContext(task, 'final_review', worktreePath, taskConfig));
      return;
    }

    // ── PR creation ────────────────────────────────────────────────
    {
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

      await runHook(hooks, 'onTaskComplete', makeHookContext(task, 'pr_creation', worktreePath, taskConfig));
      return;
    }

    // Move to needs_human_review
    updateTask(db, task.id, { status: 'needs_human_review' });
    unclaimTask(db, task.id);
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

      // Check if task is resuming from a blocked stage
      const resumeFromStage = task.blockedAtStage;
      if (resumeFromStage) {
        // Clear the blocked_at_stage marker
        updateTask(db, task.id, { blockedAtStage: null });
        console.log(`[worker] Task ${task.id} resuming from blocked stage: ${resumeFromStage}`);
      }

      // Check if plan was already approved (task returning from needs_plan_review)
      const existingPlanRun = getLatestRunByTaskAndStage(db, task.id, 'planning');
      const events = listEventsByTask(db, task.id);
      const planApproved = events.some((e) => e.type === 'plan_review_approved');

      if (existingPlanRun?.status === 'success' && planApproved) {
        // Plan was approved by engineer — skip planning, proceed to implementation
        console.log(`[worker] Task ${task.id} has approved plan — skipping planning`);

        // Proceed directly to implementation (subtask creation removed)
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
          updateTask(db, task.id, { status: 'blocked', blockedReason: issuesSummary, blockedAtStage: 'spec_review' });
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

        // Check if the plan can be auto-approved (skip human gate for low-risk tasks)
        const canAutoApprove = shouldAutoApprovePlan(task, planResult, projectConfig);

        if (canAutoApprove) {
          console.log(`[worker] Task ${task.id} plan auto-approved (low-risk, confidence=${planResult.confidence})`);
          createAndBroadcastEvent(
            task.id,
            'plan_review_approved',
            JSON.stringify({ autoApproved: true, confidence: planResult.confidence })
          );
          logger.event('plan_auto_approved', `Plan auto-approved (confidence=${planResult.confidence})`);

          // Subtask creation removed — fall through to direct implementation below
        } else {
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
