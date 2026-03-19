import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTestRepo } from '../test/helpers.js';
import {
  createWorktree,
  cleanupWorktree,
  commitChanges,
  getCurrentSha,
} from './git.js';

let repoPath: string;
let cleanup: () => void;

beforeEach(async () => {
  const repo = await createTestRepo();
  repoPath = repo.repoPath;
  cleanup = repo.cleanup;
});

afterEach(() => {
  cleanup();
});

describe('createWorktree', () => {
  it('creates a directory and returns the correct branch name', async () => {
    const { worktreePath, branch } = await createWorktree(
      repoPath,
      1,
      'my-feature',
      'master',
      'agentboard/'
    );

    expect(branch).toBe('agentboard/1-my-feature');
    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(worktreePath).toBe(path.join(repoPath, '.agentboard', 'worktrees', '1'));
  });

  it('recovers when branch exists but worktree was removed', async () => {
    // First call creates the worktree and branch
    const first = await createWorktree(repoPath, 5, 'retry-test', 'master', 'agentboard/');
    expect(fs.existsSync(first.worktreePath)).toBe(true);

    // Remove worktree but leave the branch (simulates a failed run that left the branch behind)
    await cleanupWorktree(repoPath, first.worktreePath);

    // Second call should succeed by cleaning up stale branch and recreating
    const second = await createWorktree(repoPath, 5, 'retry-test', 'master', 'agentboard/');
    expect(second.branch).toBe('agentboard/5-retry-test');
    expect(fs.existsSync(second.worktreePath)).toBe(true);
  });

  it('recovers when both branch and worktree already exist', async () => {
    // First call creates the worktree and branch
    const first = await createWorktree(repoPath, 6, 'full-retry', 'master', 'agentboard/');
    expect(fs.existsSync(first.worktreePath)).toBe(true);

    // Second call with same task ID — both branch and worktree still exist
    const second = await createWorktree(repoPath, 6, 'full-retry', 'master', 'agentboard/');
    expect(second.branch).toBe('agentboard/6-full-retry');
    expect(fs.existsSync(second.worktreePath)).toBe(true);
  });
});

describe('cleanupWorktree', () => {
  it('removes the worktree directory', async () => {
    const { worktreePath, branch } = await createWorktree(
      repoPath,
      2,
      'cleanup-test',
      'master',
      'agentboard/'
    );

    expect(fs.existsSync(worktreePath)).toBe(true);
    await cleanupWorktree(repoPath, worktreePath, branch);
    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  it('handles already-removed worktree without throwing', async () => {
    const nonExistentPath = path.join(repoPath, '.agentboard', 'worktrees', 'ghost');
    await expect(cleanupWorktree(repoPath, nonExistentPath)).resolves.not.toThrow();
  });
});

describe('commitChanges', () => {
  it('stages and commits changes and returns a SHA', async () => {
    const { worktreePath } = await createWorktree(
      repoPath,
      3,
      'commit-test',
      'master',
      'agentboard/'
    );

    fs.writeFileSync(path.join(worktreePath, 'newfile.txt'), 'hello world');
    const sha = await commitChanges(worktreePath, 'add newfile');

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns empty string when there are no changes to commit', async () => {
    const { worktreePath } = await createWorktree(
      repoPath,
      4,
      'no-changes',
      'master',
      'agentboard/'
    );

    const result = await commitChanges(worktreePath, 'empty commit');
    expect(result).toBe('');
  });
});

describe('getCurrentSha', () => {
  it('returns a valid 40-char hex SHA', async () => {
    const sha = await getCurrentSha(repoPath);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
