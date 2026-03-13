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

  // Recover stalled subtask chains: parent is in 'implementing' but no child
  // is ready or in an agent-controlled status, yet backlog children remain.
  // This happens if a crash occurs between completing a subtask and promoting
  // the next one.
  recovered += recoverStalledSubtaskChains(db);

  return recovered;
}

/**
 * Find parents in 'implementing' whose subtask chain has stalled:
 * no child is ready or being worked on, but backlog children exist.
 * Promote the first backlog child to 'ready'.
 */
function recoverStalledSubtaskChains(db: Database.Database): number {
  const now = new Date().toISOString();
  const activeStatuses = ['ready', ...AGENT_CONTROLLED_STATUSES, 'blocked'];

  // Find parent tasks in 'implementing' that have at least one child
  const parents = db
    .prepare(
      `SELECT DISTINCT t.id, t.title FROM tasks t
       JOIN tasks c ON c.parent_task_id = t.id
       WHERE t.status = 'implementing'`
    )
    .all() as Array<{ id: string; title: string }>;

  let recovered = 0;

  for (const parent of parents) {
    const children = db
      .prepare('SELECT id, status FROM tasks WHERE parent_task_id = ?')
      .all(parent.id) as Array<{ id: string; status: string }>;

    const hasActive = children.some(c => activeStatuses.includes(c.status));
    const hasBacklog = children.some(c => c.status === 'backlog');

    if (!hasActive && hasBacklog) {
      // Chain is stalled — promote first backlog child
      const nextChild = db
        .prepare(
          `SELECT id, title FROM tasks WHERE parent_task_id = ? AND status = 'backlog'
           ORDER BY created_at ASC, rowid ASC LIMIT 1`
        )
        .get(parent.id) as { id: string; title: string } | undefined;

      if (nextChild) {
        db.prepare(
          `UPDATE tasks SET status = 'ready', updated_at = ? WHERE id = ?`
        ).run(now, nextChild.id);

        console.log(
          `[recovery] Promoted stalled subtask "${nextChild.title}" (${nextChild.id}) from backlog to ready (parent: ${parent.title})`
        );
        recovered++;
      }
    }
  }

  return recovered;
}
