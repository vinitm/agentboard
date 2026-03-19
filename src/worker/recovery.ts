import type Database from 'better-sqlite3';
import type { TaskStatus } from '../types/index.js';
import { listStaleRunningLogs, markStageLogFailed } from '../db/stage-log-queries.js';

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

const AGENT_CONTROLLED_STATUSES: TaskStatus[] = [
  'spec_review',
  'planning',
  'implementing',
  'checks',
  'code_quality',
  'final_review',
];

/**
 * Recover tasks stuck in agent-controlled columns from a previous crash.
 * Tasks claimed more than 30 minutes ago are considered stale and are
 * reset to 'ready' with their claim cleared.
 *
 * Returns the number of recovered tasks.
 */
export function recoverStaleTasks(db: Database.Database): number {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
  const now = new Date().toISOString();
  let recovered = 0;

  for (const status of AGENT_CONTROLLED_STATUSES) {
    const rows = db
      .prepare(
        `SELECT id, title, status, claimed_at FROM tasks
         WHERE status = ? AND claimed_at IS NOT NULL AND claimed_at < ?`
      )
      .all(status, cutoff) as Array<{
      id: number;
      title: string;
      status: string;
      claimed_at: string;
    }>;

    for (const row of rows) {
      const resetStatus = 'ready';
      db.prepare(
        `UPDATE tasks SET status = ?, claimed_at = NULL, claimed_by = NULL, updated_at = ? WHERE id = ?`
      ).run(resetStatus, now, row.id);

      console.log(
        `[recovery] Reset stale task "${row.title}" (${row.id}) from ${row.status} to ${resetStatus} (claimed at ${row.claimed_at})`
      );
      recovered++;
    }
  }

  // Mark stale stage_logs as failed: stage_logs left in 'running' state from
  // a previous crash are marked failed so the UI doesn't show a spinner forever.
  const staleLogs = listStaleRunningLogs(db);
  for (const log of staleLogs) {
    markStageLogFailed(db, log.id);
    console.log(`[recovery] Marked stale stage_log ${log.id} (${log.stage}) as failed`);
  }

  return recovered;
}

