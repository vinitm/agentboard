import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig } from '../../types/index.js';
import { pushBranch } from '../git.js';
import {
  createRun,
  updateRun,
  createArtifact,
  listGitRefsByTask,
  updateGitRef,
  getLatestRunByTaskAndStage,
  listArtifactsByRun,
} from '../../db/queries.js';

const execFileAsync = promisify(execFile);

export interface PRResult {
  prUrl: string;
  prNumber: number;
}

/**
 * Create a pull request for a completed task.
 *
 * - Pushes the branch to remote
 * - Creates a PR via `gh pr create`
 * - Adds labels: agentboard, risk:<level>
 * - Stores PR URL as artifact
 * - Updates GitRef status to 'pr_open'
 */
export async function createPR(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig
): Promise<PRResult> {
  // Create a run record for PR creation
  const run = createRun(db, {
    taskId: task.id,
    stage: 'pr_creation',
    modelUsed: null,
    input: JSON.stringify({ taskId: task.id, worktreePath }),
  });

  try {
    // Get the git ref for this task
    const gitRefs = listGitRefsByTask(db, task.id);
    if (gitRefs.length === 0) {
      throw new Error(`No git ref found for task ${task.id}`);
    }
    const gitRef = gitRefs[0];

    // Push the branch to remote
    await pushBranch(worktreePath, gitRef.branch, config.githubRemote);

    // Update git ref status to 'pushed'
    updateGitRef(db, gitRef.id, { status: 'pushed' });

    // Build PR body
    const prBody = buildPRBody(db, task);

    // Create PR via gh CLI
    const ghArgs = [
      'pr', 'create',
      '--title', `${task.title}`,
      '--body', prBody,
      '--label', 'agentboard',
      '--label', `risk:${task.riskLevel}`,
      '--head', gitRef.branch,
    ];
    if (config.prDraft) {
      ghArgs.push('--draft');
    }

    const { stdout } = await execFileAsync('gh', ghArgs, {
      cwd: worktreePath,
      timeout: 60_000,
    });

    // Parse PR URL from gh output
    const prUrl = stdout.trim();
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

    // Update git ref status to 'pr_open'
    updateGitRef(db, gitRef.id, { status: 'pr_open' });

    // Store PR URL as artifact
    createArtifact(db, {
      runId: run.id,
      type: 'pr',
      name: 'pr_url',
      content: prUrl,
    });

    createArtifact(db, {
      runId: run.id,
      type: 'pr',
      name: 'pr_number',
      content: String(prNumber),
    });

    // Update run as success
    updateRun(db, run.id, {
      status: 'success',
      output: JSON.stringify({ prUrl, prNumber }),
      finishedAt: new Date().toISOString(),
    });

    return { prUrl, prNumber };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    updateRun(db, run.id, {
      status: 'failed',
      output: errorMessage,
      finishedAt: new Date().toISOString(),
    });

    throw error;
  }
}

/**
 * Build the PR body from task data and run artifacts.
 */
function buildPRBody(db: Database.Database, task: Task): string {
  const sections: string[] = [];

  // Summary from planning artifacts
  const planningRun = getLatestRunByTaskAndStage(db, task.id, 'planning');
  let planSummary = 'No plan summary available.';
  if (planningRun) {
    const artifacts = listArtifactsByRun(db, planningRun.id);
    const summaryArtifact = artifacts.find((a) => a.name === 'plan_summary');
    if (summaryArtifact) {
      planSummary = summaryArtifact.content;
    }
  }

  sections.push('## Summary');
  sections.push(planSummary);

  // Task info
  sections.push('## Task');
  sections.push(`**Title:** ${task.title}`);
  sections.push(`**Risk Level:** ${task.riskLevel}`);

  // Acceptance criteria from spec
  if (task.spec) {
    sections.push('## Acceptance Criteria');
    sections.push(task.spec);
  }

  // Check results
  const checksRun = getLatestRunByTaskAndStage(db, task.id, 'checks');
  if (checksRun?.output) {
    sections.push('## Check Results');
    sections.push('<details><summary>Checks</summary>');
    sections.push('');
    try {
      const checkResults = JSON.parse(checksRun.output) as Array<{
        name: string;
        passed: boolean;
        output: string;
      }>;
      for (const check of checkResults) {
        const icon = check.passed ? '\u2705' : '\u274c';
        sections.push(`${icon} **${check.name}**`);
      }
    } catch {
      sections.push(checksRun.output.slice(0, 1000));
    }
    sections.push('');
    sections.push('</details>');
  }

  // Review results
  const specReviewRun = getLatestRunByTaskAndStage(db, task.id, 'review_spec');
  const codeReviewRun = getLatestRunByTaskAndStage(db, task.id, 'review_code');

  sections.push('## Review');

  if (specReviewRun?.output) {
    try {
      const specResult = JSON.parse(specReviewRun.output) as { passed: boolean };
      const icon = specResult.passed ? '\u2705 Passed' : '\u274c Failed';
      sections.push(`- Spec compliance: ${icon}`);
    } catch {
      sections.push('- Spec compliance: \u2753 Unknown');
    }
  } else {
    sections.push('- Spec compliance: \u2753 Not run');
  }

  if (codeReviewRun?.output) {
    try {
      const codeResult = JSON.parse(codeReviewRun.output) as { passed: boolean };
      const icon = codeResult.passed ? '\u2705 Passed' : '\u274c Failed';
      sections.push(`- Code quality: ${icon}`);
    } catch {
      sections.push('- Code quality: \u2753 Unknown');
    }
  } else {
    sections.push('- Code quality: \u2753 Not run');
  }

  return sections.join('\n');
}
