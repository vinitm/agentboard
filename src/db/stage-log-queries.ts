import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { StageLog, StageLogStage, StageLogStatus } from '../types/index.js';

// ── Helper: snake_case row → camelCase object ────────────────────────

function rowToStageLog(row: Record<string, unknown>): StageLog {
  return {
    id: row.id as string,
    taskId: row.task_id as number,
    projectId: row.project_id as string,
    runId: (row.run_id as string) ?? null,
    stage: row.stage as StageLogStage,
    attempt: row.attempt as number,
    filePath: row.file_path as string,
    status: row.status as StageLogStatus,
    summary: (row.summary as string) ?? null,
    tokensUsed: (row.tokens_used as number) ?? null,
    durationMs: (row.duration_ms as number) ?? null,
    createdAt: row.created_at as string,
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) ?? null,
  };
}

// ── Create ────────────────────────────────────────────────────────────

export interface CreateStageLogData {
  taskId: number;
  projectId: string;
  runId?: string;
  stage: StageLogStage;
  attempt?: number;
  filePath: string;
  startedAt: string;
}

export function createStageLog(
  db: Database.Database,
  data: CreateStageLogData
): StageLog {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO stage_logs (id, task_id, project_id, run_id, stage, attempt, file_path, status, started_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`
  ).run(
    id,
    data.taskId,
    data.projectId,
    data.runId ?? null,
    data.stage,
    data.attempt ?? 1,
    data.filePath,
    data.startedAt,
    now
  );
  return getStageLogById(db, id)!;
}

// ── Read ──────────────────────────────────────────────────────────────

export function getStageLogById(
  db: Database.Database,
  id: string
): StageLog | undefined {
  const row = db.prepare('SELECT * FROM stage_logs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToStageLog(row) : undefined;
}

export function listStageLogsByTask(
  db: Database.Database,
  taskId: number
): StageLog[] {
  const rows = db
    .prepare('SELECT * FROM stage_logs WHERE task_id = ? ORDER BY started_at ASC')
    .all(taskId) as Record<string, unknown>[];
  return rows.map(rowToStageLog);
}

// ── Update ────────────────────────────────────────────────────────────

export interface UpdateStageLogData {
  status?: StageLogStatus;
  summary?: string | null;
  tokensUsed?: number | null;
  durationMs?: number | null;
  completedAt?: string;
  runId?: string;
}

export function updateStageLog(
  db: Database.Database,
  id: string,
  data: UpdateStageLogData
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.summary !== undefined) { fields.push('summary = ?'); values.push(data.summary); }
  if (data.tokensUsed !== undefined) { fields.push('tokens_used = ?'); values.push(data.tokensUsed); }
  if (data.durationMs !== undefined) { fields.push('duration_ms = ?'); values.push(data.durationMs); }
  if (data.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(data.completedAt); }
  if (data.runId !== undefined) { fields.push('run_id = ?'); values.push(data.runId); }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE stage_logs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

// ── Recovery helpers ──────────────────────────────────────────────────

export function listStaleRunningLogs(db: Database.Database): StageLog[] {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM stage_logs WHERE status = 'running' AND started_at < ?`
    )
    .all(thirtyMinutesAgo) as Record<string, unknown>[];
  return rows.map(rowToStageLog);
}

export function markStageLogFailed(db: Database.Database, id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE stage_logs SET status = 'failed', completed_at = ? WHERE id = ?`
  ).run(now, id);
}

// ── Cost aggregation queries ─────────────────────────────────────────

export interface TaskCostRollup {
  taskId: number;
  totalTokens: number;
  totalDurationMs: number;
  stageCount: number;
  stages: Array<{
    stage: string;
    tokens: number;
    durationMs: number;
    attempts: number;
  }>;
}

export function getTaskCostRollup(
  db: Database.Database,
  taskId: number
): TaskCostRollup {
  const rows = db.prepare(
    `SELECT stage,
            COALESCE(SUM(tokens_used), 0) AS tokens,
            COALESCE(SUM(duration_ms), 0) AS duration_ms,
            COUNT(*) AS attempts
     FROM stage_logs
     WHERE task_id = ?
     GROUP BY stage
     ORDER BY MIN(started_at) ASC`
  ).all(taskId) as Array<{ stage: string; tokens: number; duration_ms: number; attempts: number }>;

  const totalTokens = rows.reduce((sum, r) => sum + r.tokens, 0);
  const totalDurationMs = rows.reduce((sum, r) => sum + r.duration_ms, 0);

  return {
    taskId,
    totalTokens,
    totalDurationMs,
    stageCount: rows.length,
    stages: rows.map(r => ({
      stage: r.stage,
      tokens: r.tokens,
      durationMs: r.duration_ms,
      attempts: r.attempts,
    })),
  };
}

export interface StageCostBreakdown {
  stage: string;
  totalTokens: number;
  totalDurationMs: number;
  taskCount: number;
  avgTokensPerTask: number;
  avgDurationPerTask: number;
}

export function getStageCostBreakdown(
  db: Database.Database,
  projectId: string
): StageCostBreakdown[] {
  const rows = db.prepare(
    `SELECT stage,
            COALESCE(SUM(tokens_used), 0) AS total_tokens,
            COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
            COUNT(DISTINCT task_id) AS task_count
     FROM stage_logs
     WHERE project_id = ?
     GROUP BY stage
     ORDER BY total_tokens DESC`
  ).all(projectId) as Array<{
    stage: string;
    total_tokens: number;
    total_duration_ms: number;
    task_count: number;
  }>;

  return rows.map(r => ({
    stage: r.stage,
    totalTokens: r.total_tokens,
    totalDurationMs: r.total_duration_ms,
    taskCount: r.task_count,
    avgTokensPerTask: r.task_count > 0 ? Math.round(r.total_tokens / r.task_count) : 0,
    avgDurationPerTask: r.task_count > 0 ? Math.round(r.total_duration_ms / r.task_count) : 0,
  }));
}

export interface CostTrendPoint {
  date: string;
  totalTokens: number;
  totalDurationMs: number;
  taskCount: number;
}

export function getCostTrend(
  db: Database.Database,
  projectId: string,
  days: number = 30
): CostTrendPoint[] {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(
    `SELECT DATE(started_at) AS date,
            COALESCE(SUM(tokens_used), 0) AS total_tokens,
            COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
            COUNT(DISTINCT task_id) AS task_count
     FROM stage_logs
     WHERE project_id = ? AND started_at >= ?
     GROUP BY DATE(started_at)
     ORDER BY date ASC`
  ).all(projectId, since) as Array<{
    date: string;
    total_tokens: number;
    total_duration_ms: number;
    task_count: number;
  }>;

  return rows.map(r => ({
    date: r.date,
    totalTokens: r.total_tokens,
    totalDurationMs: r.total_duration_ms,
    taskCount: r.task_count,
  }));
}
