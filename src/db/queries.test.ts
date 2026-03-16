import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test/helpers.js';
import * as queries from './queries.js';

// ── Helpers ───────────────────────────────────────────────────────────

function uniquePath(label = 'project'): string {
  return `/test/${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeProject(db: Database.Database, overrides: Partial<{ name: string; path: string; configPath: string }> = {}) {
  return queries.createProject(db, {
    name: overrides.name ?? 'Test Project',
    path: overrides.path ?? uniquePath(),
    configPath: overrides.configPath ?? '/config/.agentboard.json',
  });
}

function makeTask(db: Database.Database, projectId: string, overrides: Partial<queries.CreateTaskData> = {}) {
  return queries.createTask(db, {
    projectId,
    title: 'Test Task',
    ...overrides,
  });
}

function makeRun(db: Database.Database, taskId: string, overrides: Partial<queries.CreateRunData> = {}) {
  return queries.createRun(db, {
    taskId,
    stage: 'planning',
    ...overrides,
  });
}

// ── Test setup ────────────────────────────────────────────────────────

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

// ── Projects ──────────────────────────────────────────────────────────

describe('projects', () => {
  it('creates a project and retrieves it by id', () => {
    const path = uniquePath('create');
    const project = queries.createProject(db, {
      name: 'My Project',
      path,
      configPath: '/cfg/.agentboard.json',
    });
    expect(project.id).toBeTruthy();
    expect(project.name).toBe('My Project');
    expect(project.path).toBe(path);
    expect(project.configPath).toBe('/cfg/.agentboard.json');
    expect(project.createdAt).toBeTruthy();
    expect(project.updatedAt).toBeTruthy();
  });

  it('getProjectById returns the project', () => {
    const project = makeProject(db);
    const fetched = queries.getProjectById(db, project.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(project.id);
  });

  it('getProjectById returns undefined for unknown id', () => {
    const result = queries.getProjectById(db, 'does-not-exist');
    expect(result).toBeUndefined();
  });

  it('listProjects returns projects in DESC created_at order', async () => {
    const p1 = makeProject(db, { name: 'Alpha', path: uniquePath('alpha') });
    // Small delay to ensure distinct timestamps
    await new Promise((r) => setTimeout(r, 5));
    const p2 = makeProject(db, { name: 'Beta', path: uniquePath('beta') });
    const list = queries.listProjects(db);
    expect(list.length).toBeGreaterThanOrEqual(2);
    const ids = list.map((p) => p.id);
    expect(ids.indexOf(p2.id)).toBeLessThan(ids.indexOf(p1.id));
  });

  it('getProjectByPath returns the matching project', () => {
    const path = uniquePath('bypath');
    const project = makeProject(db, { path });
    const fetched = queries.getProjectByPath(db, path);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(project.id);
  });

  it('getProjectByPath returns undefined for unknown path', () => {
    const result = queries.getProjectByPath(db, '/nonexistent/path');
    expect(result).toBeUndefined();
  });

  it('updateProject updates name', () => {
    const project = makeProject(db, { name: 'Before' });
    const updated = queries.updateProject(db, project.id, { name: 'After' });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('After');
  });

  it('updateProject updates path', () => {
    const project = makeProject(db);
    const newPath = uniquePath('updated');
    const updated = queries.updateProject(db, project.id, { path: newPath });
    expect(updated!.path).toBe(newPath);
  });

  it('updateProject with no fields returns the project unchanged', () => {
    const project = makeProject(db);
    const result = queries.updateProject(db, project.id, {});
    expect(result!.id).toBe(project.id);
  });

  it('deleteProject removes the project', () => {
    const project = makeProject(db);
    queries.deleteProject(db, project.id);
    expect(queries.getProjectById(db, project.id)).toBeUndefined();
  });

  it('rejects duplicate project paths', () => {
    const sharedPath = uniquePath('dup');
    makeProject(db, { path: sharedPath });
    expect(() => makeProject(db, { path: sharedPath })).toThrow();
  });
});

// ── Tasks ─────────────────────────────────────────────────────────────

describe('tasks', () => {
  it('creates a task with defaults', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    expect(task.id).toBeTruthy();
    expect(task.projectId).toBe(project.id);
    expect(task.title).toBe('Test Task');
    expect(task.description).toBe('');
    expect(task.status).toBe('backlog');
    expect(task.riskLevel).toBe('low');
    expect(task.priority).toBe(0);
    expect(task.columnPosition).toBe(0);
    expect(task.spec).toBeNull();
    expect(task.blockedReason).toBeNull();
    expect(task.claimedAt).toBeNull();
    expect(task.claimedBy).toBeNull();
    expect(task.parentTaskId).toBeNull();
  });

  it('creates a task with all fields', () => {
    const project = makeProject(db);
    const parent = makeTask(db, project.id, { title: 'Parent' });
    const task = makeTask(db, project.id, {
      title: 'Full Task',
      description: 'A description',
      parentTaskId: parent.id,
      status: 'ready',
      riskLevel: 'high',
      priority: 10,
      columnPosition: 3,
      spec: JSON.stringify({ foo: 'bar' }),
    });
    expect(task.title).toBe('Full Task');
    expect(task.description).toBe('A description');
    expect(task.parentTaskId).toBe(parent.id);
    expect(task.status).toBe('ready');
    expect(task.riskLevel).toBe('high');
    expect(task.priority).toBe(10);
    expect(task.columnPosition).toBe(3);
    expect(task.spec).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('listTasksByProject returns all tasks for a project', () => {
    const project = makeProject(db);
    makeTask(db, project.id, { title: 'T1', priority: 1 });
    makeTask(db, project.id, { title: 'T2', priority: 2 });
    const tasks = queries.listTasksByProject(db, project.id);
    expect(tasks).toHaveLength(2);
  });

  it('listTasksByProject returns tasks ordered by priority DESC', () => {
    const project = makeProject(db);
    makeTask(db, project.id, { title: 'Low', priority: 1 });
    makeTask(db, project.id, { title: 'High', priority: 5 });
    const tasks = queries.listTasksByProject(db, project.id);
    expect(tasks[0].title).toBe('High');
    expect(tasks[1].title).toBe('Low');
  });

  it('listTasksByProject excludes tasks from other projects', () => {
    const p1 = makeProject(db);
    const p2 = makeProject(db);
    makeTask(db, p1.id, { title: 'P1 Task' });
    makeTask(db, p2.id, { title: 'P2 Task' });
    const tasks = queries.listTasksByProject(db, p1.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('P1 Task');
  });

  it('listTasksByStatus returns only tasks with the given status', () => {
    const project = makeProject(db);
    makeTask(db, project.id, { title: 'Backlog', status: 'backlog' });
    makeTask(db, project.id, { title: 'Ready', status: 'ready' });
    makeTask(db, project.id, { title: 'Ready 2', status: 'ready' });
    const ready = queries.listTasksByStatus(db, project.id, 'ready');
    expect(ready).toHaveLength(2);
    expect(ready.every((t) => t.status === 'ready')).toBe(true);
  });

  it('claimTask succeeds first time', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const claimed = queries.claimTask(db, task.id, 'worker-1');
    expect(claimed).toBe(true);
    const fetched = queries.getTaskById(db, task.id);
    expect(fetched!.claimedBy).toBe('worker-1');
    expect(fetched!.claimedAt).toBeTruthy();
  });

  it('claimTask fails when already claimed (atomicity)', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    queries.claimTask(db, task.id, 'worker-1');
    const secondClaim = queries.claimTask(db, task.id, 'worker-2');
    expect(secondClaim).toBe(false);
    const fetched = queries.getTaskById(db, task.id);
    expect(fetched!.claimedBy).toBe('worker-1');
  });

  it('unclaimTask clears the claim and allows re-claim', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    queries.claimTask(db, task.id, 'worker-1');
    const unclaimed = queries.unclaimTask(db, task.id);
    expect(unclaimed!.claimedBy).toBeNull();
    expect(unclaimed!.claimedAt).toBeNull();
    const reClaimed = queries.claimTask(db, task.id, 'worker-2');
    expect(reClaimed).toBe(true);
  });

  it('moveToColumn updates status and columnPosition', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id, { status: 'backlog', columnPosition: 0 });
    const moved = queries.moveToColumn(db, task.id, 'ready', 2);
    expect(moved!.status).toBe('ready');
    expect(moved!.columnPosition).toBe(2);
  });

  it('getSubtasksByParentId returns only direct children', () => {
    const project = makeProject(db);
    const parent = makeTask(db, project.id, { title: 'Parent' });
    const child1 = makeTask(db, project.id, { title: 'Child 1', parentTaskId: parent.id });
    const child2 = makeTask(db, project.id, { title: 'Child 2', parentTaskId: parent.id });
    const unrelated = makeTask(db, project.id, { title: 'Unrelated' });

    const subtasks = queries.getSubtasksByParentId(db, parent.id);
    expect(subtasks).toHaveLength(2);
    const ids = subtasks.map((t) => t.id);
    expect(ids).toContain(child1.id);
    expect(ids).toContain(child2.id);
    expect(ids).not.toContain(unrelated.id);
  });

  it('getNextBacklogSubtask returns the first backlog subtask by created_at', async () => {
    const project = makeProject(db);
    const parent = makeTask(db, project.id, { title: 'Parent' });
    const first = makeTask(db, project.id, { title: 'First', parentTaskId: parent.id, status: 'backlog' });
    await new Promise((r) => setTimeout(r, 5));
    makeTask(db, project.id, { title: 'Second', parentTaskId: parent.id, status: 'backlog' });

    const next = queries.getNextBacklogSubtask(db, parent.id);
    expect(next).toBeDefined();
    expect(next!.id).toBe(first.id);
  });

  it('getNextBacklogSubtask skips non-backlog subtasks', () => {
    const project = makeProject(db);
    const parent = makeTask(db, project.id, { title: 'Parent' });
    makeTask(db, project.id, { title: 'Done Child', parentTaskId: parent.id, status: 'done' });
    const backlogChild = makeTask(db, project.id, { title: 'Backlog Child', parentTaskId: parent.id, status: 'backlog' });

    const next = queries.getNextBacklogSubtask(db, parent.id);
    expect(next!.id).toBe(backlogChild.id);
  });

  it('getNextBacklogSubtask returns undefined when no backlog subtasks', () => {
    const project = makeProject(db);
    const parent = makeTask(db, project.id, { title: 'Parent' });
    const next = queries.getNextBacklogSubtask(db, parent.id);
    expect(next).toBeUndefined();
  });

  it('createTask throws on nonexistent project (FK violation)', () => {
    expect(() => makeTask(db, 'nonexistent-project-id')).toThrow();
  });

  it('updateTask updates individual fields', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id, { title: 'Original' });
    const updated = queries.updateTask(db, task.id, {
      title: 'Updated',
      description: 'New desc',
      status: 'ready',
      riskLevel: 'medium',
      priority: 5,
      columnPosition: 1,
      spec: '{"key":"val"}',
      blockedReason: 'Blocked by X',
    });
    expect(updated!.title).toBe('Updated');
    expect(updated!.description).toBe('New desc');
    expect(updated!.status).toBe('ready');
    expect(updated!.riskLevel).toBe('medium');
    expect(updated!.priority).toBe(5);
    expect(updated!.columnPosition).toBe(1);
    expect(updated!.spec).toBe('{"key":"val"}');
    expect(updated!.blockedReason).toBe('Blocked by X');
  });

  it('updateTask with no fields returns task unchanged', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id, { title: 'Same' });
    const result = queries.updateTask(db, task.id, {});
    expect(result!.title).toBe('Same');
  });

  it('deleteTask removes the task', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    queries.deleteTask(db, task.id);
    expect(queries.getTaskById(db, task.id)).toBeUndefined();
  });
});

// ── Runs ──────────────────────────────────────────────────────────────

describe('runs', () => {
  it('creates a run and retrieves it by id', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const run = makeRun(db, task.id, { stage: 'planning', attempt: 1 });
    expect(run.id).toBeTruthy();
    expect(run.taskId).toBe(task.id);
    expect(run.stage).toBe('planning');
    expect(run.status).toBe('running');
    expect(run.attempt).toBe(1);
    expect(run.tokensUsed).toBeNull();
    expect(run.modelUsed).toBeNull();
    expect(run.input).toBeNull();
    expect(run.output).toBeNull();
    expect(run.finishedAt).toBeNull();
    expect(run.startedAt).toBeTruthy();
  });

  it('creates a run with optional fields', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const run = makeRun(db, task.id, {
      stage: 'implementing',
      attempt: 2,
      modelUsed: 'claude-3-5-sonnet',
      input: 'some prompt',
    });
    expect(run.attempt).toBe(2);
    expect(run.modelUsed).toBe('claude-3-5-sonnet');
    expect(run.input).toBe('some prompt');
  });

  it('listRunsByTask returns runs in DESC started_at order', async () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const r1 = makeRun(db, task.id, { stage: 'planning', attempt: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const r2 = makeRun(db, task.id, { stage: 'planning', attempt: 2 });

    const runs = queries.listRunsByTask(db, task.id);
    expect(runs).toHaveLength(2);
    const ids = runs.map((r) => r.id);
    expect(ids.indexOf(r2.id)).toBeLessThan(ids.indexOf(r1.id));
  });

  it('listRunsByTask excludes runs from other tasks', () => {
    const project = makeProject(db);
    const t1 = makeTask(db, project.id, { title: 'T1' });
    const t2 = makeTask(db, project.id, { title: 'T2' });
    makeRun(db, t1.id);
    makeRun(db, t2.id);
    const runs = queries.listRunsByTask(db, t1.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].taskId).toBe(t1.id);
  });

  it('getLatestRunByTaskAndStage returns highest attempt', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    makeRun(db, task.id, { stage: 'planning', attempt: 1 });
    const r2 = makeRun(db, task.id, { stage: 'planning', attempt: 3 });
    makeRun(db, task.id, { stage: 'planning', attempt: 2 });

    const latest = queries.getLatestRunByTaskAndStage(db, task.id, 'planning');
    expect(latest).toBeDefined();
    expect(latest!.id).toBe(r2.id);
    expect(latest!.attempt).toBe(3);
  });

  it('getLatestRunByTaskAndStage returns undefined when no matching run', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const result = queries.getLatestRunByTaskAndStage(db, task.id, 'review_panel');
    expect(result).toBeUndefined();
  });

  it('updateRun updates fields', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const run = makeRun(db, task.id);
    const finishedAt = new Date().toISOString();
    const updated = queries.updateRun(db, run.id, {
      status: 'success',
      tokensUsed: 1500,
      modelUsed: 'claude-opus',
      output: 'Result text',
      finishedAt,
    });
    expect(updated!.status).toBe('success');
    expect(updated!.tokensUsed).toBe(1500);
    expect(updated!.modelUsed).toBe('claude-opus');
    expect(updated!.output).toBe('Result text');
    expect(updated!.finishedAt).toBe(finishedAt);
  });

  it('updateRun with no fields returns run unchanged', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const run = makeRun(db, task.id);
    const result = queries.updateRun(db, run.id, {});
    expect(result!.id).toBe(run.id);
    expect(result!.status).toBe('running');
  });

  it('deleteRun removes the run', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const run = makeRun(db, task.id);
    queries.deleteRun(db, run.id);
    expect(queries.getRunById(db, run.id)).toBeUndefined();
  });
});

// ── Artifacts ─────────────────────────────────────────────────────────

describe('artifacts', () => {
  it('creates an artifact and lists it by run', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const run = makeRun(db, task.id);
    const artifact = queries.createArtifact(db, {
      runId: run.id,
      type: 'file',
      name: 'output.ts',
      content: 'export const x = 1;',
    });
    expect(artifact.id).toBeTruthy();
    expect(artifact.runId).toBe(run.id);
    expect(artifact.type).toBe('file');
    expect(artifact.name).toBe('output.ts');
    expect(artifact.content).toBe('export const x = 1;');

    const list = queries.listArtifactsByRun(db, run.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(artifact.id);
  });

  it('listArtifactsByRun returns multiple artifacts', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const run = makeRun(db, task.id);
    queries.createArtifact(db, { runId: run.id, type: 'file', name: 'a.ts', content: 'a' });
    queries.createArtifact(db, { runId: run.id, type: 'file', name: 'b.ts', content: 'b' });
    const list = queries.listArtifactsByRun(db, run.id);
    expect(list).toHaveLength(2);
  });

  it('listArtifactsByRun excludes artifacts from other runs', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const r1 = makeRun(db, task.id, { stage: 'planning', attempt: 1 });
    const r2 = makeRun(db, task.id, { stage: 'implementing', attempt: 1 });
    queries.createArtifact(db, { runId: r1.id, type: 'file', name: 'r1.ts', content: 'r1' });
    queries.createArtifact(db, { runId: r2.id, type: 'file', name: 'r2.ts', content: 'r2' });
    const list = queries.listArtifactsByRun(db, r1.id);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('r1.ts');
  });

  it('artifacts cascade delete when run is deleted', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const run = makeRun(db, task.id);
    const artifact = queries.createArtifact(db, {
      runId: run.id,
      type: 'file',
      name: 'willbegone.ts',
      content: 'content',
    });
    queries.deleteRun(db, run.id);
    expect(queries.getArtifactById(db, artifact.id)).toBeUndefined();
  });
});

// ── GitRefs ───────────────────────────────────────────────────────────

describe('gitRefs', () => {
  it('creates a git ref and retrieves it by id', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const ref = queries.createGitRef(db, {
      taskId: task.id,
      branch: 'agentboard/my-task',
      worktreePath: '/worktrees/my-task',
      status: 'local',
    });
    expect(ref.id).toBeTruthy();
    expect(ref.taskId).toBe(task.id);
    expect(ref.branch).toBe('agentboard/my-task');
    expect(ref.worktreePath).toBe('/worktrees/my-task');
    expect(ref.status).toBe('local');
  });

  it('creates a git ref with defaults', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const ref = queries.createGitRef(db, { taskId: task.id, branch: 'feature/x' });
    expect(ref.status).toBe('local');
    expect(ref.worktreePath).toBeNull();
  });

  it('listGitRefsByTask returns all refs for a task', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    queries.createGitRef(db, { taskId: task.id, branch: 'branch-1' });
    queries.createGitRef(db, { taskId: task.id, branch: 'branch-2' });
    const refs = queries.listGitRefsByTask(db, task.id);
    expect(refs).toHaveLength(2);
  });

  it('listGitRefsByTask excludes refs from other tasks', () => {
    const project = makeProject(db);
    const t1 = makeTask(db, project.id, { title: 'T1' });
    const t2 = makeTask(db, project.id, { title: 'T2' });
    queries.createGitRef(db, { taskId: t1.id, branch: 't1-branch' });
    queries.createGitRef(db, { taskId: t2.id, branch: 't2-branch' });
    const refs = queries.listGitRefsByTask(db, t1.id);
    expect(refs).toHaveLength(1);
    expect(refs[0].branch).toBe('t1-branch');
  });

  it('updateGitRef updates status', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const ref = queries.createGitRef(db, { taskId: task.id, branch: 'feature/x' });
    const updated = queries.updateGitRef(db, ref.id, { status: 'pushed' });
    expect(updated!.status).toBe('pushed');
  });

  it('updateGitRef updates worktreePath', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const ref = queries.createGitRef(db, { taskId: task.id, branch: 'feature/y' });
    const updated = queries.updateGitRef(db, ref.id, { worktreePath: '/new/path' });
    expect(updated!.worktreePath).toBe('/new/path');
  });

  it('updateGitRef with no fields returns ref unchanged', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const ref = queries.createGitRef(db, { taskId: task.id, branch: 'feature/z' });
    const result = queries.updateGitRef(db, ref.id, {});
    expect(result!.id).toBe(ref.id);
  });

  it('deleteGitRef removes the ref', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const ref = queries.createGitRef(db, { taskId: task.id, branch: 'to-delete' });
    queries.deleteGitRef(db, ref.id);
    expect(queries.getGitRefById(db, ref.id)).toBeUndefined();
  });
});

// ── Events ────────────────────────────────────────────────────────────

describe('events', () => {
  it('creates an event and retrieves it by id', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const event = queries.createEvent(db, {
      taskId: task.id,
      type: 'task.started',
      payload: JSON.stringify({ stage: 'planning' }),
    });
    expect(event.id).toBeTruthy();
    expect(event.taskId).toBe(task.id);
    expect(event.type).toBe('task.started');
    expect(event.payload).toBe(JSON.stringify({ stage: 'planning' }));
    expect(event.runId).toBeNull();
    expect(event.createdAt).toBeTruthy();
  });

  it('default payload is {}', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const event = queries.createEvent(db, { taskId: task.id, type: 'test' });
    expect(event.payload).toBe('{}');
  });

  it('JSON payload round-trips correctly', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const data = { key: 'value', nested: { num: 42 } };
    const event = queries.createEvent(db, {
      taskId: task.id,
      type: 'data.event',
      payload: JSON.stringify(data),
    });
    expect(JSON.parse(event.payload)).toEqual(data);
  });

  it('creates an event linked to a run', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const run = makeRun(db, task.id);
    const event = queries.createEvent(db, {
      taskId: task.id,
      runId: run.id,
      type: 'run.completed',
    });
    expect(event.runId).toBe(run.id);
  });

  it('listEventsByTask returns events in ASC order', async () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const e1 = queries.createEvent(db, { taskId: task.id, type: 'first' });
    await new Promise((r) => setTimeout(r, 5));
    const e2 = queries.createEvent(db, { taskId: task.id, type: 'second' });

    const events = queries.listEventsByTask(db, task.id);
    expect(events).toHaveLength(2);
    const ids = events.map((e) => e.id);
    expect(ids.indexOf(e1.id)).toBeLessThan(ids.indexOf(e2.id));
  });

  it('listEventsByTask excludes events from other tasks', () => {
    const project = makeProject(db);
    const t1 = makeTask(db, project.id, { title: 'T1' });
    const t2 = makeTask(db, project.id, { title: 'T2' });
    queries.createEvent(db, { taskId: t1.id, type: 'ev1' });
    queries.createEvent(db, { taskId: t2.id, type: 'ev2' });
    const events = queries.listEventsByTask(db, t1.id);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ev1');
  });

  it('listEventsByProject returns events with taskTitle', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id, { title: 'Important Task' });
    queries.createEvent(db, { taskId: task.id, type: 'project.event' });
    const events = queries.listEventsByProject(db, project.id);
    expect(events).toHaveLength(1);
    expect(events[0].taskTitle).toBe('Important Task');
    expect(events[0].type).toBe('project.event');
  });

  it('listEventsByProject cursor pagination excludes events at/after cursor', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    // Create 3 events
    queries.createEvent(db, { taskId: task.id, type: 'ev1' });
    queries.createEvent(db, { taskId: task.id, type: 'ev2' });
    queries.createEvent(db, { taskId: task.id, type: 'ev3' });

    // Without cursor: returns all 3
    const all = queries.listEventsByProject(db, project.id, 10);
    expect(all.length).toBe(3);

    // The results are ordered DESC by id — use the last item's id as the cursor
    // Cursor means "return events with id < cursor"
    const cursorId = all[0].id; // highest id in DESC ordering
    const paged = queries.listEventsByProject(db, project.id, 10, cursorId);
    const pagedIds = paged.map((e) => e.id);
    // Cursor event itself must not appear
    expect(pagedIds).not.toContain(cursorId);
    // All remaining events should have id < cursorId
    expect(paged.every((e) => e.id < cursorId)).toBe(true);
    // Fewer results returned than without cursor
    expect(paged.length).toBeLessThan(all.length);
  });

  it('listEventsByProject respects limit', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    for (let i = 0; i < 5; i++) {
      queries.createEvent(db, { taskId: task.id, type: `event-${i}` });
    }
    const limited = queries.listEventsByProject(db, project.id, 3);
    expect(limited).toHaveLength(3);
  });

  it('listEventsByProject excludes events from other projects', () => {
    const p1 = makeProject(db);
    const p2 = makeProject(db);
    const t1 = makeTask(db, p1.id);
    const t2 = makeTask(db, p2.id);
    queries.createEvent(db, { taskId: t1.id, type: 'p1-event' });
    queries.createEvent(db, { taskId: t2.id, type: 'p2-event' });
    const events = queries.listEventsByProject(db, p1.id);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('p1-event');
  });

  it('deleteEvent removes the event', () => {
    const project = makeProject(db);
    const task = makeTask(db, project.id);
    const event = queries.createEvent(db, { taskId: task.id, type: 'removable' });
    queries.deleteEvent(db, event.id);
    expect(queries.getEventById(db, event.id)).toBeUndefined();
  });
});
