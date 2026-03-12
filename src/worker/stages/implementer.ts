import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig } from '../../types/index.js';
import { buildTaskPacket } from '../context-builder.js';
import { executeClaudeCode } from '../executor.js';
import { createRun, updateRun } from '../../db/queries.js';

export interface ImplementationResult {
  success: boolean;
  output: string;
  needsUserInput?: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load the implementer prompt template from prompts/implementer.md
 */
function loadImplementerTemplate(): string {
  const promptPath = path.resolve(__dirname, '../../../prompts/implementer.md');
  return fs.readFileSync(promptPath, 'utf-8');
}

/**
 * Run the implementation stage for a task.
 *
 * - Builds prompt from template + task context
 * - If attempt > 1, includes failure summary from previous attempt
 * - Executes via Claude Code CLI with Opus model (always)
 * - Detects needs_user_input in output
 * - Tracks tokens and stores run in DB
 */
export async function runImplementation(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig,
  attempt: number
): Promise<ImplementationResult> {
  // Always use Opus for implementation
  const model = 'opus';

  const taskPacket = buildTaskPacket(db, task, {
    includeFailures: attempt > 1,
  });

  // Build the prompt
  const template = loadImplementerTemplate();
  let prompt = template.replace('{taskSpec}', () => taskPacket);

  // Include failure summary for retries
  if (attempt > 1) {
    // The buildTaskPacket already includes previous failure info,
    // but we also put it in the template placeholder
    prompt = prompt.replace('{failureSummary}', () =>
      `This is attempt ${attempt}. The previous attempt failed. See "Previous Failure" section above for details.`
    );
  } else {
    prompt = prompt.replace('{failureSummary}', 'N/A (first attempt)');
  }

  // Create a run record
  const run = createRun(db, {
    taskId: task.id,
    stage: 'implementing',
    attempt,
    modelUsed: model,
    input: prompt,
  });

  try {
    const result = await executeClaudeCode({
      prompt,
      worktreePath,
      model,
    });

    // Check for needs_user_input in output
    const userInputNeeded = parseNeedsUserInput(result.output);

    if (userInputNeeded) {
      updateRun(db, run.id, {
        status: 'success',
        output: result.output,
        tokensUsed: result.tokensUsed,
        modelUsed: model,
        finishedAt: new Date().toISOString(),
      });

      return {
        success: true,
        output: result.output,
        needsUserInput: userInputNeeded,
      };
    }

    // Check exit code
    if (result.exitCode !== 0) {
      updateRun(db, run.id, {
        status: 'failed',
        output: result.output,
        tokensUsed: result.tokensUsed,
        modelUsed: model,
        finishedAt: new Date().toISOString(),
      });

      return {
        success: false,
        output: result.output,
      };
    }

    // Success
    updateRun(db, run.id, {
      status: 'success',
      output: result.output,
      tokensUsed: result.tokensUsed,
      modelUsed: model,
      finishedAt: new Date().toISOString(),
    });

    return {
      success: true,
      output: result.output,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    updateRun(db, run.id, {
      status: 'failed',
      output: errorMessage,
      finishedAt: new Date().toISOString(),
    });

    return {
      success: false,
      output: errorMessage,
    };
  }
}

/**
 * Parse needs_user_input from the implementation output.
 * Returns the array of questions if found, undefined otherwise.
 */
function parseNeedsUserInput(output: string): string[] | undefined {
  // Try JSON in code fences
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1]) as Record<string, unknown>;
      if (Array.isArray(parsed.needs_user_input)) {
        return (parsed.needs_user_input as unknown[]).filter(
          (q): q is string => typeof q === 'string'
        );
      }
    } catch {
      // Not valid JSON in fence
    }
  }

  // Try raw JSON with needs_user_input key
  const jsonMatch = output.match(/\{[\s\S]*"needs_user_input"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      if (Array.isArray(parsed.needs_user_input)) {
        return (parsed.needs_user_input as unknown[]).filter(
          (q): q is string => typeof q === 'string'
        );
      }
    } catch {
      // Not valid JSON
    }
  }

  return undefined;
}
