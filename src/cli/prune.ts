import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import chalk from 'chalk';
import { GLOBAL_DB_PATH } from './paths.js';

const execFileAsync = promisify(execFile);

/**
 * List local agentboard/* branches that have no matching active task in the DB.
 * A branch is "orphaned" if:
 *   - It matches the agentboard/ prefix
 *   - No git_refs row links it to a task with a non-terminal status
 *
 * Returns branch names.
 */
export async function listOrphanedBranches(cwd: string): Promise<string[]> {
  // Get all local agentboard/* branches
  const { stdout } = await execFileAsync(
    'git', ['branch', '--list', 'agentboard/*', '--format=%(refname:short)'],
    { cwd }
  );
  const branches = stdout.trim().split('\n').filter(Boolean);
  if (branches.length === 0) return [];

  // If no DB, all agentboard branches are orphaned
  if (!fs.existsSync(GLOBAL_DB_PATH)) return branches;

  // Query DB for branches linked to active (non-terminal) tasks
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(GLOBAL_DB_PATH, { readonly: true });
  try {
    const activeBranches = new Set<string>();
    const rows = db.prepare(
      `SELECT gr.branch FROM git_refs gr
       JOIN tasks t ON gr.task_id = t.id
       WHERE t.status NOT IN ('done', 'failed', 'cancelled')`
    ).all() as Array<{ branch: string }>;

    for (const row of rows) {
      activeBranches.add(row.branch);
    }

    return branches.filter(b => !activeBranches.has(b));
  } finally {
    db.close();
  }
}

/**
 * Delete a local branch. Skips if the branch is currently checked out.
 */
async function deleteBranch(cwd: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['branch', '-D', branch], { cwd });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('checked out')) {
      console.log(chalk.yellow(`  Skipped ${branch} (currently checked out)`));
      return false;
    }
    console.log(chalk.red(`  Failed to delete ${branch}: ${msg}`));
    return false;
  }
}

export interface PruneOptions {
  dryRun?: boolean;
}

/**
 * CLI command: find and optionally delete orphaned agentboard/* branches.
 */
export default async function prune(opts: PruneOptions = {}): Promise<void> {
  const cwd = process.cwd();

  // Verify git repo
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd });
  } catch {
    console.log(chalk.red('Not a git repository.'));
    process.exit(1);
  }

  console.log(chalk.bold('Scanning for orphaned agentboard/* branches...\n'));

  const orphaned = await listOrphanedBranches(cwd);

  if (orphaned.length === 0) {
    console.log(chalk.green('No orphaned branches found.'));
    return;
  }

  console.log(`Found ${chalk.yellow(String(orphaned.length))} orphaned branch(es):\n`);
  for (const branch of orphaned) {
    console.log(`  ${chalk.dim('•')} ${branch}`);
  }
  console.log('');

  if (opts.dryRun) {
    console.log(chalk.dim('Dry run — no branches deleted. Run without --dry-run to delete.'));
    return;
  }

  let deleted = 0;
  for (const branch of orphaned) {
    const ok = await deleteBranch(cwd, branch);
    if (ok) {
      console.log(chalk.green(`  ✓ Deleted ${branch}`));
      deleted++;
    }
  }

  console.log(
    `\n${chalk.bold(`Deleted ${deleted}/${orphaned.length} orphaned branch(es).`)}`
  );
}
