import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task } from '../../types/index.js';
import { listRunsByTask, listArtifactsByRun } from '../../db/queries.js';
import { executeClaudeCode } from '../executor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TaskMetrics {
  taskId: string;
  title: string;
  riskLevel: string;
  outcome: 'success' | 'failed';
  totalTokensUsed: number;
  totalDuration: number;
  implementationAttempts: number;
  reviewCycles: number;
  checksPassedFirst: boolean;
  failedCheckNames: string[];
  reviewerFeedbackThemes: string[];
  timestamp: string;
}

/**
 * Collect metrics from a completed task's run history.
 */
export function collectTaskMetrics(
  db: Database.Database,
  task: Task,
  outcome: 'success' | 'failed'
): TaskMetrics {
  const runs = listRunsByTask(db, task.id);

  let totalTokensUsed = 0;
  let totalDuration = 0;
  let implementationAttempts = 0;
  let reviewCycles = 0;
  let checksPassedFirst = true;
  const failedCheckNames: string[] = [];
  const reviewerFeedbackThemes: string[] = [];

  for (const run of runs) {
    totalTokensUsed += run.tokensUsed ?? 0;

    if (run.startedAt && run.finishedAt) {
      totalDuration += new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    }

    if (run.stage === 'implementing') {
      implementationAttempts++;
    }

    if (run.stage === 'final_review') {
      reviewCycles++;
      // Extract feedback themes from review artifacts
      if (run.status === 'failed') {
        const artifacts = listArtifactsByRun(db, run.id);
        for (const artifact of artifacts) {
          if (artifact.type === 'review_result') {
            try {
              const result = JSON.parse(artifact.content) as { issues?: string[] };
              if (result.issues) {
                reviewerFeedbackThemes.push(...result.issues.slice(0, 3));
              }
            } catch {
              // Skip unparseable artifacts
            }
          }
        }
      }
    }

    if (run.stage === 'checks' && run.status === 'failed') {
      checksPassedFirst = false;
      // Try to extract which checks failed
      if (run.output) {
        try {
          const checkResults = JSON.parse(run.output) as Array<{ name: string; passed: boolean }>;
          for (const cr of checkResults) {
            if (!cr.passed && !failedCheckNames.includes(cr.name)) {
              failedCheckNames.push(cr.name);
            }
          }
        } catch {
          // Output wasn't structured; skip
        }
      }
    }
  }

  return {
    taskId: task.id,
    title: task.title,
    riskLevel: task.riskLevel,
    outcome,
    totalTokensUsed,
    totalDuration,
    implementationAttempts,
    reviewCycles,
    checksPassedFirst,
    failedCheckNames,
    reviewerFeedbackThemes: reviewerFeedbackThemes.slice(0, 10),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Record task metrics to the learning log.
 * Appends to .agentboard/learning-log.jsonl as a JSON-lines file.
 */
export function recordLearning(configDir: string, metrics: TaskMetrics): void {
  const logPath = path.join(configDir, 'learning-log.jsonl');
  const line = JSON.stringify(metrics) + '\n';
  fs.appendFileSync(logPath, line, 'utf-8');
}

/**
 * Load learning history for analysis.
 * Returns the last N entries from the learning log.
 */
export function loadLearningHistory(configDir: string, limit: number = 50): TaskMetrics[] {
  const logPath = path.join(configDir, 'learning-log.jsonl');
  try {
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(line => JSON.parse(line) as TaskMetrics);
  } catch {
    return [];
  }
}

/**
 * Analyze learning history to produce recommendations.
 * Returns a summary of patterns observed across completed tasks.
 */
export function analyzeLearningHistory(configDir: string): {
  averageTokensPerTask: number;
  averageAttempts: number;
  averageReviewCycles: number;
  firstPassCheckRate: number;
  commonFailedChecks: string[];
  commonReviewIssues: string[];
  totalTasks: number;
} {
  const history = loadLearningHistory(configDir);
  if (history.length === 0) {
    return {
      averageTokensPerTask: 0,
      averageAttempts: 0,
      averageReviewCycles: 0,
      firstPassCheckRate: 0,
      commonFailedChecks: [],
      commonReviewIssues: [],
      totalTasks: 0,
    };
  }

  const totalTasks = history.length;
  const avgTokens = history.reduce((sum, m) => sum + m.totalTokensUsed, 0) / totalTasks;
  const avgAttempts = history.reduce((sum, m) => sum + m.implementationAttempts, 0) / totalTasks;
  const avgReviews = history.reduce((sum, m) => sum + m.reviewCycles, 0) / totalTasks;
  const firstPassRate = history.filter(m => m.checksPassedFirst).length / totalTasks;

  // Count frequency of failed checks
  const checkCounts = new Map<string, number>();
  for (const m of history) {
    for (const name of m.failedCheckNames) {
      checkCounts.set(name, (checkCounts.get(name) ?? 0) + 1);
    }
  }
  const commonFailedChecks = [...checkCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  // Count frequency of review issues
  const issueCounts = new Map<string, number>();
  for (const m of history) {
    for (const issue of m.reviewerFeedbackThemes) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    }
  }
  const commonReviewIssues = [...issueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([issue]) => issue);

  return {
    averageTokensPerTask: Math.round(avgTokens),
    averageAttempts: Math.round(avgAttempts * 10) / 10,
    averageReviewCycles: Math.round(avgReviews * 10) / 10,
    firstPassCheckRate: Math.round(firstPassRate * 100),
    commonFailedChecks,
    commonReviewIssues,
    totalTasks,
  };
}

// ── Learning extraction ─────────────────────────────────────────────

export interface LearningResult {
  saved: boolean;
  skillFile?: string;
  pattern?: string;
  reason?: string;
}

function loadLearnerTemplate(): string {
  const templatePath = path.resolve(__dirname, '../../../../prompts/learner.md');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Learner prompt template not found at ${templatePath}`);
  }
  return fs.readFileSync(templatePath, 'utf-8');
}

export function buildTaskSummary(metrics: TaskMetrics): string {
  const lines: string[] = [];

  lines.push(`**Task:** ${metrics.title}`);
  lines.push(`**Outcome:** ${metrics.outcome}`);
  lines.push(`**Risk Level:** ${metrics.riskLevel}`);
  lines.push(`**Implementation Attempts:** ${metrics.implementationAttempts}`);
  lines.push(`**Review Cycles:** ${metrics.reviewCycles}`);
  lines.push(`**Checks Passed First Try:** ${metrics.checksPassedFirst ? 'yes' : 'no'}`);
  lines.push(`**Duration:** ${Math.round(metrics.totalDuration / 1000)}s`);
  lines.push(`**Tokens Used:** ${metrics.totalTokensUsed}`);

  if (metrics.failedCheckNames.length > 0) {
    lines.push(`\n**Failed Checks:**`);
    for (const name of metrics.failedCheckNames) {
      lines.push(`- ${name}`);
    }
  }

  if (metrics.reviewerFeedbackThemes.length > 0) {
    lines.push(`\n**Reviewer Feedback Themes:**`);
    for (const theme of metrics.reviewerFeedbackThemes) {
      lines.push(`- ${theme}`);
    }
  }

  return lines.join('\n');
}

/**
 * Run AI-powered learning extraction after task completion.
 * Spawns `claude --print` with a learner prompt that analyzes the task
 * execution and saves reusable patterns to `.claude/skills/learned/`.
 *
 * Non-blocking: failures are logged but never change task outcomes.
 */
export async function extractLearnings(
  metrics: TaskMetrics,
  worktreePath: string,
  model: string,
  onOutput?: (chunk: string) => void
): Promise<LearningResult> {
  try {
    const template = loadLearnerTemplate();
    const summary = buildTaskSummary(metrics);
    const prompt = template.replace('{taskSummary}', summary);

    const result = await executeClaudeCode({
      prompt,
      worktreePath,
      model,
      timeout: 120_000,
      onOutput,
    });

    if (result.exitCode !== 0) {
      console.log(`[learner] Learning extraction exited with code ${result.exitCode}`);
      return { saved: false, reason: `exit_code_${result.exitCode}` };
    }

    return parseLearningResult(result.output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[learner] Learning extraction failed: ${message}`);
    return { saved: false, reason: message };
  }
}

function parseLearningResult(output: string): LearningResult {
  // Try to find JSON on the last non-empty line
  const lines = output.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
    const line = lines[i].trim();
    const jsonMatch = line.match(/(\{[^}]*"saved"\s*:[^}]*\})/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as LearningResult;
      } catch {
        // Continue searching
      }
    }
  }

  // Try fenced code block fallback
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim()) as LearningResult;
      if (typeof parsed.saved === 'boolean') return parsed;
    } catch {
      // Fall through
    }
  }

  return { saved: false, reason: 'parse_error' };
}
