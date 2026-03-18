import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test/helpers.js';
import {
  createStageLog,
  updateStageLog,
  getTaskCostRollup,
  getStageCostBreakdown,
  getCostTrend,
} from './stage-log-queries.js';

describe('cost aggregation queries', () => {
  let db: Database.Database;
  const projectId = 'proj-1';

  beforeEach(() => {
    db = createTestDb();
    // Insert project and task
    db.prepare('INSERT INTO projects (id, name, path, config_path) VALUES (?, ?, ?, ?)').run(
      projectId, 'Test', '/tmp/test', '/tmp/test/.agentboard/config.json'
    );
    db.prepare('INSERT INTO tasks (id, project_id, title, description, status, risk_level, priority, column_position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      1, projectId, 'Task 1', 'desc', 'done', 'low', 0, 0
    );
    db.prepare('INSERT INTO tasks (id, project_id, title, description, status, risk_level, priority, column_position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      2, projectId, 'Task 2', 'desc', 'done', 'low', 0, 0
    );
  });

  function addStageLog(taskId: number, stage: string, tokens: number, durationMs: number) {
    const log = createStageLog(db, {
      taskId,
      projectId,
      stage: stage as 'planning',
      filePath: `logs/${taskId}/${stage}.log`,
      startedAt: new Date().toISOString(),
    });
    updateStageLog(db, log.id, {
      status: 'completed',
      tokensUsed: tokens,
      durationMs,
      completedAt: new Date().toISOString(),
    });
    return log;
  }

  describe('getTaskCostRollup', () => {
    it('returns zero rollup for task with no logs', () => {
      const rollup = getTaskCostRollup(db, 1);
      expect(rollup.taskId).toBe(1);
      expect(rollup.totalTokens).toBe(0);
      expect(rollup.totalDurationMs).toBe(0);
      expect(rollup.stages).toHaveLength(0);
    });

    it('aggregates tokens and duration by stage', () => {
      addStageLog(1, 'planning', 5000, 10000);
      addStageLog(1, 'implementing', 20000, 30000);
      addStageLog(1, 'implementing', 8000, 12000);
      addStageLog(1, 'checks', 3000, 5000);

      const rollup = getTaskCostRollup(db, 1);
      expect(rollup.totalTokens).toBe(36000);
      expect(rollup.totalDurationMs).toBe(57000);
      expect(rollup.stageCount).toBe(3);

      const impl = rollup.stages.find(s => s.stage === 'implementing');
      expect(impl?.tokens).toBe(28000);
      expect(impl?.attempts).toBe(2);
    });
  });

  describe('getStageCostBreakdown', () => {
    it('returns empty array for project with no logs', () => {
      const breakdown = getStageCostBreakdown(db, projectId);
      expect(breakdown).toHaveLength(0);
    });

    it('breaks down costs across tasks', () => {
      addStageLog(1, 'planning', 5000, 10000);
      addStageLog(1, 'implementing', 20000, 30000);
      addStageLog(2, 'planning', 3000, 8000);
      addStageLog(2, 'implementing', 15000, 25000);

      const breakdown = getStageCostBreakdown(db, projectId);
      expect(breakdown.length).toBe(2);

      const impl = breakdown.find(s => s.stage === 'implementing');
      expect(impl?.totalTokens).toBe(35000);
      expect(impl?.taskCount).toBe(2);
      expect(impl?.avgTokensPerTask).toBe(17500);
    });
  });

  describe('getCostTrend', () => {
    it('returns daily aggregated points', () => {
      addStageLog(1, 'planning', 5000, 10000);
      addStageLog(1, 'implementing', 20000, 30000);

      const trend = getCostTrend(db, projectId, 30);
      expect(trend.length).toBeGreaterThanOrEqual(1);
      expect(trend[0].totalTokens).toBe(25000);
      expect(trend[0].taskCount).toBe(1);
    });

    it('returns empty for different project', () => {
      addStageLog(1, 'planning', 5000, 10000);
      const trend = getCostTrend(db, 'other-project', 30);
      expect(trend).toHaveLength(0);
    });
  });
});
