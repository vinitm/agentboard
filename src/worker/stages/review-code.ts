import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig } from '../../types/index.js';
import { selectModel } from '../model-selector.js';
import { buildTaskPacket } from '../context-builder.js';
import { executeClaudeCode } from '../executor.js';
import { createRun, updateRun } from '../../db/queries.js';
import type { ReviewResult } from './review-spec.js';

export type { ReviewResult };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load the code review prompt template from prompts/review-code.md
 */
function loadCodeReviewTemplate(): string {
  const promptPath = path.resolve(__dirname, '../../../prompts/review-code.md');
  return fs.readFileSync(promptPath, 'utf-8');
}

/**
 * Run the code quality review for a task.
 *
 * - Builds prompt from template + task context
 * - Executes with Sonnet model (Opus if task.riskLevel === 'high')
 * - Parses structured output for pass/fail and issues list
 * - Creates run record with token tracking
 */
export async function runCodeReview(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig
): Promise<ReviewResult> {
  const model = selectModel('review_code', task.riskLevel, config);
  const taskPacket = buildTaskPacket(db, task);

  // Build the prompt
  const template = loadCodeReviewTemplate();
  const prompt = template.replace('{taskSpec}', () => taskPacket);

  // Create a run record
  const run = createRun(db, {
    taskId: task.id,
    stage: 'review_code',
    modelUsed: model,
    input: prompt,
  });

  try {
    const result = await executeClaudeCode({
      prompt,
      worktreePath,
      model,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Claude Code exited with code ${result.exitCode}: ${result.output}`
      );
    }

    const reviewResult = parseReviewOutput(result.output);

    updateRun(db, run.id, {
      status: reviewResult.passed ? 'success' : 'failed',
      output: JSON.stringify(reviewResult),
      tokensUsed: result.tokensUsed,
      finishedAt: new Date().toISOString(),
    });

    return reviewResult;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    updateRun(db, run.id, {
      status: 'failed',
      output: errorMessage,
      finishedAt: new Date().toISOString(),
    });

    return {
      passed: false,
      feedback: `Code review failed with error: ${errorMessage}`,
      issues: ['Review execution error'],
    };
  }
}

/**
 * Parse structured review JSON from Claude's output.
 * The JSON block may be wrapped in markdown code fences.
 */
function parseReviewOutput(output: string): ReviewResult {
  // Try to find JSON in code fences first
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      return validateReviewResult(JSON.parse(fenceMatch[1]));
    } catch {
      // Fall through to other methods
    }
  }

  // Try to find a raw JSON object with "passed" key
  const jsonMatch = output.match(/\{[\s\S]*"passed"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return validateReviewResult(JSON.parse(jsonMatch[0]));
    } catch {
      // Fall through
    }
  }

  // Last resort: treat the entire output as feedback, mark as failed
  return {
    passed: false,
    feedback: output.slice(0, 2000),
    issues: ['Could not parse structured review output'],
  };
}

/**
 * Validate and normalize the parsed review result.
 */
function validateReviewResult(data: unknown): ReviewResult {
  const obj = data as Record<string, unknown>;
  return {
    passed: typeof obj.passed === 'boolean' ? obj.passed : false,
    feedback: typeof obj.feedback === 'string' ? obj.feedback : '',
    issues: Array.isArray(obj.issues)
      ? (obj.issues as unknown[]).filter(
          (i): i is string => typeof i === 'string'
        )
      : [],
  };
}
