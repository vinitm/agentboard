import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Run a git command in a given working directory.
 */
async function git(
  args: string[],
  cwd: string
): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

/**
 * Create a git worktree with a new branch for the given task.
 * Branch name: `<branchPrefix><taskId>-<slug>`
 * Worktree placed in: `<repoPath>/.agentboard/worktrees/<taskId>`
 */
export async function createWorktree(
  repoPath: string,
  taskId: string,
  slug: string,
  baseBranch: string,
  branchPrefix: string
): Promise<{ worktreePath: string; branch: string }> {
  const branch = `${branchPrefix}${taskId}-${slug}`;
  const worktreePath = path.join(repoPath, '.agentboard', 'worktrees', taskId);

  await git(
    ['worktree', 'add', '-b', branch, worktreePath, baseBranch],
    repoPath
  );

  return { worktreePath, branch };
}

/**
 * Remove a git worktree and its associated branch.
 */
export async function cleanupWorktree(repoPath: string, worktreePath: string, branch?: string): Promise<void> {
  // Remove the worktree
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoPath });
  } catch {
    // Worktree may already be gone — prune stale entries
    await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath }).catch(() => {});
  }

  // Delete the branch if provided
  if (branch) {
    try {
      await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath });
    } catch {
      // Branch may already be gone
    }
  }
}

/**
 * Stage all changes and commit, returning the commit SHA.
 */
export async function commitChanges(
  worktreePath: string,
  message: string
): Promise<string> {
  await git(['add', '-A'], worktreePath);

  // Check if there are staged changes before committing
  try {
    await git(['diff', '--cached', '--quiet'], worktreePath);
    // If diff --cached --quiet exits 0, there are NO changes staged
    throw new Error('No changes to commit — implementation produced no file modifications');
  } catch (error) {
    if (error instanceof Error && error.message.includes('No changes to commit')) {
      throw error;
    }
    // diff --cached --quiet exits 1 when there ARE changes — proceed with commit
  }

  await git(['commit', '-m', message], worktreePath);
  return getCurrentSha(worktreePath);
}

/**
 * Push a branch to a remote.
 */
export async function pushBranch(
  worktreePath: string,
  branch: string,
  remote: string
): Promise<void> {
  await git(['push', '-u', remote, branch], worktreePath);
}

/**
 * Get the current HEAD SHA.
 */
export async function getCurrentSha(worktreePath: string): Promise<string> {
  return git(['rev-parse', 'HEAD'], worktreePath);
}
