import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTestRepo } from '../test/helpers.js';
import { listOrphanedBranches } from './prune.js';

const execFileAsync = promisify(execFile);

describe('listOrphanedBranches', () => {
  let repo: Awaited<ReturnType<typeof createTestRepo>>;

  afterEach(() => {
    if (repo) repo.cleanup();
  });

  async function createBranch(repoPath: string, name: string): Promise<void> {
    await execFileAsync('git', ['branch', name], { cwd: repoPath });
  }

  it('returns empty when no agentboard/* branches exist', async () => {
    repo = await createTestRepo();
    const result = await listOrphanedBranches(repo.repoPath);
    expect(result).toEqual([]);
  });

  it('returns agentboard/* branches when DB does not exist', async () => {
    repo = await createTestRepo();
    await createBranch(repo.repoPath, 'agentboard/1-test-task');
    await createBranch(repo.repoPath, 'agentboard/2-other-task');

    // listOrphanedBranches uses GLOBAL_DB_PATH which won't exist in test env
    const result = await listOrphanedBranches(repo.repoPath);
    expect(result).toContain('agentboard/1-test-task');
    expect(result).toContain('agentboard/2-other-task');
  });

  it('does not return non-agentboard branches', async () => {
    repo = await createTestRepo();
    await createBranch(repo.repoPath, 'feature/something');
    await createBranch(repo.repoPath, 'agentboard/1-task');

    const result = await listOrphanedBranches(repo.repoPath);
    expect(result).toContain('agentboard/1-task');
    expect(result).not.toContain('feature/something');
  });
});
