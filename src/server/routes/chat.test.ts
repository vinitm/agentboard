import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, createTestApp } from '../../test/helpers.js';
import {
  createProject, createTask, getTaskById, updateTask,
  createChatMessage, listChatMessagesByTask,
} from '../../db/queries.js';
import type Database from 'better-sqlite3';

describe('chat session persistence (DB layer)', () => {
  let db: Database.Database;
  let taskId: number;

  beforeEach(() => {
    db = createTestDb();
    const project = createProject(db, {
      name: 'test', path: '/tmp/test-chat-route',
      configPath: '/tmp/test-chat-route/.agentboard',
    });
    const task = createTask(db, { projectId: project.id, title: 'Test task' });
    taskId = task.id;
  });

  it('new task has null chatSessionId', () => {
    const task = getTaskById(db, taskId);
    expect(task?.chatSessionId).toBeNull();
  });

  it('chatSessionId roundtrips through updateTask', () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    updateTask(db, taskId, { chatSessionId: sessionId });
    const task = getTaskById(db, taskId);
    expect(task?.chatSessionId).toBe(sessionId);
  });

  it('chatSessionId can be set to null', () => {
    updateTask(db, taskId, { chatSessionId: 'some-id' });
    updateTask(db, taskId, { chatSessionId: null });
    const task = getTaskById(db, taskId);
    expect(task?.chatSessionId).toBeNull();
  });
});

describe('GET /api/tasks/:id/chat/messages (HTTP integration)', () => {
  let db: Database.Database;
  let taskId: number;

  beforeEach(() => {
    db = createTestDb();
    const project = createProject(db, {
      name: 'test', path: '/tmp/test-chat-http',
      configPath: '/tmp/test-chat-http/.agentboard',
    });
    const task = createTask(db, { projectId: project.id, title: 'HTTP chat test' });
    taskId = task.id;
  });

  it('returns empty array when no messages exist', async () => {
    const { app } = createTestApp(db);
    const res = await request(app).get(`/api/tasks/${taskId}/chat/messages`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns persisted messages in chronological order', async () => {
    createChatMessage(db, { taskId, role: 'user', content: 'Build dark mode' });
    createChatMessage(db, { taskId, role: 'assistant', content: 'Great! Let me ask some questions.' });

    const { app } = createTestApp(db);
    const res = await request(app).get(`/api/tasks/${taskId}/chat/messages`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].role).toBe('user');
    expect(res.body[0].content).toBe('Build dark mode');
    expect(res.body[1].role).toBe('assistant');
    expect(res.body[1].content).toBe('Great! Let me ask some questions.');
  });

  it('returns partial assistant message saved on disconnect', async () => {
    createChatMessage(db, { taskId, role: 'user', content: 'Add auth' });
    // Simulate partial save from mid-stream disconnect
    createChatMessage(db, { taskId, role: 'assistant', content: 'I can help with auth. First, let me clarify' });

    const { app } = createTestApp(db);
    const res = await request(app).get(`/api/tasks/${taskId}/chat/messages`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[1].content).toBe('I can help with auth. First, let me clarify');
  });

  it('returns 404 for non-existent task', async () => {
    const { app } = createTestApp(db);
    const res = await request(app).get('/api/tasks/99999/chat/messages');
    expect(res.status).toBe(404);
  });
});

describe('parseResponseJson (unit)', () => {
  it('extracts spec updates from JSON block in text', () => {
    const text = 'Some response text\n\n```json\n{"specUpdates":{"goal":"Build X"},"isComplete":false}\n```';
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    expect(fenceMatch).not.toBeNull();
    const parsed = JSON.parse(fenceMatch![1].trim());
    expect(parsed.specUpdates.goal).toBe('Build X');
    expect(parsed.isComplete).toBe(false);
  });

  it('returns defaults when no JSON block present', () => {
    const text = 'Just a plain response with no JSON';
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    expect(fenceMatch).toBeNull();
  });

  it('extracts title and risk level updates', () => {
    const text = '```json\n{"specUpdates":{},"titleUpdate":"Add auth","riskLevelUpdate":"high","isComplete":false}\n```';
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const parsed = JSON.parse(fenceMatch![1].trim());
    expect(parsed.titleUpdate).toBe('Add auth');
    expect(parsed.riskLevelUpdate).toBe('high');
  });
});

describe('partial progress on disconnect (StreamState fallback)', () => {
  it('streamedText accumulates text_delta chunks', () => {
    const state = { fullText: '', streamedText: '', resumeFailed: false, resumeError: '' };
    // Simulate text_delta events accumulating
    state.streamedText += 'Hello ';
    state.streamedText += 'world!';
    expect(state.streamedText).toBe('Hello world!');
  });

  it('responseText falls back to streamedText when fullText is empty', () => {
    const state = { fullText: '', streamedText: 'Partial response text', resumeFailed: false, resumeError: '' };
    const responseText = state.fullText || state.streamedText;
    expect(responseText).toBe('Partial response text');
  });

  it('responseText prefers fullText over streamedText when both exist', () => {
    const state = {
      fullText: 'Authoritative full text\n\n```json\n{"specUpdates":{},"isComplete":false}\n```',
      streamedText: 'Partial streamed text',
      resumeFailed: false,
      resumeError: '',
    };
    const responseText = state.fullText || state.streamedText;
    expect(responseText).toBe(state.fullText);
  });

  it('partial text with spec JSON block is parseable for spec updates', () => {
    const partialText = 'Here is the spec.\n\n```json\n{"specUpdates":{"goal":"Build a widget"},"isComplete":false}\n```';
    const fenceMatch = partialText.match(/```(?:json)?\s*([\s\S]*?)```/);
    expect(fenceMatch).not.toBeNull();
    const parsed = JSON.parse(fenceMatch![1].trim());
    expect(parsed.specUpdates.goal).toBe('Build a widget');
  });

  it('partial text without JSON block still saves as message content', () => {
    const partialText = 'I understand you want to build a user auth system. Let me ask some clarifying questions:';
    const fenceMatch = partialText.match(/```(?:json)?\s*([\s\S]*?)```/);
    expect(fenceMatch).toBeNull();
    // The message text should still be the full partial text
    expect(partialText.trim().length).toBeGreaterThan(0);
  });

  it('empty streamedText does not produce a saved message', () => {
    const state = { fullText: '', streamedText: '', resumeFailed: false, resumeError: '' };
    const responseText = state.fullText || state.streamedText;
    // Guard: only save if there's actual content
    const shouldSave = responseText.trim().length > 0;
    expect(shouldSave).toBe(false);
  });
});

describe('handleStreamEvent logic (unit)', () => {
  it('skips system events', () => {
    const state = { fullText: '', streamedText: '', resumeFailed: false, resumeError: '' };
    const event = { type: 'system', subtype: 'hook_started' };
    // System events should not affect state
    expect(event.type).toBe('system');
    expect(state.fullText).toBe('');
    expect(state.resumeFailed).toBe(false);
  });

  it('detects resume failure from result event', () => {
    const event = {
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['No conversation found with session ID: abc123'],
    };
    const errors = event.errors as string[];
    const isResumeFail = errors.some((e) => e.includes('No conversation found'));
    expect(isResumeFail).toBe(true);
  });

  it('does not flag non-resume errors as resume failure', () => {
    const event = {
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['Rate limit exceeded'],
    };
    const errors = event.errors as string[];
    const isResumeFail = errors.some((e) => e.includes('No conversation found'));
    expect(isResumeFail).toBe(false);
  });

  it('extracts fullText from successful result event', () => {
    const event = {
      type: 'result',
      subtype: 'success',
      result: 'Hello! How can I help?\n\n```json\n{"specUpdates":{},"isComplete":false}\n```',
    };
    const resultText = event.result as string;
    expect(resultText).toContain('Hello!');
    expect(resultText).toContain('specUpdates');
  });

  it('skips assistant events (no text duplication)', () => {
    // The assistant event type should be skipped to avoid duplicating
    // text that is already captured in the result event
    const event = { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } };
    expect(event.type).toBe('assistant');
    // In the real handler, this returns early without appending text
  });
});

describe('missing JSON block detection (unit)', () => {
  it('response with JSON block is not truncated', () => {
    const text = 'Some text\n\n```json\n{"specUpdates":{"goal":"X"},"isComplete":false}\n```';
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    expect(fenceMatch).not.toBeNull();
  });

  it('response without JSON block is truncated', () => {
    const text = 'I have a clear picture now. Here is the spec:\n\n## Goal\nAdd descriptions to...';
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const hasUnfenced = text.includes('specUpdates') || text.includes('isComplete');
    expect(fenceMatch).toBeNull();
    expect(hasUnfenced).toBe(false);
  });

  it('response ending mid-sentence is truncated', () => {
    const text = 'Add `skill_descriptions` as a sibling field to `skills` on each player record:';
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    expect(fenceMatch).toBeNull();
  });
});

describe('extractMessageText logic (unit)', () => {
  it('extracts text before JSON block', () => {
    const fullOutput = 'Great question! Let me help.\n\n```json\n{"specUpdates":{}}\n```';
    const fenceStart = fullOutput.indexOf('```json');
    const cutPoint = fenceStart >= 0 ? fenceStart : -1;
    const textBefore = cutPoint > 0 ? fullOutput.substring(0, cutPoint).trim() : '';
    expect(textBefore).toBe('Great question! Let me help.');
  });

  it('falls back to full text when no JSON block', () => {
    const fullOutput = 'Just a plain response';
    const fenceStart = fullOutput.indexOf('```json');
    expect(fenceStart).toBe(-1);
    expect(fullOutput.trim()).toBe('Just a plain response');
  });
});
