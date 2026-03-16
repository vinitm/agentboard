import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig, SpecResult } from '../../types/index.js';
import { selectModel } from '../model-selector.js';
import { buildTaskPacket } from '../context-builder.js';
import { executeClaudeCode } from '../executor.js';
import { createRun, updateRun, createArtifact } from '../../db/queries.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load the spec-generator prompt template from prompts/spec-generator.md
 */
function loadSpecTemplate(): string {
  const promptPath = path.resolve(__dirname, '../../../../prompts/spec-generator.md');
  try {
    return fs.readFileSync(promptPath, 'utf-8');
  } catch {
    throw new Error(`Spec generator prompt template not found at ${promptPath}. Ensure the prompts/ directory exists in the agentboard root.`);
  }
}

/**
 * Run the spec generation stage for a task.
 *
 * - Builds a prompt from the template + task context
 * - Executes via Claude Code CLI
 * - Parses structured JSON output into a SpecResult
 * - Stores spec as an artifact
 */
export async function runSpecGeneration(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig,
  onOutput?: (chunk: string) => void
): Promise<SpecResult> {
  const model = selectModel('spec', task.riskLevel, config);
  const taskPacket = buildTaskPacket(db, task);

  // Build the prompt
  const template = loadSpecTemplate();
  const prompt = template.replace('{taskSpec}', () => taskPacket);

  // Create a run record
  const run = createRun(db, {
    taskId: task.id,
    stage: 'spec',
    modelUsed: model,
    input: prompt,
  });

  try {
    const result = await executeClaudeCode({
      prompt,
      worktreePath,
      model,
      onOutput,
    });

    // Check exit code before parsing output
    if (result.exitCode !== 0) {
      throw new Error(
        `Claude Code exited with code ${result.exitCode}: ${result.output}`
      );
    }

    // Parse the JSON response from the output
    const specResult = parseJsonFromOutput(result.output);

    // Update the run with results
    updateRun(db, run.id, {
      status: 'success',
      output: JSON.stringify(specResult),
      tokensUsed: result.tokensUsed,
      finishedAt: new Date().toISOString(),
    });

    // Store artifact
    createArtifact(db, {
      runId: run.id,
      type: 'spec',
      name: 'task_spec',
      content: JSON.stringify(specResult),
    });

    return specResult;
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
function parseJsonFromOutput(output: string): SpecResult {
  // Try to find JSON in code fences first
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      return validateSpecResult(JSON.parse(fenceMatch[1]));
    } catch {
      // Fall through to other methods
    }
  }

  // Try to find a raw JSON object
  const jsonMatch = output.match(/\{[\s\S]*"acceptanceCriteria"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return validateSpecResult(JSON.parse(jsonMatch[0]));
    } catch {
      // Fall through
    }
  }

  // Last resort: return a fallback with the raw output as the only acceptance criterion
  return {
    acceptanceCriteria: [output.slice(0, 1000)],
    fileScope: [],
    outOfScope: [],
    riskAssessment: 'medium — unable to parse structured output',
  };
}

/**
 * Validate and normalize the parsed spec result.
 */
function validateSpecResult(data: unknown): SpecResult {
  const obj = data as Record<string, unknown>;

  const acceptanceCriteria = Array.isArray(obj.acceptanceCriteria)
    ? (obj.acceptanceCriteria as string[]).filter(
        (a): a is string => typeof a === 'string'
      )
    : [];

  // Ensure acceptanceCriteria is non-empty
  if (acceptanceCriteria.length === 0) {
    throw new Error('acceptanceCriteria must be a non-empty string array');
  }

  return {
    acceptanceCriteria,
    fileScope: Array.isArray(obj.fileScope)
      ? (obj.fileScope as string[]).filter(
          (f): f is string => typeof f === 'string'
        )
      : [],
    outOfScope: Array.isArray(obj.outOfScope)
      ? (obj.outOfScope as string[]).filter(
          (o): o is string => typeof o === 'string'
        )
      : [],
    riskAssessment:
      typeof obj.riskAssessment === 'string' ? obj.riskAssessment : '',
  };
}
