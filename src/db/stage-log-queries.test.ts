import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test/helpers.js';
import { createProject, createTask } from './queries.js';
import {
  createStageLog,
  getStageLogById,
  listStageLogsByTask,
  updateStageLog,
  listStaleRunningLogs,
  markStageLogFailed,
} from './stage-log-queries.js';
import type { StageLog } from '../types/index.js';

describe('stage-log-queries', () => {
  let db: Database.Database;
  let projectId: string;
  let taskId: string;

  beforeEach(() => {
    db = createTestDb();
    const project = createProject(db, {
      name: 'Test Project',
      path: '/test/project',
      configPath: '/test/project/.agentboard/config.json',
    });
    projectId = project.id;

    const task = createTask(db, {
      projectId,
      title: 'Test Task',
      description: 'A task for testing stage logs',
    });
    taskId = task.id;
  });

  describe('createStageLog', () => {
    it('creates and retrieves a stage log', () => {
      const startedAt = new Date().toISOString();
      const log = createStageLog(db, {
        taskId,
        projectId,
        stage: 'implementing',
        filePath: '/logs/task-abc.log',
        startedAt,
      });

      expect(log.id).toBeTruthy();
      expect(log.taskId).toBe(taskId);
      expect(log.projectId).toBe(projectId);
      expect(log.stage).toBe('implementing');
      expect(log.filePath).toBe('/logs/task-abc.log');
      expect(log.startedAt).toBe(startedAt);
      expect(log.status).toBe('running');
      expect(log.runId).toBeNull();
      expect(log.subtaskId).toBeNull();
      expect(log.attempt).toBe(1);
      expect(log.summary).toBeNull();
      expect(log.tokensUsed).toBeNull();
      expect(log.durationMs).toBeNull();
      expect(log.completedAt).toBeNull();
      expect(log.createdAt).toBeTruthy();

      const retrieved = getStageLogById(db, log.id);
      expect(retrieved).toEqual(log);
    });

    it('creates a stage log with optional fields', () => {
      const startedAt = new Date().toISOString();
      const log = createStageLog(db, {
        taskId,
        projectId,
        stage: 'checks',
        subtaskId: 'subtask-456',
        attempt: 3,
        filePath: '/logs/task-abc.log',
        startedAt,
      });

      expect(log.runId).toBeNull();
      expect(log.subtaskId).toBe('subtask-456');
      expect(log.attempt).toBe(3);
    });
  });

  describe('getStageLogById', () => {
    it('returns undefined for non-existent id', () => {
      const result = getStageLogById(db, 'non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('listStageLogsByTask', () => {
    it('lists stage logs by task ordered by started_at', () => {
      const now = Date.now();
      // Insert out of order
      const log2 = createStageLog(db, {
        taskId,
        projectId,
        stage: 'checks',
        filePath: '/logs/task.log',
        startedAt: new Date(now + 1000).toISOString(),
      });
      const log1 = createStageLog(db, {
        taskId,
        projectId,
        stage: 'implementing',
        filePath: '/logs/task.log',
        startedAt: new Date(now).toISOString(),
      });
      const log3 = createStageLog(db, {
        taskId,
        projectId,
        stage: 'code_quality',
        filePath: '/logs/task.log',
        startedAt: new Date(now + 2000).toISOString(),
      });

      const logs = listStageLogsByTask(db, taskId);
      expect(logs).toHaveLength(3);
      expect(logs[0].id).toBe(log1.id);
      expect(logs[1].id).toBe(log2.id);
      expect(logs[2].id).toBe(log3.id);
    });

    it('returns empty array when task has no stage logs', () => {
      const logs = listStageLogsByTask(db, taskId);
      expect(logs).toHaveLength(0);
    });

    it('returns only logs for the specified task', () => {
      const otherTask = createTask(db, {
        projectId,
        title: 'Other Task',
      });

      createStageLog(db, {
        taskId,
        projectId,
        stage: 'implementing',
        filePath: '/logs/task1.log',
        startedAt: new Date().toISOString(),
      });
      createStageLog(db, {
        taskId: otherTask.id,
        projectId,
        stage: 'implementing',
        filePath: '/logs/task2.log',
        startedAt: new Date().toISOString(),
      });

      const logs = listStageLogsByTask(db, taskId);
      expect(logs).toHaveLength(1);
      expect(logs[0].taskId).toBe(taskId);
    });
  });

  describe('updateStageLog', () => {
    it('updates a stage log with completion data', () => {
      const startedAt = new Date().toISOString();
      const log = createStageLog(db, {
        taskId,
        projectId,
        stage: 'implementing',
        filePath: '/logs/task.log',
        startedAt,
      });

      const completedAt = new Date().toISOString();
      updateStageLog(db, log.id, {
        status: 'completed',
        summary: 'Implementation succeeded',
        tokensUsed: 1500,
        durationMs: 45000,
        completedAt,
      });

      const updated = getStageLogById(db, log.id)!;
      expect(updated.status).toBe('completed');
      expect(updated.summary).toBe('Implementation succeeded');
      expect(updated.tokensUsed).toBe(1500);
      expect(updated.durationMs).toBe(45000);
      expect(updated.completedAt).toBe(completedAt);
    });

    it('allows partial updates (only provided fields change)', () => {
      const startedAt = new Date().toISOString();
      const log = createStageLog(db, {
        taskId,
        projectId,
        stage: 'checks',
        filePath: '/logs/task.log',
        startedAt,
      });

      updateStageLog(db, log.id, { status: 'failed' });

      const updated = getStageLogById(db, log.id)!;
      expect(updated.status).toBe('failed');
      expect(updated.summary).toBeNull();
      expect(updated.tokensUsed).toBeNull();
      expect(updated.filePath).toBe('/logs/task.log');
    });

    it('allows setting nullable fields to null', () => {
      const startedAt = new Date().toISOString();
      const log = createStageLog(db, {
        taskId,
        projectId,
        stage: 'implementing',
        filePath: '/logs/task.log',
        startedAt,
      });

      updateStageLog(db, log.id, {
        status: 'completed',
        summary: null,
        tokensUsed: null,
        durationMs: null,
      });

      const updated = getStageLogById(db, log.id)!;
      expect(updated.summary).toBeNull();
      expect(updated.tokensUsed).toBeNull();
      expect(updated.durationMs).toBeNull();
    });

    it('is a no-op when no fields are provided', () => {
      const startedAt = new Date().toISOString();
      const log = createStageLog(db, {
        taskId,
        projectId,
        stage: 'implementing',
        filePath: '/logs/task.log',
        startedAt,
      });

      updateStageLog(db, log.id, {});

      const unchanged = getStageLogById(db, log.id)!;
      expect(unchanged.status).toBe('running');
    });
  });

  describe('listStaleRunningLogs', () => {
    it('finds stale running logs (started_at > 30 min ago, status still running)', () => {
      const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
      const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const staleLog = createStageLog(db, {
        taskId,
        projectId,
        stage: 'implementing',
        filePath: '/logs/task.log',
        startedAt: staleTime,
      });

      createStageLog(db, {
        taskId,
        projectId,
        stage: 'checks',
        filePath: '/logs/task.log',
        startedAt: recentTime,
      });

      const completedStaleLog = createStageLog(db, {
        taskId,
        projectId,
        stage: 'code_quality',
        filePath: '/logs/task.log',
        startedAt: staleTime,
      });
      updateStageLog(db, completedStaleLog.id, { status: 'completed' });

      const stale = listStaleRunningLogs(db);
      expect(stale).toHaveLength(1);
      expect(stale[0].id).toBe(staleLog.id);
      expect(stale[0].status).toBe('running');
    });

    it('returns empty array when no stale logs exist', () => {
      const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      createStageLog(db, {
        taskId,
        projectId,
        stage: 'implementing',
        filePath: '/logs/task.log',
        startedAt: recentTime,
      });

      const stale = listStaleRunningLogs(db);
      expect(stale).toHaveLength(0);
    });
  });

  describe('markStageLogFailed', () => {
    it('sets status to failed and completedAt to now', () => {
      const before = new Date().toISOString();
      const log = createStageLog(db, {
        taskId,
        projectId,
        stage: 'implementing',
        filePath: '/logs/task.log',
        startedAt: new Date().toISOString(),
      });

      markStageLogFailed(db, log.id);

      const updated = getStageLogById(db, log.id)!;
      expect(updated.status).toBe('failed');
      expect(updated.completedAt).toBeTruthy();
      expect(updated.completedAt! >= before).toBe(true);
    });
  });
});
