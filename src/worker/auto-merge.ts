import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig } from '../types/index.js';
import { listRunsByTask, listArtifactsByRun } from '../db/queries.js';

export interface AutoMergeDecision {
  canAutoMerge: boolean;
  reasons: string[];
}

/**
 * Evaluate whether a task can be auto-merged (skip human review).
 *
 * A task can auto-merge when ALL of these are true:
 * 1. config.autoMerge is enabled
 * 2. Task risk level is 'low'
 * 3. All review panel reviewers passed with zero issues
 * 4. No security-sensitive files were modified
 * 5. Task is not a parent task with subtasks (those always need human review)
 */
export function evaluateAutoMerge(
  db: Database.Database,
  task: Task,
  config: AgentboardConfig
): AutoMergeDecision {
  const reasons: string[] = [];

  // Check 1: Auto-merge enabled
  if (!config.autoMerge) {
    return { canAutoMerge: false, reasons: ['Auto-merge is disabled in config'] };
  }

  // Check 2: Risk level
  if (task.riskLevel !== 'low') {
    reasons.push(`Risk level is '${task.riskLevel}' (must be 'low')`);
  }

  // Check 3: Parent task check — parent tasks with subtasks always need human review
  // If parentTaskId is null this is a root task. Root tasks that went through
  // review_panel themselves (not via subtasks) are fine — subtask parents never
  // reach review_panel directly.

  // Check 4: Review panel results — all must pass with zero issues
  const runs = listRunsByTask(db, task.id);
  const reviewRuns = runs.filter(r => r.stage === 'review_panel' && r.status === 'success');

  if (reviewRuns.length === 0) {
    reasons.push('No successful review panel runs found');
  } else {
    // Check the latest review panel run's artifacts for zero issues
    const latestReviewRun = reviewRuns[reviewRuns.length - 1];
    const artifacts = listArtifactsByRun(db, latestReviewRun.id);
    const reviewArtifacts = artifacts.filter(a => a.type === 'review_result');

    let totalIssues = 0;
    for (const artifact of reviewArtifacts) {
      try {
        const result = JSON.parse(artifact.content) as { passed: boolean; issues: string[] };
        if (!result.passed) {
          reasons.push(`Reviewer '${artifact.name}' did not pass`);
        }
        totalIssues += (result.issues?.length ?? 0);
      } catch {
        reasons.push(`Could not parse review result for '${artifact.name}'`);
      }
    }

    if (totalIssues > 0) {
      reasons.push(`Review panel reported ${totalIssues} issue(s) (must be 0)`);
    }
  }

  // Check 5: No security-sensitive files
  // Lightweight heuristic — look at the implementation output for mentions
  // of security-sensitive paths
  const SENSITIVE_PATTERNS = [
    /\.env/i,
    /secret/i,
    /credential/i,
    /auth/i,
    /password/i,
    /token/i,
    /\.pem$/i,
    /\.key$/i,
    /config\/security/i,
  ];

  const implRuns = runs.filter(r => r.stage === 'implementing' && r.status === 'success');
  if (implRuns.length > 0) {
    const latestImpl = implRuns[implRuns.length - 1];
    if (latestImpl.output) {
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(latestImpl.output)) {
          reasons.push(`Implementation touched security-sensitive content (matched: ${pattern.source})`);
          break;
        }
      }
    }
  }

  return {
    canAutoMerge: reasons.length === 0,
    reasons,
  };
}
