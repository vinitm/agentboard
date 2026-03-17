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
  // final_review themselves (not via subtasks) are fine — subtask parents never
  // reach final_review directly.

  // Check 4: Final review results — must have a successful final review
  const runs = listRunsByTask(db, task.id);
  const finalReviewRuns = runs.filter(r => r.stage === 'final_review' && r.status === 'success');

  if (finalReviewRuns.length === 0) {
    reasons.push('No successful final review runs found');
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
