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
 * Remove a git worktree.
 */
export async function cleanupWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoPath });
}

/**
 * Stage all changes and commit, returning the commit SHA.
 */
export async function commitChanges(
  worktreePath: string,
  message: string
): Promise<string> {
  await git(['add', '-A'], worktreePath);
  await git(['commit', '-m', message, '--allow-empty'], worktreePath);
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
