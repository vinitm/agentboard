import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig } from '../../types/index.js';
import { selectModel } from '../model-selector.js';
import { buildTaskPacket } from '../context-builder.js';
import { executeClaudeCode } from '../executor.js';
import { createRun, updateRun, createArtifact } from '../../db/queries.js';
import type { TaskLogger } from '../log-writer.js';
import { createBufferedWriter } from '../log-writer.js';

export type ReviewerRole = 'architect' | 'qa' | 'security';

export interface ReviewResult {
  passed: boolean;
  feedback: string;
  issues: string[];
}

export interface RoleReviewResult extends ReviewResult {
  role: ReviewerRole;
}

export interface PanelResult {
  passed: boolean;
  results: RoleReviewResult[];
  feedback: string;
}

const ROLES: ReviewerRole[] = ['architect', 'qa', 'security'];

const ROLE_LABELS: Record<ReviewerRole, string> = {
  architect: 'Architect',
  qa: 'QA Engineer',
  security: 'Security Reviewer',
};

const ROLE_PROMPT_FILES: Record<ReviewerRole, string> = {
  architect: 'review-architect.md',
  qa: 'review-qa.md',
  security: 'review-security.md',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadPromptTemplate(role: ReviewerRole): string {
  const promptPath = path.resolve(__dirname, '../../../../prompts', ROLE_PROMPT_FILES[role]);
  try {
    return fs.readFileSync(promptPath, 'utf-8');
  } catch {
    throw new Error(`Review prompt template not found at ${promptPath}`);
  }
}

export function parseReviewOutput(output: string): ReviewResult {
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      return validateReviewResult(JSON.parse(fenceMatch[1]));
    } catch {
      // Fall through
    }
  }

  const jsonMatch = output.match(/\{[\s\S]*"passed"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return validateReviewResult(JSON.parse(jsonMatch[0]));
    } catch {
      // Fall through
    }
  }

  return {
    passed: false,
    feedback: output.slice(0, 2000),
    issues: ['Could not parse structured review output'],
  };
}

function validateReviewResult(data: unknown): ReviewResult {
  const obj = data as Record<string, unknown>;
  return {
    passed: typeof obj.passed === 'boolean' ? obj.passed : false,
    feedback: typeof obj.feedback === 'string' ? obj.feedback : '',
    issues: Array.isArray(obj.issues)
      ? (obj.issues as unknown[]).filter((i): i is string => typeof i === 'string')
      : [],
  };
}

async function runSingleReviewer(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig,
  role: ReviewerRole,
  onOutput?: (chunk: string) => void
): Promise<RoleReviewResult> {
  const model = selectModel('review_panel', task.riskLevel, config);
  const taskPacket = buildTaskPacket(db, task);
  const template = loadPromptTemplate(role);
  const prompt = template.replace('{taskSpec}', () => taskPacket);

  const run = createRun(db, {
    taskId: task.id,
    stage: 'review_panel',
    modelUsed: model,
    input: prompt,
  });

  try {
    const result = await executeClaudeCode({
      prompt,
      worktreePath,
      model,
      onOutput,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Claude Code exited with code ${result.exitCode}: ${result.output}`);
    }

    const reviewResult = parseReviewOutput(result.output);

    updateRun(db, run.id, {
      status: reviewResult.passed ? 'success' : 'failed',
      output: JSON.stringify(reviewResult),
      tokensUsed: result.tokensUsed,
      finishedAt: new Date().toISOString(),
    });

    createArtifact(db, {
      runId: run.id,
      type: 'review_result',
      name: role,
      content: JSON.stringify(reviewResult),
    });

    return { ...reviewResult, role };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    updateRun(db, run.id, {
      status: 'failed',
      output: errorMessage,
      finishedAt: new Date().toISOString(),
    });

    createArtifact(db, {
      runId: run.id,
      type: 'review_result',
      name: role,
      content: JSON.stringify({
        passed: false,
        feedback: `${ROLE_LABELS[role]} reviewer crashed: ${errorMessage}`,
        issues: ['Review execution error'],
      }),
    });

    return {
      role,
      passed: false,
      feedback: `${ROLE_LABELS[role]} reviewer crashed: ${errorMessage}`,
      issues: ['Review execution error'],
    };
  }
}

/**
 * Format the combined panel feedback for the implementer.
 */
export function formatPanelFeedback(
  results: RoleReviewResult[],
  cycle: number,
  maxCycles: number
): string {
  const lines: string[] = [`## Review Panel Feedback (Cycle ${cycle}/${maxCycles})`, ''];

  for (const result of results) {
    const label = ROLE_LABELS[result.role];
    const status = result.passed ? 'PASSED' : 'FAILED';
    lines.push(`### ${label} (${status})`);

    if (result.issues.length > 0) {
      for (const issue of result.issues) {
        lines.push(`- ${issue}`);
      }
    } else if (result.passed) {
      lines.push('No issues.');
    } else {
      lines.push(result.feedback || 'No details provided.');
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Run the review panel: 3 specialized reviewers in parallel.
 * All must pass (unanimous) for the panel to pass.
 * Note: This spawns 3 concurrent Claude processes — with maxConcurrentTasks,
 * the system may have up to 3 * maxConcurrentTasks processes during review.
 */
export async function runReviewPanel(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig,
  onOutput?: (chunk: string) => void,
  logger?: TaskLogger
): Promise<PanelResult> {
  // Create a buffered writer per reviewer so parallel output doesn't interleave
  const buffers = ROLES.map(() => logger ? createBufferedWriter() : undefined);

  const reviewPromises = ROLES.map((role, i) => {
    const buffer = buffers[i];
    // Each reviewer writes to its own buffer (if logger present), plus the original onOutput for WebSocket
    const wrappedOnOutput = (chunk: string) => {
      onOutput?.(chunk);
      buffer?.write(chunk);
    };
    return runSingleReviewer(db, task, worktreePath, config, role, wrappedOnOutput);
  });

  const settledResults = await Promise.allSettled(reviewPromises);

  const results: RoleReviewResult[] = settledResults.map((settled, i) => {
    if (settled.status === 'fulfilled') {
      return settled.value;
    }
    const errorMessage = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
    return {
      role: ROLES[i],
      passed: false,
      feedback: `${ROLE_LABELS[ROLES[i]]} reviewer crashed: ${errorMessage}`,
      issues: ['Review execution error'],
    };
  });

  // Flush buffered output sequentially into the log file — clean sections, no interleaving
  if (logger) {
    for (let i = 0; i < ROLES.length; i++) {
      const role = ROLES[i];
      const result = results[i];
      const buffer = buffers[i];
      logger.parallelSectionStart(`REVIEWER: ${ROLE_LABELS[role]}`, `review-${role}-${task.id}`);
      if (buffer) {
        logger.writeBuffered(buffer.flush());
      }
      const issueDetail = result.issues.length > 0 ? `issues=${result.issues.length}` : '';
      logger.parallelSectionEnd(ROLE_LABELS[role], result.passed ? 'passed' : 'failed', issueDetail);
    }
  }

  const passed = results.every(r => r.passed);

  return {
    passed,
    results,
    feedback: passed
      ? 'All reviewers passed.'
      : results.filter(r => !r.passed).map(r => `${ROLE_LABELS[r.role]}: ${r.feedback}`).join('; '),
  };
}
