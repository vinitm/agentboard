import { spawn } from 'node:child_process';
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
  listRunsByTask,
  getTaskById,
  getSubtasksByParentId,
} from '../../db/queries.js';

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
  config: AgentboardConfig,
  onOutput?: (chunk: string) => void
): Promise<PRResult> {
  // Create a run record for PR creation
  const run = createRun(db, {
    taskId: task.id,
    stage: 'pr_creation',
    modelUsed: null,
    input: JSON.stringify({ taskId: task.id, worktreePath }),
  });

  try {
    // Get the git ref for this task (subtasks reuse parent's worktree/branch)
    let gitRefs = listGitRefsByTask(db, task.id);
    if (gitRefs.length === 0 && task.parentTaskId) {
      gitRefs = listGitRefsByTask(db, task.parentTaskId);
    }
    if (gitRefs.length === 0) {
      throw new Error(`No git ref found for task ${task.id}`);
    }
    const gitRef = gitRefs[0];

    // Verify gh CLI is available before pushing (pushing is irreversible)
    const ghCheck = await new Promise<boolean>((resolve) => {
      const child = spawn('gh', ['auth', 'status'], { stdio: 'pipe' });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
    if (!ghCheck) {
      throw new Error(
        'GitHub CLI (gh) is not installed or not authenticated. ' +
        'Install from https://cli.github.com and run `gh auth login`.'
      );
    }

    // Push the branch to remote
    onOutput?.(`[pr] Pushing branch ${gitRef.branch} to ${config.githubRemote}...\n`);
    await pushBranch(worktreePath, gitRef.branch, config.githubRemote);
    onOutput?.(`[pr] Branch pushed successfully\n`);

    // Update git ref status to 'pushed'
    updateGitRef(db, gitRef.id, { status: 'pushed' });

    // Build PR body
    const prBody = buildPRBody(db, task);

    // Ensure required labels exist on the repo (gh label create is idempotent)
    const labels = ['agentboard', `risk:${task.riskLevel}`];
    for (const label of labels) {
      await new Promise<void>((resolve) => {
        const child = spawn('gh', ['label', 'create', label, '--force'], {
          cwd: worktreePath,
          stdio: 'pipe',
        });
        child.on('close', () => resolve());
        child.on('error', () => resolve());
      });
    }

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

    onOutput?.(`[pr] Creating pull request...\n`);
    const ghOutput = await new Promise<string>((resolve, reject) => {
      const child = spawn('gh', ghArgs, {
        cwd: worktreePath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('gh pr create timed out after 60s'));
      }, 60_000);

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        onOutput?.(`[pr] ${text}`);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        onOutput?.(`[pr] ${text}`);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`gh pr create failed (code ${code}): ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // Parse PR URL from gh output
    const prUrl = ghOutput;
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
 * Collect all planning assumptions for a task and its subtasks.
 */
function collectAssumptions(db: Database.Database, task: Task): string[] {
  const assumptions: string[] = [];

  const planningRun = getLatestRunByTaskAndStage(db, task.id, 'planning');
  if (planningRun) {
    const artifacts = listArtifactsByRun(db, planningRun.id);
    const assumptionArtifact = artifacts.find((a) => a.type === 'assumptions');
    if (assumptionArtifact) {
      try {
        const parsed = JSON.parse(assumptionArtifact.content) as string[];
        assumptions.push(...parsed);
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  const subtasks = getSubtasksByParentId(db, task.id);
  for (const subtask of subtasks) {
    const subtaskRun = getLatestRunByTaskAndStage(db, subtask.id, 'planning');
    if (subtaskRun) {
      const artifacts = listArtifactsByRun(db, subtaskRun.id);
      const assumptionArtifact = artifacts.find((a) => a.type === 'assumptions');
      if (assumptionArtifact) {
        try {
          const parsed = JSON.parse(assumptionArtifact.content) as string[];
          assumptions.push(...parsed);
        } catch {
          // Malformed JSON — skip
        }
      }
    }
  }

  return assumptions;
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

  // Assumptions from planning
  const assumptions = collectAssumptions(db, task);
  if (assumptions.length > 0) {
    sections.push('## Assumptions Made');
    sections.push('> These decisions were made autonomously. Please verify during review.');
    sections.push('');
    for (const assumption of assumptions) {
      sections.push(`- ${assumption}`);
    }
  }

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

  // Review panel results
  const allRuns = listRunsByTask(db, task.id);
  const panelRuns = allRuns
    .filter(r => r.stage === 'review_panel')
    .slice(-3); // Last 3 = most recent cycle (one per reviewer role)

  sections.push('## Review Panel');

  if (panelRuns.length > 0) {
    const ROLE_LABELS: Record<string, string> = {
      architect: 'Architect',
      qa: 'QA Engineer',
      security: 'Security',
    };

    for (const run of panelRuns) {
      const artifacts = listArtifactsByRun(db, run.id);
      const roleArtifact = artifacts.find(a => a.type === 'review_result');
      if (roleArtifact) {
        try {
          const result = JSON.parse(roleArtifact.content) as { passed: boolean };
          const label = ROLE_LABELS[roleArtifact.name] ?? roleArtifact.name;
          const icon = result.passed ? '\u2705 Passed' : '\u274c Failed';
          sections.push(`- ${label}: ${icon}`);
        } catch {
          sections.push(`- ${roleArtifact.name}: \u2753 Unknown`);
        }
      }
    }
  } else {
    sections.push('- Review panel: \u2753 Not run');
  }

  return sections.join('\n');
}
