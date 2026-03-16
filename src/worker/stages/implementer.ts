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
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load the implementer prompt template from prompts/implementer.md
 */
function loadImplementerTemplate(): string {
  const promptPath = path.resolve(__dirname, '../../../../prompts/implementer.md');
  try {
    return fs.readFileSync(promptPath, 'utf-8');
  } catch {
    throw new Error(`Implementer prompt template not found at ${promptPath}. Ensure the prompts/ directory exists in the agentboard root.`);
  }
}

/**
 * Run the implementation stage for a task.
 *
 * - Builds prompt from template + task context
 * - If attempt > 1, includes failure summary from previous attempt
 * - Executes via Claude Code CLI with Opus model (always)
 * - Tracks tokens and stores run in DB
 */
export async function runImplementation(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig,
  attempt: number,
  onOutput?: (chunk: string) => void
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
      onOutput,
    });

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
      tokensUsed: 0,
      finishedAt: new Date().toISOString(),
    });

    return {
      success: false,
      output: errorMessage,
    };
  }
}

