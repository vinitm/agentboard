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
    subtaskId: (row.subtask_id as number) ?? null,
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
  subtaskId?: number;
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
    `INSERT INTO stage_logs (id, task_id, project_id, run_id, stage, subtask_id, attempt, file_path, status, started_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`
  ).run(
    id,
    data.taskId,
    data.projectId,
    data.runId ?? null,
    data.stage,
    data.subtaskId ?? null,
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
