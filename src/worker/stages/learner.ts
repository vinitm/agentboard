import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Task } from '../../types/index.js';
import { listRunsByTask, listArtifactsByRun } from '../../db/queries.js';

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

    if (run.stage === 'review_panel') {
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
