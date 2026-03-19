import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig, SpecReviewResult, SpecDocument } from '../../types/index.js';
import { selectModel } from '../model-selector.js';
import { executeClaudeCode } from '../executor.js';
import { getToolsForStage } from '../stage-tools.js';
import { createRun, updateRun } from '../../db/queries.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load the spec-review prompt template from prompts/spec-review.md
 */
function loadPromptTemplate(): string {
  const promptPath = path.resolve(__dirname, '../../../../prompts/spec-review.md');
  try {
    return fs.readFileSync(promptPath, 'utf-8');
  } catch {
    throw new Error(
      `Spec review prompt template not found at ${promptPath}. Ensure the prompts/ directory exists in the agentboard root.`
    );
  }
}

/**
 * Parse the spec JSON from a task. Returns null if missing or invalid.
 */
function parseSpec(task: Task): SpecDocument | null {
  if (!task.spec) return null;
  try {
    const parsed = JSON.parse(task.spec) as Record<string, unknown>;
    return {
      goal: typeof parsed.goal === 'string' ? parsed.goal : '',
      userScenarios: typeof parsed.userScenarios === 'string' ? parsed.userScenarios : '',
      successCriteria: typeof parsed.successCriteria === 'string' ? parsed.successCriteria : '',
    };
  } catch {
    return null;
  }
}

/**
 * Check completeness of spec fields programmatically (no AI needed).
 * Returns issues for any empty fields.
 */
function checkCompleteness(spec: SpecDocument): SpecReviewResult['issues'] {
  const issues: SpecReviewResult['issues'] = [];
  const fields: Array<{ key: keyof SpecDocument; label: string }> = [
    { key: 'goal', label: 'Goal' },
    { key: 'userScenarios', label: 'User scenarios' },
    { key: 'successCriteria', label: 'Success criteria' },
  ];

  for (const { key, label } of fields) {
    if (!spec[key] || spec[key].trim().length === 0) {
      issues.push({
        field: key,
        severity: 'critical',
        message: `${label} is empty. This field is required for planning.`,
      });
    }
  }

  return issues;
}

/**
 * Parse AI review JSON from Claude output.
 * Handles code fences and raw JSON.
 */
function parseAiReviewOutput(output: string): SpecReviewResult {
  // Try code fence first
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      return validateResult(JSON.parse(fenceMatch[1]));
    } catch {
      // Fall through
    }
  }

  // Try raw JSON
  const jsonMatch = output.match(/\{[\s\S]*"passed"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return validateResult(JSON.parse(jsonMatch[0]));
    } catch {
      // Fall through
    }
  }

  // Fallback: treat as failed with parse error
  console.log('[spec-review] Failed to parse AI review output, treating as warning');
  return {
    passed: false,
    issues: [{
      field: 'goal',
      severity: 'warning',
      message: 'Could not parse AI review response. Manual review recommended.',
    }],
    suggestions: [],
  };
}

/**
 * Validate and normalize the parsed AI review result.
 */
function validateResult(data: unknown): SpecReviewResult {
  const obj = data as Record<string, unknown>;
  const validFields = new Set(['goal', 'userScenarios', 'successCriteria']);
  const validSeverities = new Set(['critical', 'warning']);

  const issues = Array.isArray(obj.issues)
    ? (obj.issues as Array<Record<string, unknown>>)
        .filter((i) => validFields.has(String(i.field)) && validSeverities.has(String(i.severity)))
        .map((i) => ({
          field: String(i.field) as 'goal' | 'userScenarios' | 'successCriteria',
          severity: String(i.severity) as 'critical' | 'warning',
          message: typeof i.message === 'string' ? i.message : '',
        }))
    : [];

  const suggestions = Array.isArray(obj.suggestions)
    ? (obj.suggestions as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];

  const passed = typeof obj.passed === 'boolean' ? obj.passed : issues.length === 0;

  return { passed, issues, suggestions };
}

/**
 * Run the spec review stage for a task.
 *
 * 1. Completeness check (programmatic) — fails immediately if any field empty
 * 2. AI review (testability, scope, contradictions) — only runs if completeness passes
 */
export async function runSpecReview(
  db: Database.Database,
  task: Task,
  config?: AgentboardConfig,
  onOutput?: (chunk: string) => void
): Promise<SpecReviewResult> {
  console.log(`[spec-review] Starting spec review for task ${task.id}`);

  // Parse spec
  const spec = parseSpec(task);
  if (!spec) {
    console.log('[spec-review] Task has no spec or spec is invalid JSON');
    return {
      passed: false,
      issues: [{
        field: 'goal',
        severity: 'critical',
        message: 'Task spec is missing or could not be parsed.',
      }],
      suggestions: [],
    };
  }

  // Step 1: Completeness check (no AI)
  const completenessIssues = checkCompleteness(spec);
  if (completenessIssues.length > 0) {
    console.log(`[spec-review] Completeness check failed with ${completenessIssues.length} issue(s)`);
    return {
      passed: false,
      issues: completenessIssues,
      suggestions: [],
    };
  }

  console.log('[spec-review] Completeness check passed, running AI review');

  // Step 2: AI review for testability, scope, contradictions
  const model = config
    ? selectModel('planning', task.riskLevel, config)
    : 'sonnet';

  const template = loadPromptTemplate();
  const prompt = template
    .replace('{goal}', () => spec.goal)
    .replace('{userScenarios}', () => spec.userScenarios)
    .replace('{successCriteria}', () => spec.successCriteria);

  // Create a run record
  const run = createRun(db, {
    taskId: task.id,
    stage: 'spec_review',
    modelUsed: model,
    input: prompt,
  });

  try {
    const result = await executeClaudeCode({
      prompt,
      worktreePath: '.',
      model,
      tools: getToolsForStage('spec_review'),
      onOutput,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Claude Code exited with code ${result.exitCode}: ${result.output}`
      );
    }

    const reviewResult = parseAiReviewOutput(result.output);

    updateRun(db, run.id, {
      status: reviewResult.passed ? 'success' : 'failed',
      output: JSON.stringify(reviewResult),
      tokensUsed: result.tokensUsed,
      finishedAt: new Date().toISOString(),
    });

    console.log(`[spec-review] AI review ${reviewResult.passed ? 'passed' : 'failed'} with ${reviewResult.issues.length} issue(s)`);

    return reviewResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    updateRun(db, run.id, {
      status: 'failed',
      output: errorMessage,
      finishedAt: new Date().toISOString(),
    });

    console.log(`[spec-review] AI review error: ${errorMessage}`);
    throw error;
  }
}
