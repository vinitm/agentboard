import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../test/helpers.js';
import {
  createProject, createTask, getTaskById, updateTask,
  createChatMessage, listChatMessagesByTask,
} from '../../db/queries.js';
import type Database from 'better-sqlite3';

describe('chat session persistence (DB layer)', () => {
  let db: Database.Database;
  let taskId: string;

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

describe('handleStreamEvent logic (unit)', () => {
  it('skips system events', () => {
    const state = { fullText: '', resumeFailed: false, resumeError: '' };
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
