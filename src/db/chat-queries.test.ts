import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../test/helpers.js';
import {
  createChatMessage, listChatMessagesByTask, deleteChatMessagesByTask,
  createProject, createTask, updateTask, getTaskById,
} from './queries.js';
import type Database from 'better-sqlite3';

describe('chat message queries', () => {
  let db: Database.Database;
  let taskId: string;

  beforeEach(() => {
    db = createTestDb();
    const project = createProject(db, { name: 'test', path: '/tmp/test-chat', configPath: '/tmp/test-chat/.agentboard' });
    const task = createTask(db, { projectId: project.id, title: 'Test task' });
    taskId = task.id;
  });

  it('creates and lists chat messages in order', () => {
    createChatMessage(db, { taskId, role: 'user', content: 'hello' });
    createChatMessage(db, { taskId, role: 'assistant', content: 'hi back' });
    const messages = listChatMessagesByTask(db, taskId);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('hello');
    expect(messages[0].taskId).toBe(taskId);
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('hi back');
  });

  it('returns empty array for task with no messages', () => {
    const messages = listChatMessagesByTask(db, taskId);
    expect(messages).toHaveLength(0);
  });

  it('deletes all messages for a task', () => {
    createChatMessage(db, { taskId, role: 'user', content: 'hello' });
    createChatMessage(db, { taskId, role: 'assistant', content: 'hi' });
    deleteChatMessagesByTask(db, taskId);
    expect(listChatMessagesByTask(db, taskId)).toHaveLength(0);
  });

  it('persists and retrieves chatSessionId on task', () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    updateTask(db, taskId, { chatSessionId: sessionId });
    const updated = getTaskById(db, taskId);
    expect(updated?.chatSessionId).toBe(sessionId);
  });

  it('chatSessionId defaults to null on new tasks', () => {
    const task = getTaskById(db, taskId);
    expect(task?.chatSessionId).toBeNull();
  });

  it('does not affect other tasks when deleting', () => {
    const task2 = createTask(db, { projectId: (createProject(db, { name: 'p2', path: '/tmp/test-chat-2', configPath: '/tmp/test-chat-2/.agentboard' })).id, title: 'Other' });
    createChatMessage(db, { taskId, role: 'user', content: 'msg1' });
    createChatMessage(db, { taskId: task2.id, role: 'user', content: 'msg2' });
    deleteChatMessagesByTask(db, taskId);
    expect(listChatMessagesByTask(db, taskId)).toHaveLength(0);
    expect(listChatMessagesByTask(db, task2.id)).toHaveLength(1);
  });
});
