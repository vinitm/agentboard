import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig } from '../../types/index.js';
import { selectModel } from '../model-selector.js';
import { buildTaskPacket } from '../context-builder.js';
import { executeClaudeCode } from '../executor.js';
import { getToolsForStage } from '../stage-tools.js';
import { createRun, updateRun, createArtifact } from '../../db/queries.js';

export interface PlanningResult {
  planSummary: string;
  confidence: number;       // 0-1 confidence score from planner
  subtasks: Array<{
    title: string;
    description: string;
    steps?: string[];      // TDD steps with exact instructions
    files?: string[];       // exact file paths to create/modify
  }>;
  assumptions: string[];
  fileMap: string[];        // all files created/modified across all subtasks
}

interface PlanReviewResult {
  approved: boolean;
  issues: string[];
}

const MAX_PLAN_RETRIES = 3;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load a prompt template from the prompts/ directory.
 */
function loadPromptTemplate(templateName: string): string {
  const promptPath = path.resolve(__dirname, `../../../../prompts/${templateName}`);
  try {
    return fs.readFileSync(promptPath, 'utf-8');
  } catch {
    throw new Error(`Prompt template not found at ${promptPath}. Ensure the prompts/ directory exists in the agentboard root.`);
  }
}

/**
 * Run the automated plan review step.
 * Returns whether the plan was approved and any issues found.
 */
async function runPlanReview(
  plan: PlanningResult,
  worktreePath: string,
  model: string,
  onOutput?: (chunk: string) => void
): Promise<PlanReviewResult> {
  const template = loadPromptTemplate('plan-review.md');
  const prompt = template.replace('{plan}', () => JSON.stringify(plan, null, 2));

  const result = await executeClaudeCode({
    prompt,
    worktreePath,
    model,
    tools: getToolsForStage('planning'),
    onOutput,
  });

  if (result.exitCode !== 0) {
    // If review itself fails, approve the plan to avoid blocking
    console.log('[planner] Plan review failed (exit code %d), approving plan by default', result.exitCode);
    return { approved: true, issues: [] };
  }

  return parsePlanReviewOutput(result.output);
}

/**
 * Parse the plan review response.
 */
function parsePlanReviewOutput(output: string): PlanReviewResult {
  // Try code fences first
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      return validatePlanReviewResult(JSON.parse(fenceMatch[1]));
    } catch {
      // Fall through
    }
  }

  // Try raw JSON
  const jsonMatch = output.match(/\{[\s\S]*"approved"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return validatePlanReviewResult(JSON.parse(jsonMatch[0]));
    } catch {
      // Fall through
    }
  }

  // Default: approve if we can't parse
  console.log('[planner] Could not parse plan review output, approving by default');
  return { approved: true, issues: [] };
}

/**
 * Validate and normalize plan review result.
 */
function validatePlanReviewResult(data: unknown): PlanReviewResult {
  const obj = data as Record<string, unknown>;
  return {
    approved: typeof obj.approved === 'boolean' ? obj.approved : true,
    issues: Array.isArray(obj.issues)
      ? (obj.issues as string[]).filter((i): i is string => typeof i === 'string')
      : [],
  };
}

/**
 * Run the planning stage for a task.
 *
 * - Builds a prompt from the v2 template + task context
 * - Executes via Claude Code CLI with Sonnet model
 * - Runs automated plan review
 * - Re-plans with feedback if review rejects (up to MAX_PLAN_RETRIES)
 * - Stores plan_summary, file_map as artifacts
 */
export async function runPlanning(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig,
  onOutput?: (chunk: string) => void
): Promise<PlanningResult> {
  const model = selectModel('planning', task.riskLevel, config);
  const taskPacket = buildTaskPacket(db, task);

  // Create a run record
  const run = createRun(db, {
    taskId: task.id,
    stage: 'planning',
    modelUsed: model,
    input: taskPacket,
  });

  try {
    let planningResult: PlanningResult | null = null;
    let reviewFeedback: string[] = [];

    for (let attempt = 0; attempt < MAX_PLAN_RETRIES; attempt++) {
      // Build prompt with optional review feedback
      const template = loadPromptTemplate('planner-v2.md');
      let prompt = template.replace('{taskSpec}', () => taskPacket);

      if (reviewFeedback.length > 0) {
        prompt += '\n\n## Previous Review Feedback\nYour previous plan was rejected. Address these issues:\n';
        prompt += reviewFeedback.map((f) => `- ${f}`).join('\n');
      }

      const result = await executeClaudeCode({
        prompt,
        worktreePath,
        model,
        tools: getToolsForStage('planning'),
        onOutput,
      });

      if (result.exitCode !== 0) {
        throw new Error(
          `Claude Code exited with code ${result.exitCode}: ${result.output}`
        );
      }

      planningResult = parseJsonFromOutput(result.output);

      // Run automated plan review
      console.log('[planner] Running automated plan review (attempt %d/%d)', attempt + 1, MAX_PLAN_RETRIES);
      const review = await runPlanReview(planningResult, worktreePath, model, onOutput);

      if (review.approved) {
        console.log('[planner] Plan approved by automated review');
        break;
      }

      console.log('[planner] Plan rejected: %s', review.issues.join('; '));
      reviewFeedback = review.issues;

      // On last attempt, use the plan as-is
      if (attempt === MAX_PLAN_RETRIES - 1) {
        console.log('[planner] Max retries reached, using last plan as-is');
      }
    }

    if (!planningResult) {
      throw new Error('Planning produced no result');
    }

    // Update the run with results
    updateRun(db, run.id, {
      status: 'success',
      output: JSON.stringify(planningResult),
      tokensUsed: 0, // aggregated from multiple calls
      finishedAt: new Date().toISOString(),
    });

    // Store artifacts
    createArtifact(db, {
      runId: run.id,
      type: 'plan',
      name: 'plan_summary',
      content: planningResult.planSummary,
    });

    if (planningResult.fileMap.length > 0) {
      createArtifact(db, {
        runId: run.id,
        type: 'plan',
        name: 'file_map',
        content: JSON.stringify(planningResult.fileMap),
      });
    }

    return planningResult;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    updateRun(db, run.id, {
      status: 'failed',
      output: errorMessage,
      finishedAt: new Date().toISOString(),
    });

    throw error;
  }
}

/**
 * Parse structured JSON from Claude's output.
 * The JSON block may be wrapped in markdown code fences.
 */
function parseJsonFromOutput(output: string): PlanningResult {
  // Try to find JSON in code fences first
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      return validatePlanningResult(JSON.parse(fenceMatch[1]));
    } catch {
      // Fall through to other methods
    }
  }

  // Try to find a raw JSON object
  const jsonMatch = output.match(/\{[\s\S]*"planSummary"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return validatePlanningResult(JSON.parse(jsonMatch[0]));
    } catch {
      // Fall through
    }
  }

  // Last resort: return a minimal result with the output as summary
  return {
    planSummary: output.slice(0, 1000),
    confidence: 0.3,
    subtasks: [],
    assumptions: [],
    fileMap: [],
  };
}

/**
 * Validate and normalize the parsed planning result.
 */
function validatePlanningResult(data: unknown): PlanningResult {
  const obj = data as Record<string, unknown>;
  return {
    planSummary: typeof obj.planSummary === 'string' ? obj.planSummary : '',
    confidence: typeof obj.confidence === 'number' && obj.confidence >= 0 && obj.confidence <= 1
      ? obj.confidence
      : 0.5,  // Default to medium confidence if not provided
    subtasks: Array.isArray(obj.subtasks)
      ? (obj.subtasks as Array<Record<string, unknown>>).map((s) => ({
          title: typeof s.title === 'string' ? s.title : '',
          description: typeof s.description === 'string' ? s.description : '',
          steps: Array.isArray(s.steps)
            ? (s.steps as string[]).filter((step): step is string => typeof step === 'string')
            : undefined,
          files: Array.isArray(s.files)
            ? (s.files as string[]).filter((f): f is string => typeof f === 'string')
            : undefined,
        }))
      : [],
    assumptions: Array.isArray(obj.assumptions)
      ? (obj.assumptions as string[]).filter(
          (a): a is string => typeof a === 'string'
        )
      : [],
    fileMap: Array.isArray(obj.fileMap)
      ? (obj.fileMap as string[]).filter(
          (f): f is string => typeof f === 'string'
        )
      : // Backwards compat: fall back to fileHints if present
        Array.isArray((obj as Record<string, unknown>).fileHints)
          ? ((obj as Record<string, unknown>).fileHints as string[]).filter(
              (f): f is string => typeof f === 'string'
            )
          : [],
  };
}
