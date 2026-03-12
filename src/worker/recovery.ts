import type Database from 'better-sqlite3';
import type { TaskStatus } from '../types/index.js';

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

const AGENT_CONTROLLED_STATUSES: TaskStatus[] = [
  'planning',
  'implementing',
  'checks',
  'review_spec',
  'review_code',
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
      id: string;
      title: string;
      status: string;
      claimed_at: string;
    }>;

    for (const row of rows) {
      db.prepare(
        `UPDATE tasks SET status = 'ready', claimed_at = NULL, claimed_by = NULL, updated_at = ? WHERE id = ?`
      ).run(now, row.id);

      console.log(
        `[recovery] Reset stale task "${row.title}" (${row.id}) from ${row.status} to ready (claimed at ${row.claimed_at})`
      );
      recovered++;
    }
  }

  return recovered;
}
