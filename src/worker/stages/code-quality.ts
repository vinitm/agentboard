import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig, CodeQualityResult } from '../../types/index.js';
import { executeClaudeCode } from '../executor.js';
import { createRun, updateRun, createArtifact } from '../../db/queries.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_SEVERITIES = new Set(['critical', 'important', 'minor']);
const VALID_CATEGORIES = new Set(['quality', 'testing', 'security', 'architecture']);

type IssueSeverity = 'critical' | 'important' | 'minor';
type IssueCategory = 'quality' | 'testing' | 'security' | 'architecture';

interface RawIssue {
  severity: string;
  category: string;
  message: string;
  file?: string;
  line?: number;
}

function isValidIssue(item: unknown): item is RawIssue {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.severity === 'string' &&
    VALID_SEVERITIES.has(obj.severity) &&
    typeof obj.category === 'string' &&
    VALID_CATEGORIES.has(obj.category) &&
    typeof obj.message === 'string'
  );
}

function loadPromptTemplate(): string {
  const promptPath = path.resolve(__dirname, '../../../prompts', 'code-quality.md');
  try {
    return fs.readFileSync(promptPath, 'utf-8');
  } catch {
    throw new Error(`Code quality prompt template not found at ${promptPath}`);
  }
}

/**
 * Parse Claude's output into a CodeQualityResult.
 * Attempts JSON in code fences first, then raw JSON, then falls back to failure.
 */
export function parseCodeQualityOutput(output: string): CodeQualityResult {
  // Try code-fenced JSON first
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      return validateCodeQualityResult(JSON.parse(fenceMatch[1]));
    } catch {
      // Fall through
    }
  }

  // Try raw JSON
  const jsonMatch = output.match(/\{[\s\S]*"passed"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return validateCodeQualityResult(JSON.parse(jsonMatch[0]));
    } catch {
      // Fall through
    }
  }

  // Unparseable — return failure
  return {
    passed: false,
    issues: [{
      severity: 'critical',
      category: 'quality',
      message: 'Could not parse structured code quality output',
    }],
    summary: output.slice(0, 2000),
  };
}

function validateCodeQualityResult(data: unknown): CodeQualityResult {
  const obj = data as Record<string, unknown>;
  const rawIssues = Array.isArray(obj.issues) ? (obj.issues as unknown[]) : [];
  const validIssues = rawIssues
    .filter(isValidIssue)
    .map((issue) => ({
      severity: issue.severity as IssueSeverity,
      category: issue.category as IssueCategory,
      message: issue.message,
      ...(typeof issue.file === 'string' ? { file: issue.file } : {}),
      ...(typeof issue.line === 'number' ? { line: issue.line } : {}),
    }));

  return {
    passed: typeof obj.passed === 'boolean' ? obj.passed : false,
    issues: validIssues,
    summary: typeof obj.summary === 'string' ? obj.summary : '',
  };
}

async function getGitDiff(worktreePath: string): Promise<{ stat: string; diff: string }> {
  try {
    const [statResult, diffResult] = await Promise.all([
      execFileAsync('git', ['diff', 'HEAD~1', '--stat'], { cwd: worktreePath, maxBuffer: 1024 * 1024 }),
      execFileAsync('git', ['diff', 'HEAD~1'], { cwd: worktreePath, maxBuffer: 5 * 1024 * 1024 }),
    ]);
    return {
      stat: statResult.stdout,
      diff: diffResult.stdout,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[code-quality] Failed to get git diff: ${message}`);
    return { stat: '', diff: '' };
  }
}

/**
 * Run a single combined code quality review covering architecture, QA, and security.
 *
 * Replaces the 3-reviewer panel with one focused review pass.
 * Pass criteria: no critical or important issues (minor issues are acceptable).
 */
export async function runCodeQuality(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig,
  onOutput?: (chunk: string) => void
): Promise<CodeQualityResult> {
  console.log(`[code-quality] Starting review for task ${task.id}`);

  // Get the diff to review
  const { stat, diff } = await getGitDiff(worktreePath);

  if (!diff) {
    console.log(`[code-quality] No diff found for task ${task.id}, passing`);
    return {
      passed: true,
      issues: [],
      summary: 'No changes to review.',
    };
  }

  // Build prompt from template
  const template = loadPromptTemplate();
  const prompt = template
    .replace('{diffStat}', () => stat)
    .replace('{diff}', () => diff)
    .replace('{taskTitle}', () => task.title)
    .replace('{taskDescription}', () => task.description);

  // Select model — use review key from config
  const model = config.modelDefaults.review;

  const run = createRun(db, {
    taskId: task.id,
    stage: 'code_quality',
    modelUsed: model,
    input: prompt.slice(0, 10_000), // Truncate for storage
  });

  try {
    const result = await executeClaudeCode({
      prompt,
      worktreePath,
      model,
      onOutput,
    });

    if (result.exitCode !== 0) {
      const failResult: CodeQualityResult = {
        passed: false,
        issues: [{
          severity: 'critical',
          category: 'quality',
          message: `Claude Code exited with code ${result.exitCode}: ${result.output.slice(0, 500)}`,
        }],
        summary: 'Code quality review execution failed.',
      };

      updateRun(db, run.id, {
        status: 'failed',
        output: JSON.stringify(failResult),
        tokensUsed: result.tokensUsed,
        finishedAt: new Date().toISOString(),
      });

      return failResult;
    }

    const qualityResult = parseCodeQualityOutput(result.output);

    // Enforce pass criteria: no critical or important issues
    const hasCriticalOrImportant = qualityResult.issues.some(
      (i) => i.severity === 'critical' || i.severity === 'important'
    );
    const normalizedResult: CodeQualityResult = {
      ...qualityResult,
      passed: !hasCriticalOrImportant,
    };

    updateRun(db, run.id, {
      status: normalizedResult.passed ? 'success' : 'failed',
      output: JSON.stringify(normalizedResult),
      tokensUsed: result.tokensUsed,
      finishedAt: new Date().toISOString(),
    });

    createArtifact(db, {
      runId: run.id,
      type: 'code_quality_result',
      name: 'code-quality',
      content: JSON.stringify(normalizedResult),
    });

    console.log(
      `[code-quality] Task ${task.id}: ${normalizedResult.passed ? 'PASSED' : 'FAILED'} ` +
      `(${normalizedResult.issues.length} issues: ` +
      `${normalizedResult.issues.filter((i) => i.severity === 'critical').length} critical, ` +
      `${normalizedResult.issues.filter((i) => i.severity === 'important').length} important, ` +
      `${normalizedResult.issues.filter((i) => i.severity === 'minor').length} minor)`
    );

    return normalizedResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`[code-quality] Error reviewing task ${task.id}: ${errorMessage}`);

    const failResult: CodeQualityResult = {
      passed: false,
      issues: [{
        severity: 'critical',
        category: 'quality',
        message: `Code quality review crashed: ${errorMessage}`,
      }],
      summary: 'Code quality review execution error.',
    };

    updateRun(db, run.id, {
      status: 'failed',
      output: errorMessage,
      finishedAt: new Date().toISOString(),
    });

    return failResult;
  }
}
