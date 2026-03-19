import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig, FailureType } from '../types/index.js';
import type { CheckResult } from './stages/checks.js';
import { runChecks } from './stages/checks.js';
import { executeClaudeCode } from './executor.js';
import { selectModel } from './model-selector.js';
import { getToolsForStage, getPermissionModeForStage } from './stage-tools.js';
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
  attempts: number;
  failureType: FailureType;
}

/**
 * Classify the type of failure from check results.
 * Used to determine retry strategy.
 */
export function classifyFailure(failedChecks: CheckResult[]): FailureType {
  for (const check of failedChecks) {
    if (!check.passed) {
      if (check.name === 'secret-detection') return 'security_violation';

      const output = check.output.toLowerCase();

      // Type errors
      if (check.name === 'typecheck' || output.includes('ts(') || output.includes('type error')) {
        return 'type_error';
      }

      // Lint errors
      if (check.name === 'lint' || output.includes('eslint') || output.includes('lint')) {
        return 'lint_error';
      }

      // Test failures
      if (check.name === 'test' || output.includes('test failed') || output.includes('expect(')) {
        return 'test_failure';
      }
    }
  }

  return 'unknown';
}

/**
 * Graduated fix for check failures.
 *
 * Spawns a fresh Claude session with the failure context.
 * Supports multiple attempts with increasing context:
 * - Attempt 1: Fix with just the error output
 * - Attempt 2: Fix with error output + relevant source file context
 *
 * Security violations are never retried.
 */
export async function runInlineFix(options: InlineFixOptions): Promise<InlineFixResult> {
  const { db, task, worktreePath, config, failedChecks, onOutput } = options;

  const failureType = classifyFailure(failedChecks);
  const maxAttempts = getMaxAttempts(failureType, config);

  console.log(`[inline-fix] Attempting fix for task ${task.id} (${failedChecks.length} failed check(s), type: ${failureType})`);

  // Security violations should never be auto-fixed
  if (failureType === 'security_violation') {
    console.log(`[inline-fix] Security violation detected — blocking immediately`);
    return {
      fixed: false,
      output: 'Security violation detected — manual review required',
      attempts: 0,
      failureType,
    };
  }

  const promptTemplate = await loadPromptTemplate();
  const model = selectModel('implementing', task.riskLevel, config);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onOutput?.(`[inline-fix] Attempt ${attempt}/${maxAttempts} — spawning Claude to fix ${failedChecks.length} failed check(s)\n`);

    // Build prompt with graduated context
    const failureSummary = formatFailedChecks(failedChecks);
    let prompt = promptTemplate
      .replace('{taskTitle}', task.title)
      .replace('{taskDescription}', task.description)
      .replace('{failureSummary}', failureSummary);

    // Attempt 2+: Add retry context with more guidance
    if (attempt > 1) {
      prompt += `\n\n## Retry Context (Attempt ${attempt})\n`;
      prompt += `The previous fix attempt did not resolve all issues. `;
      prompt += `Failure type: ${failureType}. `;
      prompt += `Focus specifically on the remaining errors and ensure your fix is complete. `;
      prompt += `Read the relevant source files for additional context before making changes.`;
    }

    const result = await executeClaudeCode({
      prompt,
      worktreePath,
      model,
      tools: getToolsForStage('inline_fix'),
      permissionMode: getPermissionModeForStage('inline_fix'),
      onOutput,
    });

    onOutput?.(`[inline-fix] Claude exited with code ${result.exitCode}\n`);

    if (result.exitCode !== 0) {
      console.log(`[inline-fix] Claude session failed (exit code ${result.exitCode}), attempt ${attempt}/${maxAttempts}`);
      if (attempt >= maxAttempts) {
        return { fixed: false, output: result.output, attempts: attempt, failureType };
      }
      continue;
    }

    // Re-run checks
    onOutput?.(`[inline-fix] Re-running checks after fix attempt ${attempt}\n`);
    const checksResult = await runChecks(db, task, worktreePath, config, onOutput);

    if (checksResult.passed) {
      // Checks pass — commit the fix
      onOutput?.('[inline-fix] Checks passed — committing fix\n');
      await commitChanges(worktreePath, `fix: address check failures for ${task.title}`);
      console.log(`[inline-fix] Fix committed for task ${task.id} on attempt ${attempt}`);
      return { fixed: true, output: result.output, attempts: attempt, failureType };
    }

    const stillFailing = checksResult.results
      .filter((r) => !r.passed)
      .map((r) => r.name)
      .join(', ');
    console.log(`[inline-fix] Checks still failing after attempt ${attempt}: ${stillFailing}`);

    if (attempt >= maxAttempts) {
      return {
        fixed: false,
        output: `Fix attempt ${attempt} failed. Still failing: ${stillFailing}\n${result.output}`,
        attempts: attempt,
        failureType,
      };
    }
  }

  // Should not reach here, but satisfy TypeScript
  return { fixed: false, output: 'No fix attempted', attempts: 0, failureType };
}

/**
 * Determine max retry attempts based on failure type.
 */
function getMaxAttempts(failureType: FailureType, config: AgentboardConfig): number {
  const configMax = config.maxInlineFixAttempts ?? 2;

  switch (failureType) {
    case 'security_violation':
      return 0;  // Never retry
    case 'type_error':
    case 'lint_error':
      return configMax;  // High fix probability
    case 'test_failure':
      return Math.min(configMax, 1);  // Medium probability, cap at 1
    case 'timeout':
      return 0;  // Retrying a timeout with a fix attempt doesn't help
    default:
      return Math.min(configMax, 1);
  }
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
