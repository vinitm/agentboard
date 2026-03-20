/**
 * E2E: Chat progress persistence on mid-session close.
 *
 * Tests that when a user starts a spec conversation and closes
 * the dialog before the bot finishes (or even responds), the task
 * and any partial progress survive in the database.
 *
 * Validates: task creation → partial chat persistence → task remains
 * in backlog → chat history is recoverable → spec updates survive.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createProject,
  createTask,
  getTaskById,
  updateTask,
  createChatMessage,
  listChatMessagesByTask,
  listTasksByProject,
} from '../src/db/queries.js';
import { createTestDb } from '../src/test/helpers.js';

let db: Database.Database;
let projectId: string;

beforeEach(() => {
  db = createTestDb();
  const project = createProject(db, {
    name: 'chat-progress-test',
    path: '/tmp/chat-progress',
    configPath: '/tmp/chat-progress/.agentboard',
  });
  projectId = project.id;
});

afterEach(() => {
  db.close();
});

describe('Chat progress persistence', () => {
  describe('Scenario: user closes before bot responds', () => {
    it('task remains in backlog after creation even with no chat messages', () => {
      // Simulates: user sends first message → task created → user closes immediately
      const task = createTask(db, {
        projectId,
        title: 'Add dark mode',
      });

      // Task should exist and be in backlog
      const found = getTaskById(db, task.id);
      expect(found).not.toBeNull();
      expect(found!.status).toBe('backlog');

      // Task should appear in project task list
      const tasks = listTasksByProject(db, projectId);
      expect(tasks.some(t => t.id === task.id)).toBe(true);
    });

    it('user message is persisted even if assistant never replies', () => {
      const task = createTask(db, {
        projectId,
        title: 'Add dark mode',
      });

      // Server persists user message before spawning Claude
      createChatMessage(db, {
        taskId: task.id,
        role: 'user',
        content: 'I want a dark mode toggle in the settings page',
      });

      // User closes dialog — no assistant message saved
      const messages = listChatMessagesByTask(db, task.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('I want a dark mode toggle in the settings page');
    });

    it('task with user message is not deleted (simulates cancel without delete)', () => {
      const task = createTask(db, {
        projectId,
        title: 'Add dark mode',
      });

      createChatMessage(db, {
        taskId: task.id,
        role: 'user',
        content: 'I want dark mode',
      });

      // Verify task still exists (handleCancel should NOT delete it)
      const found = getTaskById(db, task.id);
      expect(found).not.toBeNull();
      expect(found!.status).toBe('backlog');
    });
  });

  describe('Scenario: user closes mid-stream (partial assistant response)', () => {
    it('partial assistant message is saved to chat_messages', () => {
      const task = createTask(db, {
        projectId,
        title: 'Add dark mode',
      });
      updateTask(db, task.id, { chatSessionId: 'session-123' });

      // User message
      createChatMessage(db, {
        taskId: task.id,
        role: 'user',
        content: 'I want dark mode',
      });

      // Partial assistant response (saved by server on disconnect)
      createChatMessage(db, {
        taskId: task.id,
        role: 'assistant',
        content: 'Great! Let me help you design the dark mode feature. First, a few questions:\n\n1. Should it follow the OS preference',
      });

      const messages = listChatMessagesByTask(db, task.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toContain('dark mode');
    });

    it('partial spec updates are preserved', () => {
      const task = createTask(db, {
        projectId,
        title: 'Add dark mode',
      });

      // Simulate: first turn completed, spec partially filled
      updateTask(db, task.id, {
        chatSessionId: 'session-123',
        spec: JSON.stringify({
          goal: 'Add a dark mode toggle to the settings page',
          userScenarios: '',  // Not yet filled
          successCriteria: '', // Not yet filled
        }),
      });

      // User closes mid-second-turn — spec should retain first turn's updates
      const found = getTaskById(db, task.id);
      const spec = JSON.parse(found!.spec!);
      expect(spec.goal).toBe('Add a dark mode toggle to the settings page');
      expect(spec.userScenarios).toBe('');
      expect(spec.successCriteria).toBe('');
    });
  });

  describe('Scenario: resume spec chat after reopening', () => {
    it('chat history is fully recoverable from DB', () => {
      const task = createTask(db, {
        projectId,
        title: 'Add dark mode',
      });
      updateTask(db, task.id, { chatSessionId: 'session-123' });

      // Multi-turn conversation
      createChatMessage(db, { taskId: task.id, role: 'user', content: 'I want dark mode' });
      createChatMessage(db, { taskId: task.id, role: 'assistant', content: 'What pages should support dark mode?' });
      createChatMessage(db, { taskId: task.id, role: 'user', content: 'All pages' });
      createChatMessage(db, { taskId: task.id, role: 'assistant', content: 'Should it persist across sessions?' });

      // User closes dialog, comes back later — all messages are recoverable
      const messages = listChatMessagesByTask(db, task.id);
      expect(messages).toHaveLength(4);
      expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    });

    it('chatSessionId survives close and allows resume', () => {
      const task = createTask(db, {
        projectId,
        title: 'Add dark mode',
      });
      updateTask(db, task.id, { chatSessionId: 'session-456' });

      // Simulate close + reopen — chatSessionId should still be there
      const found = getTaskById(db, task.id);
      expect(found!.chatSessionId).toBe('session-456');
    });

    it('spec updates accumulate across sessions without regressing', () => {
      const task = createTask(db, {
        projectId,
        title: 'Add dark mode',
      });

      // First session: goal filled
      updateTask(db, task.id, {
        chatSessionId: 'session-1',
        spec: JSON.stringify({
          goal: 'Dark mode toggle',
          userScenarios: '',
          successCriteria: '',
        }),
      });

      // User closes, comes back, second session: userScenarios filled
      // Server creates new session but preserves spec
      updateTask(db, task.id, {
        chatSessionId: 'session-2',
      });

      // Merge spec — only update non-empty fields (simulates server logic)
      const existingSpec = JSON.parse(getTaskById(db, task.id)!.spec!);
      const newUpdates = { userScenarios: 'User clicks toggle in settings' };
      for (const [key, val] of Object.entries(newUpdates)) {
        if (typeof val === 'string' && val.trim().length > 0) {
          existingSpec[key] = val;
        }
      }
      updateTask(db, task.id, { spec: JSON.stringify(existingSpec) });

      // Verify both fields are filled, nothing regressed
      const final = JSON.parse(getTaskById(db, task.id)!.spec!);
      expect(final.goal).toBe('Dark mode toggle');
      expect(final.userScenarios).toBe('User clicks toggle in settings');
      expect(final.successCriteria).toBe('');
    });
  });

  describe('Scenario: task visibility on the board', () => {
    it('backlog task with chatSessionId is listed in project tasks', () => {
      const task = createTask(db, {
        projectId,
        title: 'Add dark mode',
      });
      updateTask(db, task.id, { chatSessionId: 'session-abc' });

      const tasks = listTasksByProject(db, projectId);
      const found = tasks.find(t => t.id === task.id);
      expect(found).toBeDefined();
      expect(found!.status).toBe('backlog');
      expect(found!.chatSessionId).toBe('session-abc');
    });

    it('multiple draft tasks coexist without interference', () => {
      const task1 = createTask(db, { projectId, title: 'Task A' });
      const task2 = createTask(db, { projectId, title: 'Task B' });
      updateTask(db, task1.id, { chatSessionId: 'session-1' });
      updateTask(db, task2.id, { chatSessionId: 'session-2' });

      createChatMessage(db, { taskId: task1.id, role: 'user', content: 'Spec for A' });
      createChatMessage(db, { taskId: task2.id, role: 'user', content: 'Spec for B' });

      const msgs1 = listChatMessagesByTask(db, task1.id);
      const msgs2 = listChatMessagesByTask(db, task2.id);
      expect(msgs1).toHaveLength(1);
      expect(msgs2).toHaveLength(1);
      expect(msgs1[0].content).toBe('Spec for A');
      expect(msgs2[0].content).toBe('Spec for B');
    });
  });

  describe('Scenario: task NOT created yet (user closes before first send)', () => {
    it('no task exists if user never sent a message', () => {
      // User opened dialog, typed but never hit send, closed
      // No API call was made → no task in DB
      const tasks = listTasksByProject(db, projectId);
      expect(tasks).toHaveLength(0);
    });
  });
});
