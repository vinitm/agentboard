import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig } from '../types/index.js';
import type { CheckResult } from './stages/checks.js';
import { runChecks } from './stages/checks.js';
import { executeClaudeCode } from './executor.js';
import { commitChanges } from './git.js';

export interface InlineFixOptions {
  db: Database.Database;
  task: Task;
  worktreePath: string;
  config: AgentboardConfig;
  failedChecks: CheckResult[];
  onOutput?: (chunk: string) => void;
}

export interface InlineFixResult {
  fixed: boolean;
  output: string;
}

/**
 * Single-shot fix for check failures.
 *
 * Spawns a fresh Claude session with the failure context,
 * re-runs checks, and commits if they pass.
 * One attempt only — no retry loop.
 */
export async function runInlineFix(options: InlineFixOptions): Promise<InlineFixResult> {
  const { db, task, worktreePath, config, failedChecks, onOutput } = options;

  console.log(`[inline-fix] Attempting fix for task ${task.id} (${failedChecks.length} failed check(s))`);

  // 1. Format failed checks into context
  const failureSummary = formatFailedChecks(failedChecks);

  // 2. Load prompt template
  const promptTemplate = await loadPromptTemplate();

  // 3. Build the full prompt with failure context
  const prompt = promptTemplate
    .replace('{taskTitle}', task.title)
    .replace('{taskDescription}', task.description)
    .replace('{failureSummary}', failureSummary);

  onOutput?.(`[inline-fix] Spawning Claude to fix ${failedChecks.length} failed check(s)\n`);

  // 4. Spawn fresh Claude session
  const model = config.modelDefaults.implementation;
  const result = await executeClaudeCode({
    prompt,
    worktreePath,
    model,
    onOutput,
  });

  onOutput?.(`[inline-fix] Claude exited with code ${result.exitCode}\n`);

  if (result.exitCode !== 0) {
    console.log(`[inline-fix] Claude session failed (exit code ${result.exitCode})`);
    return { fixed: false, output: result.output };
  }

  // 5. Re-run checks
  onOutput?.('[inline-fix] Re-running checks after fix attempt\n');
  const checksResult = await runChecks(db, task, worktreePath, config, onOutput);

  if (!checksResult.passed) {
    const stillFailing = checksResult.results
      .filter((r) => !r.passed)
      .map((r) => r.name)
      .join(', ');
    console.log(`[inline-fix] Checks still failing after fix: ${stillFailing}`);
    return {
      fixed: false,
      output: `Fix attempt failed. Still failing: ${stillFailing}\n${result.output}`,
    };
  }

  // 6. Checks pass — commit the fix
  onOutput?.('[inline-fix] Checks passed — committing fix\n');
  await commitChanges(worktreePath, `fix: address check failures for ${task.title}`);
  console.log(`[inline-fix] Fix committed for task ${task.id}`);

  return { fixed: true, output: result.output };
}

/**
 * Format failed check results into a readable summary for the prompt.
 */
function formatFailedChecks(checks: CheckResult[]): string {
  return checks
    .filter((c) => !c.passed)
    .map((c) => `### ${c.name} (command: \`${c.command}\`)\n\n\`\`\`\n${c.output}\n\`\`\``)
    .join('\n\n');
}

/**
 * Load the inline-fix prompt template from prompts/inline-fix.md.
 */
async function loadPromptTemplate(): Promise<string> {
  const thisFile = fileURLToPath(import.meta.url);
  const promptPath = path.resolve(path.dirname(thisFile), '../../prompts/inline-fix.md');
  return readFile(promptPath, 'utf-8');
}
