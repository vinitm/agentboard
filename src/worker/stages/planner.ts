import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig } from '../../types/index.js';
import { selectModel } from '../model-selector.js';
import { buildTaskPacket } from '../context-builder.js';
import { executeClaudeCode } from '../executor.js';
import { createRun, updateRun, createArtifact } from '../../db/queries.js';

export interface PlanningResult {
  planSummary: string;
  subtasks: Array<{ title: string; description: string }>;
  questions: string[];
  fileHints: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load the planner prompt template from prompts/planner.md
 */
function loadPlannerTemplate(): string {
  const promptPath = path.resolve(__dirname, '../../../prompts/planner.md');
  return fs.readFileSync(promptPath, 'utf-8');
}

/**
 * Run the planning stage for a task.
 *
 * - Builds a prompt from the template + task context
 * - Executes via Claude Code CLI with Sonnet model
 * - Parses structured JSON output
 * - Stores plan_summary and file_hints as artifacts
 */
export async function runPlanning(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig
): Promise<PlanningResult> {
  const model = selectModel('planning', task.riskLevel, config);
  const taskPacket = buildTaskPacket(db, task);

  // Build the prompt
  const template = loadPlannerTemplate();
  const prompt = template.replace('{taskSpec}', taskPacket);

  // Create a run record
  const run = createRun(db, {
    taskId: task.id,
    stage: 'planning',
    modelUsed: model,
    input: prompt,
  });

  try {
    const result = await executeClaudeCode({
      prompt,
      worktreePath,
      model,
    });

    // Parse the JSON response from the output
    const planningResult = parseJsonFromOutput(result.output);

    // Update the run with results
    updateRun(db, run.id, {
      status: 'success',
      output: JSON.stringify(planningResult),
      tokensUsed: result.tokensUsed,
      finishedAt: new Date().toISOString(),
    });

    // Store artifacts
    createArtifact(db, {
      runId: run.id,
      type: 'plan',
      name: 'plan_summary',
      content: planningResult.planSummary,
    });

    if (planningResult.fileHints.length > 0) {
      createArtifact(db, {
        runId: run.id,
        type: 'plan',
        name: 'file_hints',
        content: JSON.stringify(planningResult.fileHints),
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
    subtasks: [],
    questions: [],
    fileHints: [],
  };
}

/**
 * Validate and normalize the parsed planning result.
 */
function validatePlanningResult(data: unknown): PlanningResult {
  const obj = data as Record<string, unknown>;
  return {
    planSummary: typeof obj.planSummary === 'string' ? obj.planSummary : '',
    subtasks: Array.isArray(obj.subtasks)
      ? (obj.subtasks as Array<{ title: string; description: string }>).map(
          (s) => ({
            title: typeof s.title === 'string' ? s.title : '',
            description: typeof s.description === 'string' ? s.description : '',
          })
        )
      : [],
    questions: Array.isArray(obj.questions)
      ? (obj.questions as string[]).filter(
          (q): q is string => typeof q === 'string'
        )
      : [],
    fileHints: Array.isArray(obj.fileHints)
      ? (obj.fileHints as string[]).filter(
          (f): f is string => typeof f === 'string'
        )
      : [],
  };
}
