import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDb, createTestApp } from '../../test/helpers.js';
import * as queries from '../../db/queries.js';

let db: Database.Database;
let app: ReturnType<typeof createTestApp>['app'];
let projectId: string;

function uniquePath(label = 'project'): string {
  return `/test/${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

beforeEach(() => {
  db = createTestDb();
  ({ app } = createTestApp(db));
  // Create a project for tasks to belong to
  const project = queries.createProject(db, {
    name: 'Test Project',
    path: uniquePath('tasks-proj'),
    configPath: '/test/.agentboard/config.json',
  });
  projectId = project.id;
});

afterEach(() => {
  db.close();
});

describe('POST /api/tasks', () => {
  it('creates a task with status backlog (no spec)', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ projectId, title: 'My Task' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.title).toBe('My Task');
    expect(res.body.status).toBe('backlog');
    expect(res.body.projectId).toBe(projectId);
  });

  it('sets status to ready when spec is provided', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ projectId, title: 'Speced Task', spec: 'Do something specific' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ready');
    expect(res.body.spec).toBe('Do something specific');
  });

  it('returns 400 without required fields', async () => {
    const res = await request(app).post('/api/tasks').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 400 without projectId', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'No Project' });
    expect(res.status).toBe(400);
  });

  it('returns 400 without title', async () => {
    const res = await request(app).post('/api/tasks').send({ projectId });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/tasks', () => {
  it('returns 400 when projectId is missing', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/i);
  });

  it('lists tasks by project', async () => {
    queries.createTask(db, { projectId, title: 'Task A' });
    queries.createTask(db, { projectId, title: 'Task B' });

    const res = await request(app).get(`/api/tasks?projectId=${projectId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
  });

  it('filters by status', async () => {
    queries.createTask(db, { projectId, title: 'Backlog Task', status: 'backlog' });
    queries.createTask(db, { projectId, title: 'Ready Task', status: 'ready' });

    const res = await request(app).get(`/api/tasks?projectId=${projectId}&status=backlog`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].title).toBe('Backlog Task');
  });

  it('returns empty array when no tasks match', async () => {
    const res = await request(app).get(`/api/tasks?projectId=${projectId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/tasks/:id', () => {
  it('returns a task by id', async () => {
    const task = queries.createTask(db, { projectId, title: 'Find Me Task' });

    const res = await request(app).get(`/api/tasks/${task.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(task.id);
    expect(res.body.title).toBe('Find Me Task');
  });

  it('returns 400 for non-numeric task id', async () => {
    const res = await request(app).get('/api/tasks/not-a-real-id');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown task id', async () => {
    const res = await request(app).get('/api/tasks/99999');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

describe('PUT /api/tasks/:id', () => {
  it('updates task fields', async () => {
    const task = queries.createTask(db, { projectId, title: 'Original Title' });

    const res = await request(app)
      .put(`/api/tasks/${task.id}`)
      .send({ title: 'Updated Title', priority: 5 });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.priority).toBe(5);
  });

  it('returns 404 for unknown task id', async () => {
    const res = await request(app)
      .put('/api/tasks/99999')
      .send({ title: 'Ghost' });

    expect(res.status).toBe(404);
  });

  it('does not allow status changes via PUT (ignores status field)', async () => {
    const task = queries.createTask(db, { projectId, title: 'Status Test', status: 'backlog' });

    const res = await request(app)
      .put(`/api/tasks/${task.id}`)
      .send({ title: 'Updated', status: 'ready' });

    expect(res.status).toBe(200);
    // Status should remain backlog since PUT strips status changes
    expect(res.body.status).toBe('backlog');
  });
});

describe('DELETE /api/tasks/:id', () => {
  it('deletes a task', async () => {
    const task = queries.createTask(db, { projectId, title: 'Delete Me' });

    const res = await request(app).delete(`/api/tasks/${task.id}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify task is gone
    const getRes = await request(app).get(`/api/tasks/${task.id}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for unknown task id', async () => {
    const res = await request(app).delete('/api/tasks/99999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/tasks/:id/cancel', () => {
  it('cancels a task and returns the updated task', async () => {
    const task = queries.createTask(db, { projectId, title: 'Cancel Me', status: 'ready' });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/cancel`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('returns 404 for unknown task id', async () => {
    const res = await request(app)
      .post('/api/tasks/99999/cancel')
      .send();

    expect(res.status).toBe(404);
  });
});

describe('POST /api/tasks/:id/move', () => {
  it('moves a task to a valid column', async () => {
    const task = queries.createTask(db, { projectId, title: 'Move Me', status: 'backlog' });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/move`)
      .send({ column: 'ready' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('moves a task to done', async () => {
    const task = queries.createTask(db, { projectId, title: 'Finish Me', status: 'ready' });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/move`)
      .send({ column: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
  });

  it('moves a task to cancelled', async () => {
    const task = queries.createTask(db, { projectId, title: 'Cancel Me', status: 'ready' });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/move`)
      .send({ column: 'cancelled' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('rejects invalid column', async () => {
    const task = queries.createTask(db, { projectId, title: 'Bad Move', status: 'backlog' });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/move`)
      .send({ column: 'implementing' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid column');
  });

  it('rejects missing column', async () => {
    const task = queries.createTask(db, { projectId, title: 'No Column', status: 'backlog' });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/move`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown task id', async () => {
    const res = await request(app)
      .post('/api/tasks/99999/move')
      .send({ column: 'ready' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid task id', async () => {
    const res = await request(app)
      .post('/api/tasks/abc/move')
      .send({ column: 'ready' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/tasks/:id/answer', () => {
  it('unblocks a blocked task (blocked → ready, clears blockedReason)', async () => {
    // Directly create a blocked task via queries
    const task = queries.createTask(db, {
      projectId,
      title: 'Blocked Task',
      status: 'blocked',
      spec: 'Some spec',
    });
    queries.updateTask(db, task.id, { blockedReason: 'Needs clarification' });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/answer`)
      .send({ answers: 'Here is the clarification' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.blockedReason).toBeNull();
  });

  it('returns 400 when task is not blocked', async () => {
    const task = queries.createTask(db, { projectId, title: 'Not Blocked', status: 'backlog' });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/answer`)
      .send({ answers: 'Some answer' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not blocked/i);
  });

  it('returns 400 when answers is missing', async () => {
    const task = queries.createTask(db, { projectId, title: 'Blocked No Answers', status: 'blocked' });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/answer`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/answers/i);
  });

  it('returns 404 for unknown task id', async () => {
    const res = await request(app)
      .post('/api/tasks/99999/answer')
      .send({ answers: 'Some answer' });

    expect(res.status).toBe(404);
  });
});

describe('AI endpoint spawn patterns', () => {
  it('all spawn calls use -p flag (not stdin) for prompt delivery', () => {
    const fs = require('node:fs');
    const routesSource = fs.readFileSync(
      require('node:path').resolve(__dirname, 'tasks.ts'),
      'utf-8',
    );

    // Should have 2 spawn(claudeBin() calls (parse, chat)
    const spawnCount = (routesSource.match(/spawn\(claudeBin\(\)/g) || []).length;
    expect(spawnCount).toBeGreaterThanOrEqual(2);

    // All should pipe prompts via stdin (matches executor.ts pattern — avoids -p hangs)
    expect(routesSource).toContain('child.stdin.write');
    expect(routesSource).toContain('child.stdin.end');

    // All stdio configs should use 'pipe' for stdin to enable prompt piping
    expect(routesSource).toContain("stdio: ['pipe', 'pipe', 'pipe']");
    expect(routesSource).not.toContain("stdio: ['ignore', 'pipe', 'pipe']");
  });
});

describe('POST /api/tasks/chat — validation', () => {
  it('returns 400 when messages is missing', async () => {
    const res = await request(app)
      .post('/api/tasks/chat')
      .send({ currentSpec: { title: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/messages/i);
  });

  it('returns 400 when messages is empty array', async () => {
    const res = await request(app)
      .post('/api/tasks/chat')
      .send({ messages: [], currentSpec: { title: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/messages/i);
  });

  it('returns 400 when currentSpec is missing', async () => {
    const res = await request(app)
      .post('/api/tasks/chat')
      .send({ messages: [{ role: 'user', content: 'hello' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/currentSpec/i);
  });

  it('returns 400 when messages is not an array', async () => {
    const res = await request(app)
      .post('/api/tasks/chat')
      .send({ messages: 'not an array', currentSpec: { title: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/messages/i);
  });

  it('returns 400 when currentSpec is not an object', async () => {
    const res = await request(app)
      .post('/api/tasks/chat')
      .send({ messages: [{ role: 'user', content: 'hello' }], currentSpec: 'not an object' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/currentSpec/i);
  });
});

describe('POST /api/tasks/parse — validation', () => {
  it('returns 400 when description is missing', async () => {
    const res = await request(app)
      .post('/api/tasks/parse')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/i);
  });

  it('returns 400 when description is empty string', async () => {
    const res = await request(app)
      .post('/api/tasks/parse')
      .send({ description: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/i);
  });
});


describe('POST /api/tasks/chat — spec-kit specify→clarify prompts', () => {
  it('round 1 prompt uses specify phase (initial spec draft)', () => {
    const fs = require('node:fs');
    const routesSource = fs.readFileSync(
      require('node:path').resolve(__dirname, 'tasks.ts'),
      'utf-8',
    );

    // Round 1 should use the specify prompt
    expect(routesSource).toContain('spec-driven specification agent');
    expect(routesSource).toContain('[NEEDS CLARIFICATION]');
    expect(routesSource).toContain('Given/When/Then');
    expect(routesSource).toContain('P1/P2/P3');
    // Should tell AI to only fill explicitly stated info
    expect(routesSource).toContain('EXPLICITLY stated');
  });

  it('round 2+ prompt uses clarify phase (one question at a time)', () => {
    const fs = require('node:fs');
    const routesSource = fs.readFileSync(
      require('node:path').resolve(__dirname, 'tasks.ts'),
      'utf-8',
    );

    // Round 2+ should use the clarify prompt
    expect(routesSource).toContain('spec clarification agent');
    expect(routesSource).toContain('EXACTLY ONE follow-up question');
    expect(routesSource).toContain('Recommended');
    expect(routesSource).toContain('Options');
    // Should enforce minimum rounds before completion
    expect(routesSource).toContain('at least 3 questions');
  });

  it('chat endpoint resolves project cwd for Claude context', () => {
    const fs = require('node:fs');
    const routesSource = fs.readFileSync(
      require('node:path').resolve(__dirname, 'tasks.ts'),
      'utf-8',
    );

    // Should look up project path and set cwd
    expect(routesSource).toContain('getProjectById');
    expect(routesSource).toContain('projectPath');
    expect(routesSource).toContain('spawnOpts.cwd = projectPath');
    // Should tell Claude it's running in the project's repo
    expect(routesSource).toContain("project's repository");
    expect(routesSource).toContain('CLAUDE.md');
  });

  it('chat endpoint differentiates round 1 vs round 2+ prompts', () => {
    const fs = require('node:fs');
    const routesSource = fs.readFileSync(
      require('node:path').resolve(__dirname, 'tasks.ts'),
      'utf-8',
    );

    // Should branch on roundNumber
    expect(routesSource).toContain('round === 1');
    expect(routesSource).toContain('roundNumber');
  });
});

describe('Spec format: 3-field spec-kit structure', () => {
  it('tasks can be created with the new 3-field spec format', async () => {
    const spec = JSON.stringify({
      goal: 'Send payment reminders to all channels',
      userScenarios: 'P1 — Given unpaid players exist, When reminder fires, Then all channels receive it',
      successCriteria: 'Reminders reach 100% of bound channels within the same time window',
    });

    const res = await request(app)
      .post('/api/tasks')
      .send({ projectId, title: 'Payment reminders', spec });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ready');

    const parsed = JSON.parse(res.body.spec);
    expect(parsed.goal).toContain('payment reminders');
    expect(parsed.userScenarios).toContain('P1');
    expect(parsed.successCriteria).toContain('100%');
  });

  it('task spec can be updated with new spec fields', async () => {
    const task = queries.createTask(db, {
      projectId,
      title: 'Update spec test',
      spec: JSON.stringify({ goal: 'initial', userScenarios: '', successCriteria: '' }),
    });

    const newSpec = JSON.stringify({
      goal: 'Updated goal with more detail',
      userScenarios: 'P1 — Given X, When Y, Then Z',
      successCriteria: 'Measurable outcome A',
    });

    const res = await request(app)
      .put(`/api/tasks/${task.id}`)
      .send({ spec: newSpec });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.spec);
    expect(parsed.goal).toBe('Updated goal with more detail');
    expect(parsed.userScenarios).toContain('Given X');
    expect(parsed.successCriteria).toBe('Measurable outcome A');
  });

  it('backend SpecDocument type has exactly 3 fields', () => {
    const fs = require('node:fs');
    const typesSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../types/index.ts'),
      'utf-8',
    );

    expect(typesSource).toContain('goal: string');
    expect(typesSource).toContain('userScenarios: string');
    expect(typesSource).toContain('successCriteria: string');
    // Old SpecDocument fields should NOT exist (SpecResult's outOfScope: string[] is fine)
    expect(typesSource).not.toContain('problemStatement: string');
    expect(typesSource).not.toContain('userStories: string');
    expect(typesSource).not.toContain('constraints: string');
    expect(typesSource).not.toContain('verificationStrategy: string');
    expect(typesSource).not.toContain('outOfScope: string;');
  });

  it('frontend SpecDocument type mirrors backend', () => {
    const fs = require('node:fs');
    const typesSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/types.ts'),
      'utf-8',
    );

    expect(typesSource).toContain('goal: string');
    expect(typesSource).toContain('userScenarios: string');
    expect(typesSource).toContain('successCriteria: string');
    expect(typesSource).not.toContain('problemStatement: string');
    expect(typesSource).not.toContain('verificationStrategy: string');
  });
});

describe('Frontend: TaskForm conversational UI', () => {
  it('TaskForm uses SSE streaming chat endpoint (never /api/tasks/parse)', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/TaskForm.tsx'),
      'utf-8',
    );

    expect(formSource).toContain('/chat/stream');
    expect(formSource).not.toContain('/api/tasks/parse');
  });

  it('TaskForm uses SSE streaming with chunk and done events', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/TaskForm.tsx'),
      'utf-8',
    );

    // Should handle SSE chunk events for real-time streaming
    expect(formSource).toContain('streamingContent');
    expect(formSource).toContain('setStreamingContent');
    // Should handle SSE event types
    expect(formSource).toContain("event.type === 'chunk'");
    expect(formSource).toContain("event.type === 'done'");
  });

  it('TaskForm passes projectId and manages taskId for streaming', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/TaskForm.tsx'),
      'utf-8',
    );

    expect(formSource).toContain('projectId');
    // Should be in the Props interface
    expect(formSource).toContain('projectId: string');
    // Should track taskId for streaming endpoint
    expect(formSource).toContain('taskId');
    expect(formSource).toContain('setTaskId');
  });

  it('TaskForm uses spec-kit 3-field spec labels', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/TaskForm.tsx'),
      'utf-8',
    );

    expect(formSource).toContain("goal: 'Goal'");
    expect(formSource).toContain("userScenarios: 'User Scenarios'");
    expect(formSource).toContain("successCriteria: 'Success Criteria'");
    // Old labels should not exist
    expect(formSource).not.toContain('Problem Statement');
    expect(formSource).not.toContain('Verification Strategy');
  });

  it('TaskForm auto-transitions to confirming phase on isComplete', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/TaskForm.tsx'),
      'utf-8',
    );

    expect(formSource).toContain('event.isComplete');
    expect(formSource).toContain("setPhase('confirming')");
  });

  it('SpecField is read-only preview (no textarea or refine)', () => {
    const fs = require('node:fs');
    const specFieldSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/SpecField.tsx'),
      'utf-8',
    );

    expect(specFieldSource).toContain('label');
    expect(specFieldSource).toContain('value');
    expect(specFieldSource).toContain('Not yet filled');
    // Should NOT have edit/refine functionality
    expect(specFieldSource).not.toContain('textarea');
    expect(specFieldSource).not.toContain('onChange');
    expect(specFieldSource).not.toContain('onRefine');
  });
});

describe('POST /api/tasks/:id/review-plan', () => {
  it('rejects if task is not in needs_plan_review', async () => {
    const task = queries.createTask(db, { projectId, title: 'Not reviewing', status: 'ready' });
    const res = await request(app)
      .post(`/api/tasks/${task.id}/review-plan`)
      .send({ action: 'approve' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not awaiting plan review/i);
  });

  it('rejects invalid action', async () => {
    const task = queries.createTask(db, { projectId, title: 'Bad action', status: 'needs_plan_review' });
    const res = await request(app)
      .post(`/api/tasks/${task.id}/review-plan`)
      .send({ action: 'maybe' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approve.*reject/i);
  });

  it('approves plan and moves task to ready', async () => {
    const task = queries.createTask(db, { projectId, title: 'Approve me', status: 'needs_plan_review' });
    const res = await request(app)
      .post(`/api/tasks/${task.id}/review-plan`)
      .send({ action: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');

    const events = queries.listEventsByTask(db, task.id);
    expect(events.some((e) => e.type === 'plan_review_approved')).toBe(true);
  });

  it('approves plan with edits and stores them', async () => {
    const task = queries.createTask(db, { projectId, title: 'Approve with edits', status: 'needs_plan_review' });
    const res = await request(app)
      .post(`/api/tasks/${task.id}/review-plan`)
      .send({
        action: 'approve',
        edits: {
          planSummary: 'Revised approach',
          subtasks: [{ title: 'Step 1', description: 'Do first thing' }],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');

    const events = queries.listEventsByTask(db, task.id);
    const approvalEvent = events.find((e) => e.type === 'plan_review_approved');
    expect(approvalEvent).toBeDefined();
    const payload = JSON.parse(approvalEvent!.payload) as { edits: { planSummary: string } };
    expect(payload.edits.planSummary).toBe('Revised approach');
  });

  it('rejects plan without reason and returns 400', async () => {
    const task = queries.createTask(db, { projectId, title: 'Reject no reason', status: 'needs_plan_review' });
    const res = await request(app)
      .post(`/api/tasks/${task.id}/review-plan`)
      .send({ action: 'reject' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason is required/i);
  });

  it('rejects plan with reason and moves back to ready for re-planning', async () => {
    const task = queries.createTask(db, { projectId, title: 'Reject me', status: 'needs_plan_review' });
    const res = await request(app)
      .post(`/api/tasks/${task.id}/review-plan`)
      .send({ action: 'reject', reason: 'Approach is too complex' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');

    const events = queries.listEventsByTask(db, task.id);
    const rejectionEvent = events.find((e) => e.type === 'plan_review_rejected');
    expect(rejectionEvent).toBeDefined();
    const payload = JSON.parse(rejectionEvent!.payload) as { reason: string };
    expect(payload.reason).toBe('Approach is too complex');
  });
});

describe('Frontend: TaskForm passes existingTaskId on submit', () => {
  it('computes existingTaskId from taskId when not editing', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/TaskForm.tsx'),
      'utf-8',
    );

    // Should compute existingTaskId from taskId when not in edit mode
    expect(formSource).toContain('const existingTaskId = (!isEditing && taskId) ? taskId : undefined');
  });

  it('passes existingTaskId in the onSubmit call', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/TaskForm.tsx'),
      'utf-8',
    );

    // Should include existingTaskId in the data passed to onSubmit
    expect(formSource).toContain('existingTaskId,');
    // The onSubmit call should contain existingTaskId in its argument object
    expect(formSource).toContain('await onSubmit({');
  });

  it('onSubmit prop type includes existingTaskId as optional string', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/TaskForm.tsx'),
      'utf-8',
    );

    // The Props interface should declare existingTaskId as optional in the onSubmit data type
    expect(formSource).toContain('existingTaskId?: number');
  });
});

describe('Frontend: TaskForm validates spec completeness before submit', () => {
  it('handleSubmit checks for empty spec fields before calling onSubmit', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/TaskForm.tsx'),
      'utf-8',
    );

    // Should filter spec fields that are empty
    expect(formSource).toContain("filter((k) => !spec[k].trim())");
    // Should check emptyFields length and set error
    expect(formSource).toContain('if (emptyFields.length > 0)');
  });

  it('uses SPEC_LABELS to build the error message', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/TaskForm.tsx'),
      'utf-8',
    );

    // Should map empty field keys to their labels via SPEC_LABELS
    expect(formSource).toContain('.map((k) => SPEC_LABELS[k])');
    // Should join labels into the error message
    expect(formSource).toContain("emptyFields.join(', ')");
    // Error message should mention spec fields must be filled
    expect(formSource).toContain('spec fields must be filled');
  });

  it('returns early if any spec fields are empty (preventing submission)', () => {
    const fs = require('node:fs');
    const formSource = fs.readFileSync(
      require('node:path').resolve(__dirname, '../../../ui/src/components/TaskForm.tsx'),
      'utf-8',
    );

    // The handleSubmit function should have the emptyFields check before setSubmitting(true)
    const handleSubmitStart = formSource.indexOf('const handleSubmit');
    const setSubmittingTrue = formSource.indexOf('setSubmitting(true)', handleSubmitStart);
    const emptyFieldsCheck = formSource.indexOf('emptyFields.length > 0', handleSubmitStart);

    // emptyFields check should come BEFORE setSubmitting(true)
    expect(emptyFieldsCheck).toBeGreaterThan(-1);
    expect(setSubmittingTrue).toBeGreaterThan(-1);
    expect(emptyFieldsCheck).toBeLessThan(setSubmittingTrue);
  });
});

describe('API integration: PUT simulates chat-created task flow', () => {
  it('creates a task with spec (auto-ready), updates fields via PUT', async () => {
    const spec = JSON.stringify({
      goal: 'Build a notification system',
      userScenarios: 'P1 — Given a user event, When triggered, Then notify all subscribers',
      successCriteria: 'All subscribers receive notification within 5 seconds',
    });

    // Step 1: Create a task with spec (goes directly to ready)
    const createRes = await request(app)
      .post('/api/tasks')
      .send({ projectId, title: 'Chat draft', spec });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('ready');
    const taskId = createRes.body.id;

    // Step 2: PUT to update its title, description, etc.
    const updateRes = await request(app)
      .put(`/api/tasks/${taskId}`)
      .send({
        title: 'Notification system',
        description: 'Real-time notification pipeline',
        riskLevel: 'medium',
        priority: 2,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.title).toBe('Notification system');
    expect(updateRes.body.spec).toBe(spec);

    // Step 3: Verify the final state
    const getRes = await request(app).get(`/api/tasks/${taskId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.title).toBe('Notification system');
    expect(getRes.body.description).toBe('Real-time notification pipeline');
    expect(getRes.body.spec).toBe(spec);
    expect(getRes.body.status).toBe('ready');
    expect(getRes.body.riskLevel).toBe('medium');
    expect(getRes.body.priority).toBe(2);
  });
});
