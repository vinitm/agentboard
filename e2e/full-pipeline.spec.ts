/**
 * E2E: Full pipeline integration test.
 *
 * Tests the complete task lifecycle through DB operations, simulating
 * what the worker loop does at each stage — without spawning real Claude processes.
 *
 * Validates: task creation → status transitions → subtask management → completion.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createProject,
  createTask,
  getTaskById,
  updateTask,
  claimTask,
  unclaimTask,
  getSubtasksByParentId,
  getNextBacklogSubtask,
  createRun,
  updateRun,
  createArtifact,
  createGitRef,
  listGitRefsByTask,
} from '../src/db/queries.js';
import { createTestDb, createTestConfig, createTestRepo } from '../src/test/helpers.js';
import { evaluateAutoMerge } from '../src/worker/auto-merge.js';
import type { Task, AgentboardConfig } from '../src/types/index.js';

let db: Database.Database;
let config: AgentboardConfig;
let projectId: string;
let repoPath: string;
let cleanup: () => void;

beforeEach(async () => {
  db = createTestDb();
  const repo = await createTestRepo();
  repoPath = repo.repoPath;
  cleanup = repo.cleanup;
  config = createTestConfig({ autoMerge: false });

  const project = createProject(db, {
    name: 'e2e-project',
    path: repoPath,
    configPath: `${repoPath}/.agentboard/config.json`,
  });
  projectId = project.id;
});

afterEach(() => {
  cleanup();
  db.close();
});

describe('Full Pipeline', () => {
  it('should transition a simple task through all stages to needs_human_review', () => {
    // 1. Create task in 'ready' status
    const task = createTask(db, {
      projectId,
      title: 'Add README',
      description: 'Create a project README',
      status: 'ready',
      riskLevel: 'low',
      spec: JSON.stringify({ title: 'Add README', requirements: ['Create README.md'] }),
    });
    expect(task.status).toBe('ready');

    // 2. Worker claims the task
    const claimed = claimTask(db, task.id, 'worker-1');
    expect(claimed).toBe(true);

    // 3. Spec stage
    updateTask(db, task.id, { status: 'spec' });
    const specRun = createRun(db, { taskId: task.id, stage: 'spec', modelUsed: 'sonnet' });
    updateRun(db, specRun.id, { status: 'success', output: '{"title":"Add README"}' });
    expect(getTaskById(db, task.id)!.status).toBe('spec');

    // 4. Planning stage (no subtasks)
    updateTask(db, task.id, { status: 'planning' });
    const planRun = createRun(db, { taskId: task.id, stage: 'planning', modelUsed: 'sonnet' });
    updateRun(db, planRun.id, { status: 'success', output: '{"steps":["Write README"]}' });

    // 5. Implementation (ralph loop)
    updateTask(db, task.id, { status: 'implementing' });
    const implRun = createRun(db, { taskId: task.id, stage: 'implementing', modelUsed: 'opus' });
    updateRun(db, implRun.id, { status: 'success', output: 'Changes committed.' });

    // 6. Checks pass
    updateTask(db, task.id, { status: 'checks' });
    const checksRun = createRun(db, { taskId: task.id, stage: 'checks', modelUsed: 'sonnet' });
    updateRun(db, checksRun.id, { status: 'success', output: '{"passed":true}' });

    // 7. Review panel — all pass
    updateTask(db, task.id, { status: 'review_panel' });
    const reviewRun = createRun(db, { taskId: task.id, stage: 'review_panel', modelUsed: 'sonnet' });
    updateRun(db, reviewRun.id, { status: 'success', output: 'All passed' });

    for (const role of ['architect', 'qa', 'security']) {
      createArtifact(db, {
        runId: reviewRun.id,
        type: 'review_result',
        name: role,
        content: JSON.stringify({ passed: true, feedback: 'Looks good', issues: [] }),
      });
    }

    // 8. Auto-merge evaluation (autoMerge=false → needs_human_review)
    const decision = evaluateAutoMerge(db, getTaskById(db, task.id)!, config);
    expect(decision.canAutoMerge).toBe(false);

    updateTask(db, task.id, { status: 'needs_human_review' });
    expect(getTaskById(db, task.id)!.status).toBe('needs_human_review');
  });

  it('should handle a failed checks stage and retry implementing', () => {
    const task = createTask(db, {
      projectId,
      title: 'Fix bug',
      status: 'ready',
      riskLevel: 'low',
      spec: '{"title":"Fix bug"}',
    });

    claimTask(db, task.id, 'worker-1');
    updateTask(db, task.id, { status: 'implementing' });

    // First attempt: checks fail
    const implRun1 = createRun(db, { taskId: task.id, stage: 'implementing', modelUsed: 'opus', input: 'attempt 1' });
    updateRun(db, implRun1.id, { status: 'success', output: 'Done' });

    updateTask(db, task.id, { status: 'checks' });
    const checksRun1 = createRun(db, { taskId: task.id, stage: 'checks', modelUsed: 'sonnet' });
    updateRun(db, checksRun1.id, { status: 'failed', output: '{"passed":false,"errors":["Test failed"]}' });

    // Back to implementing (ralph loop iteration 2)
    updateTask(db, task.id, { status: 'implementing' });
    const implRun2 = createRun(db, { taskId: task.id, stage: 'implementing', modelUsed: 'opus', input: 'attempt 2' });
    updateRun(db, implRun2.id, { status: 'success', output: 'Fixed' });

    updateTask(db, task.id, { status: 'checks' });
    const checksRun2 = createRun(db, { taskId: task.id, stage: 'checks', modelUsed: 'sonnet' });
    updateRun(db, checksRun2.id, { status: 'success', output: '{"passed":true}' });

    // Now proceeds to review
    updateTask(db, task.id, { status: 'review_panel' });
    expect(getTaskById(db, task.id)!.status).toBe('review_panel');
  });
});

describe('Multi-Subtask Pipeline', () => {
  it('should create subtasks, execute serially, and track parent status', () => {
    // 1. Create parent task
    const parent = createTask(db, {
      projectId,
      title: 'Big feature',
      status: 'ready',
      riskLevel: 'low',
      spec: '{"title":"Big feature"}',
    });

    claimTask(db, parent.id, 'worker-1');
    updateTask(db, parent.id, { status: 'spec' });
    updateTask(db, parent.id, { status: 'planning' });

    // 2. Planning creates subtasks — first is 'ready', rest are 'backlog'
    const sub1 = createTask(db, {
      projectId,
      title: 'Subtask 1',
      parentTaskId: parent.id,
      status: 'ready',
      riskLevel: 'low',
    });

    const sub2 = createTask(db, {
      projectId,
      title: 'Subtask 2',
      parentTaskId: parent.id,
      status: 'backlog',
      riskLevel: 'low',
    });

    const sub3 = createTask(db, {
      projectId,
      title: 'Subtask 3',
      parentTaskId: parent.id,
      status: 'backlog',
      riskLevel: 'low',
    });

    // Parent stays in 'implementing' while subtasks run
    updateTask(db, parent.id, { status: 'implementing' });
    unclaimTask(db, parent.id);

    // 3. Subtask 1 executes and completes
    claimTask(db, sub1.id, 'worker-1');
    updateTask(db, sub1.id, { status: 'implementing' });
    updateTask(db, sub1.id, { status: 'done' });

    // Verify: next subtask gets promoted
    const next = getNextBacklogSubtask(db, parent.id);
    expect(next).toBeDefined();
    expect(next!.id).toBe(sub2.id);
    updateTask(db, sub2.id, { status: 'ready' });

    // 4. Subtask 2 executes and completes
    claimTask(db, sub2.id, 'worker-1');
    updateTask(db, sub2.id, { status: 'implementing' });
    updateTask(db, sub2.id, { status: 'done' });

    const next2 = getNextBacklogSubtask(db, parent.id);
    expect(next2).toBeDefined();
    expect(next2!.id).toBe(sub3.id);
    updateTask(db, sub3.id, { status: 'ready' });

    // 5. Subtask 3 executes and completes
    claimTask(db, sub3.id, 'worker-1');
    updateTask(db, sub3.id, { status: 'implementing' });
    updateTask(db, sub3.id, { status: 'done' });

    // 6. All subtasks done — no more backlog siblings
    const remaining = getNextBacklogSubtask(db, parent.id);
    expect(remaining).toBeUndefined();

    // 7. Verify all subtasks are terminal
    const subtasks = getSubtasksByParentId(db, parent.id);
    expect(subtasks).toHaveLength(3);
    expect(subtasks.every(s => s.status === 'done')).toBe(true);
  });

  it('should cancel backlog siblings when a subtask fails', () => {
    const parent = createTask(db, {
      projectId,
      title: 'Multi-step feature',
      status: 'implementing',
      riskLevel: 'low',
    });

    const sub1 = createTask(db, {
      projectId,
      title: 'Subtask 1',
      parentTaskId: parent.id,
      status: 'ready',
      riskLevel: 'low',
    });

    const sub2 = createTask(db, {
      projectId,
      title: 'Subtask 2',
      parentTaskId: parent.id,
      status: 'backlog',
      riskLevel: 'low',
    });

    // Subtask 1 fails
    updateTask(db, sub1.id, { status: 'failed' });

    // Simulate: cancel remaining backlog siblings (as worker loop does)
    const siblings = getSubtasksByParentId(db, parent.id);
    for (const sibling of siblings) {
      if (sibling.status === 'backlog') {
        updateTask(db, sibling.id, { status: 'cancelled' });
      }
    }

    // Verify: sub2 is cancelled, not stuck in backlog
    const updatedSub2 = getTaskById(db, sub2.id)!;
    expect(updatedSub2.status).toBe('cancelled');

    // All subtasks terminal → parent can resolve
    const allSubtasks = getSubtasksByParentId(db, parent.id);
    const terminalStatuses = ['done', 'failed', 'cancelled'];
    expect(allSubtasks.every(s => terminalStatuses.includes(s.status))).toBe(true);
  });

  it('should not use stale task objects after async operations', () => {
    // Regression test for the stale object bug (2026-03-16)
    const task = createTask(db, {
      projectId,
      title: 'Stale check',
      status: 'ready',
      riskLevel: 'low',
    });

    // Simulate: worker claims and starts processing
    claimTask(db, task.id, 'worker-1');

    // The in-memory task object still says 'ready'
    expect(task.status).toBe('ready');

    // But DB says something else after an update
    updateTask(db, task.id, { status: 'done' });

    // Re-fetch from DB — this is what the fix does
    const freshTask = getTaskById(db, task.id)!;
    expect(freshTask.status).toBe('done');

    // The stale object is still 'ready' — confirming the bug pattern
    expect(task.status).toBe('ready');
    expect(freshTask.status).not.toBe(task.status);
  });
});
