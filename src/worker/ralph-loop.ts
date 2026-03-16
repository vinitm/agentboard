import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig } from '../types/index.js';
import type { ImplementationResult } from './stages/implementer.js';
import { runImplementation } from './stages/implementer.js';
import { runChecks } from './stages/checks.js';
import { commitChanges } from './git.js';

export interface RalphLoopOptions {
  db: Database.Database;
  task: Task;
  worktreePath: string;
  config: AgentboardConfig;
  maxIterations: number;
  onOutput?: (chunk: string) => void;
  onIterationComplete?: (iteration: number, passed: boolean) => void;
}

export interface RalphLoopResult {
  passed: boolean;
  iterations: number;
  lastOutput: string;
}

/**
 * Append a progress entry to the worktree's progress.md file.
 * This file persists across fresh agent sessions, giving each
 * iteration context about what happened before.
 */
function appendProgress(worktreePath: string, entry: string): void {
  const progressPath = path.join(worktreePath, '.agentboard-progress.md');
  const timestamp = new Date().toISOString();
  const content = `\n## ${timestamp}\n${entry}\n`;
  fs.appendFileSync(progressPath, content, 'utf-8');
}

/**
 * Run the ralph loop: iterate implementation + checks until checks pass
 * or maxIterations is reached.
 *
 * Each iteration is a fresh Claude Code session. Progress persists via:
 * - Git commits (code changes from prior iterations)
 * - .agentboard-progress.md (append-only log of what happened)
 *
 * On the 3rd+ failure, switches to an alternative prompt strategy
 * (semantic fallback) that includes explicit instructions to try
 * a different approach.
 */
export async function runRalphLoop(options: RalphLoopOptions): Promise<RalphLoopResult> {
  const { db, task, worktreePath, config, maxIterations, onOutput, onIterationComplete } = options;

  let lastOutput = '';

  // Initialize progress file
  appendProgress(worktreePath, `Task: ${task.title}\nStarting ralph loop with max ${maxIterations} iterations.`);

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // Determine if we should use fallback prompt strategy
    const useFallback = iteration >= 3;

    // Run implementation
    const implResult: ImplementationResult = await runImplementation(
      db,
      task,
      worktreePath,
      config,
      iteration,
      onOutput,
      useFallback
    );

    if (!implResult.success) {
      appendProgress(worktreePath, `Iteration ${iteration}: Implementation FAILED\n${implResult.output.slice(0, 500)}`);
      lastOutput = implResult.output;
      onIterationComplete?.(iteration, false);

      if (iteration >= maxIterations) break;
      continue;
    }

    // Run checks
    const checksResult = await runChecks(db, task, worktreePath, config, onOutput);

    if (checksResult.passed) {
      appendProgress(worktreePath, `Iteration ${iteration}: All checks PASSED`);

      // Commit the successful implementation
      const titleLower = task.title.toLowerCase();
      const isDocChange = /\b(doc|readme|changelog|\.md|documentation)\b/i.test(titleLower);
      const isFix = /\b(fix|bug|patch|repair|resolve)\b/i.test(titleLower);
      const commitPrefix = isDocChange ? 'docs' : isFix ? 'fix' : 'feat';
      await commitChanges(worktreePath, `${commitPrefix}: ${task.title}`);

      onIterationComplete?.(iteration, true);
      return { passed: true, iterations: iteration, lastOutput: implResult.output };
    }

    // Checks failed — record and continue
    const failedChecks = checksResult.results.filter(r => !r.passed);
    const failSummary = failedChecks.map(r => `- ${r.name}: ${r.output.slice(0, 200)}`).join('\n');
    appendProgress(worktreePath, `Iteration ${iteration}: Checks FAILED\n${failSummary}`);
    lastOutput = failSummary;
    onIterationComplete?.(iteration, false);

    // Commit partial progress so next iteration sees it in git
    await commitChanges(worktreePath, `wip: iteration ${iteration} (checks failed)`);

    if (iteration >= maxIterations) break;
  }

  return { passed: false, iterations: maxIterations, lastOutput };
}
