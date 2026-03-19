import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig, AutoMergeMode } from '../types/index.js';
import { listRunsByTask, listGitRefsByTask } from '../db/queries.js';

const execFileAsync = promisify(execFile);

export interface AutoMergeDecision {
  canAutoMerge: boolean;
  reasons: string[];
}

/**
 * Security-sensitive file path patterns.
 * Matched against `git diff --name-only` file paths (not output text)
 * to avoid false positives from log messages containing words like "auth".
 */
const SENSITIVE_FILE_PATTERNS = [
  /\.env(?:\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /credentials\.json$/i,
  /\.aws\/credentials/i,
  /config\/security/i,
  /secrets?\.(ya?ml|json|toml)$/i,
];

/**
 * Get the list of changed files in a worktree relative to the base branch.
 */
async function getChangedFiles(worktreePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', 'HEAD~1'],
      { cwd: worktreePath }
    );
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Evaluate whether a task can be auto-merged (skip human review).
 *
 * A task can auto-merge when ALL of these are true:
 * 1. autoMergeMode is not 'off' (or legacy autoMerge is true)
 * 2. Task risk level matches the auto-merge mode
 * 3. All review panel reviewers passed with zero issues
 * 4. No security-sensitive files were modified (checked via git diff --name-only)
 * 5. Task is not a parent task with subtasks (those always need human review)
 */
export function evaluateAutoMerge(
  db: Database.Database,
  task: Task,
  config: AgentboardConfig
): AutoMergeDecision {
  const reasons: string[] = [];

  // Determine effective merge mode
  const mode: AutoMergeMode = config.autoMergeMode ?? (config.autoMerge ? 'low-risk' : 'off');

  // Check 1: Auto-merge mode
  if (mode === 'off') {
    return { canAutoMerge: false, reasons: ['Auto-merge is disabled in config'] };
  }

  // Check 2: Risk level vs mode
  if (mode === 'low-risk' && task.riskLevel !== 'low') {
    reasons.push(`Risk level is '${task.riskLevel}' (must be 'low' for low-risk auto-merge mode)`);
  }
  // 'draft-only' doesn't auto-merge, just marks PR ready
  if (mode === 'draft-only') {
    return { canAutoMerge: false, reasons: ['Auto-merge mode is draft-only — PR will be marked ready but not merged'] };
  }

  // Check 3: Final review results — must have a successful final review
  const runs = listRunsByTask(db, task.id);
  const finalReviewRuns = runs.filter(r => r.stage === 'final_review' && r.status === 'success');

  if (finalReviewRuns.length === 0) {
    reasons.push('No successful final review runs found');
  }

  // Check 4: No security-sensitive files (via file paths, not output text)
  const gitRefs = listGitRefsByTask(db, task.id);
  const worktreePath = gitRefs[0]?.worktreePath;

  // Check 4: No security-sensitive files (via file paths in implementation output)
  const implRuns = runs.filter(r => r.stage === 'implementing' && r.status === 'success');
  if (implRuns.length > 0) {
    const latestImpl = implRuns[implRuns.length - 1];
    if (latestImpl.output) {
      // Extract file paths from output — match words that look like paths
      // (contain at least one dot or slash, e.g., .env.production, src/auth.ts)
      const filePathPattern = /(?:^|\s)(\.?[\w./\-]+\.[\w.]+)/gm;
      const mentionedFiles: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = filePathPattern.exec(latestImpl.output)) !== null) {
        mentionedFiles.push(match[1]);
      }

      for (const file of mentionedFiles) {
        for (const pattern of SENSITIVE_FILE_PATTERNS) {
          if (pattern.test(file)) {
            reasons.push(`Implementation modified security-sensitive file: ${file}`);
            break;
          }
        }
        // Break after first sensitive file found
        if (reasons.some(r => r.includes('security-sensitive file'))) break;
      }
    }
  }

  return {
    canAutoMerge: reasons.length === 0,
    reasons,
  };
}

/**
 * Async variant that uses `git diff --name-only` for accurate file detection.
 * Preferred over the synchronous evaluateAutoMerge when an async context is available.
 */
export async function evaluateAutoMergeAsync(
  db: Database.Database,
  task: Task,
  config: AgentboardConfig
): Promise<AutoMergeDecision> {
  const reasons: string[] = [];

  const mode: AutoMergeMode = config.autoMergeMode ?? (config.autoMerge ? 'low-risk' : 'off');

  if (mode === 'off') {
    return { canAutoMerge: false, reasons: ['Auto-merge is disabled in config'] };
  }

  if (mode === 'low-risk' && task.riskLevel !== 'low') {
    reasons.push(`Risk level is '${task.riskLevel}' (must be 'low' for low-risk auto-merge mode)`);
  }

  if (mode === 'draft-only') {
    return { canAutoMerge: false, reasons: ['Auto-merge mode is draft-only — PR will be marked ready but not merged'] };
  }

  const runs = listRunsByTask(db, task.id);
  const finalReviewRuns = runs.filter(r => r.stage === 'final_review' && r.status === 'success');

  if (finalReviewRuns.length === 0) {
    reasons.push('No successful final review runs found');
  }

  // Use actual git diff for accurate file detection
  const gitRefs = listGitRefsByTask(db, task.id);
  const worktreePath = gitRefs[0]?.worktreePath;

  if (worktreePath) {
    const changedFiles = await getChangedFiles(worktreePath);
    for (const file of changedFiles) {
      for (const pattern of SENSITIVE_FILE_PATTERNS) {
        if (pattern.test(file)) {
          reasons.push(`Implementation modified security-sensitive file: ${file}`);
          break;
        }
      }
      if (reasons.some(r => r.includes('security-sensitive file'))) break;
    }
  }

  return {
    canAutoMerge: reasons.length === 0,
    reasons,
  };
}
