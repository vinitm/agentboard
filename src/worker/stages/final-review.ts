import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig, FinalReviewResult } from '../../types/index.js';
import { executeClaudeCode } from '../executor.js';
import { createRun, updateRun } from '../../db/queries.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Parse the spec JSON to extract acceptance criteria as a list of strings.
 * The spec field stores a JSON object with a `successCriteria` field.
 */
function extractAcceptanceCriteria(task: Task): string[] {
  if (!task.spec) return [];

  try {
    const spec = JSON.parse(task.spec) as Record<string, unknown>;
    const criteria = spec.successCriteria;
    if (typeof criteria === 'string') {
      // Split on newlines, filter empty lines
      return criteria
        .split('\n')
        .map((line: string) => line.replace(/^[-*]\s*/, '').trim())
        .filter((line: string) => line.length > 0);
    }
    if (Array.isArray(criteria)) {
      return (criteria as unknown[]).filter((c): c is string => typeof c === 'string');
    }
  } catch {
    // Spec is not valid JSON — treat description as the spec
  }

  return [];
}

/**
 * Load the final-review prompt template from disk.
 */
function loadPromptTemplate(): string {
  const promptPath = path.resolve(__dirname, '../../../prompts/final-review.md');
  try {
    return fs.readFileSync(promptPath, 'utf-8');
  } catch {
    throw new Error(`Final review prompt template not found at ${promptPath}`);
  }
}

/**
 * Get the full diff from the base branch to HEAD.
 */
async function getFullDiff(worktreePath: string, baseBranch: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', `${baseBranch}...HEAD`],
      { cwd: worktreePath, maxBuffer: 10 * 1024 * 1024 }
    );
    return stdout;
  } catch {
    // Fallback: diff against HEAD~1 if base branch doesn't exist in worktree
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', 'HEAD~1'],
        { cwd: worktreePath, maxBuffer: 10 * 1024 * 1024 }
      );
      return stdout;
    } catch {
      return '(Could not generate diff)';
    }
  }
}

/**
 * Parse the final review JSON output from Claude.
 * Handles code-fenced JSON, raw JSON, and unparseable output.
 */
export function parseFinalReviewOutput(output: string): FinalReviewResult {
  // Try code-fenced JSON first
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      return validateFinalReviewResult(JSON.parse(fenceMatch[1]));
    } catch {
      // Fall through
    }
  }

  // Try raw JSON with "passed" key
  const jsonMatch = output.match(/\{[\s\S]*"passed"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return validateFinalReviewResult(JSON.parse(jsonMatch[0]));
    } catch {
      // Fall through
    }
  }

  // Unparseable — return a failed result
  return {
    passed: false,
    specCompliance: {
      criterionMet: {},
      missingRequirements: [],
    },
    integrationIssues: ['Could not parse final review output'],
    summary: output.slice(0, 2000),
  };
}

/**
 * Validate and normalize the parsed JSON into a well-typed FinalReviewResult.
 */
function validateFinalReviewResult(data: unknown): FinalReviewResult {
  const obj = data as Record<string, unknown>;

  // Parse specCompliance
  const rawCompliance = (typeof obj.specCompliance === 'object' && obj.specCompliance !== null)
    ? obj.specCompliance as Record<string, unknown>
    : {};

  // Filter criterionMet to only boolean values
  const rawCriterionMet = (typeof rawCompliance.criterionMet === 'object' && rawCompliance.criterionMet !== null)
    ? rawCompliance.criterionMet as Record<string, unknown>
    : {};

  const criterionMet: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(rawCriterionMet)) {
    if (typeof value === 'boolean') {
      criterionMet[key] = value;
    }
  }

  // Filter arrays to string-only
  const missingRequirements = Array.isArray(rawCompliance.missingRequirements)
    ? (rawCompliance.missingRequirements as unknown[]).filter((i): i is string => typeof i === 'string')
    : [];

  const integrationIssues = Array.isArray(obj.integrationIssues)
    ? (obj.integrationIssues as unknown[]).filter((i): i is string => typeof i === 'string')
    : [];

  return {
    passed: typeof obj.passed === 'boolean' ? obj.passed : false,
    specCompliance: {
      criterionMet,
      missingRequirements,
    },
    integrationIssues,
    summary: typeof obj.summary === 'string' ? obj.summary : '',
  };
}

/**
 * Run a holistic final review of ALL changes across all subtasks.
 *
 * Checks:
 * - Cross-file consistency
 * - Integration issues between subtasks
 * - Spec compliance against ALL acceptance criteria
 * - Architecture alignment
 */
export async function runFinalReview(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig,
  onOutput?: (chunk: string) => void
): Promise<FinalReviewResult> {
  const model = config.modelDefaults.review;

  console.log(`[final-review] Starting final review for task ${task.id}`);

  // 1. Get the full diff from base branch
  const diff = await getFullDiff(worktreePath, config.baseBranch);
  console.log(`[final-review] Diff size: ${diff.length} chars`);

  // 2. Extract acceptance criteria from the task spec
  const criteria = extractAcceptanceCriteria(task);
  const acceptanceCriteriaText = criteria.length > 0
    ? criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '(No explicit acceptance criteria found in spec)';

  // 3. Build the spec text
  const specText = task.spec ?? task.description;

  // 4. Build prompt from template
  const template = loadPromptTemplate();
  const prompt = template
    .replace('{diff}', () => diff)
    .replace('{spec}', () => specText)
    .replace('{acceptanceCriteria}', () => acceptanceCriteriaText);

  // 5. Create run record
  const run = createRun(db, {
    taskId: task.id,
    stage: 'final_review',
    modelUsed: model,
    input: prompt.slice(0, 10000), // Truncate for storage
  });

  try {
    // 6. Call Claude
    const result = await executeClaudeCode({
      prompt,
      worktreePath,
      model,
      onOutput,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Claude Code exited with code ${result.exitCode}: ${result.output}`);
    }

    // 7. Parse the response
    const reviewResult = parseFinalReviewOutput(result.output);

    console.log(`[final-review] Review complete: passed=${reviewResult.passed}, issues=${reviewResult.integrationIssues.length}`);

    // 8. Update run record
    updateRun(db, run.id, {
      status: reviewResult.passed ? 'success' : 'failed',
      output: JSON.stringify(reviewResult),
      tokensUsed: result.tokensUsed,
      finishedAt: new Date().toISOString(),
    });

    return reviewResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`[final-review] Error: ${errorMessage}`);

    updateRun(db, run.id, {
      status: 'failed',
      output: errorMessage,
      finishedAt: new Date().toISOString(),
    });

    return {
      passed: false,
      specCompliance: {
        criterionMet: {},
        missingRequirements: ['Review execution failed'],
      },
      integrationIssues: [errorMessage],
      summary: `Final review failed: ${errorMessage}`,
    };
  }
}
