import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig, ImplementationResult, ImplementerStatus } from '../../types/index.js';
import { buildTaskPacket } from '../context-builder.js';
import { executeClaudeCode } from '../executor.js';
import { createRun, updateRun } from '../../db/queries.js';

// Re-export for consumers that import from this module
export type { ImplementationResult, ImplementerStatus };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load the implementer prompt template from prompts/implementer-v2.md
 */
function loadImplementerTemplate(): string {
  const promptPath = path.resolve(__dirname, '../../../../prompts', 'implementer-v2.md');
  try {
    return fs.readFileSync(promptPath, 'utf-8');
  } catch {
    throw new Error(`Implementer prompt template not found at ${promptPath}. Ensure the prompts/ directory exists in the agentboard root.`);
  }
}

/**
 * Attempt to parse a structured JSON status block from Claude's output.
 * Looks for a fenced JSON block containing { "status": ... }.
 */
export function parseStructuredOutput(output: string): ImplementationResult | null {
  // Try to find a fenced JSON block: ```json ... ``` or ``` ... ```
  const fencedPattern = /```(?:json)?\s*\n(\{[\s\S]*?"status"\s*:[\s\S]*?\})\s*\n```/;
  const match = output.match(fencedPattern);

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const validStatuses: ImplementerStatus[] = ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'];

    if (typeof parsed.status !== 'string' || !validStatuses.includes(parsed.status as ImplementerStatus)) {
      return null;
    }

    const result: ImplementationResult = {
      status: parsed.status as ImplementerStatus,
      output,
    };

    if (Array.isArray(parsed.concerns)) {
      result.concerns = parsed.concerns.filter((c): c is string => typeof c === 'string');
    }

    if (Array.isArray(parsed.contextNeeded)) {
      result.contextNeeded = parsed.contextNeeded.filter((c): c is string => typeof c === 'string');
    }

    if (typeof parsed.blockerReason === 'string') {
      result.blockerReason = parsed.blockerReason;
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Run the implementation stage for a task.
 *
 * - Builds prompt from template + task context
 * - If attempt > 1, includes failure summary from previous attempt
 * - Executes via Claude Code CLI with Opus model (always)
 * - Tracks tokens and stores run in DB
 * - Parses structured JSON status from output; falls back to exit code inference
 */
export async function runImplementation(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig,
  attempt: number,
  onOutput?: (chunk: string) => void,
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

    // Try to parse structured JSON from the output
    const structured = parseStructuredOutput(result.output);

    if (structured) {
      console.log(`[implementer] Parsed structured status: ${structured.status}`);
      const runStatus = structured.status === 'DONE' || structured.status === 'DONE_WITH_CONCERNS'
        ? 'success'
        : 'failed';

      updateRun(db, run.id, {
        status: runStatus,
        output: result.output,
        tokensUsed: result.tokensUsed,
        modelUsed: model,
        finishedAt: new Date().toISOString(),
      });

      return structured;
    }

    // Fallback: infer status from exit code
    console.log(`[implementer] No structured output found, inferring from exit code: ${result.exitCode}`);

    if (result.exitCode !== 0) {
      updateRun(db, run.id, {
        status: 'failed',
        output: result.output,
        tokensUsed: result.tokensUsed,
        modelUsed: model,
        finishedAt: new Date().toISOString(),
      });

      return {
        status: 'BLOCKED',
        output: result.output,
        blockerReason: `Process exited with code ${result.exitCode}`,
      };
    }

    // Exit 0 without structured output = assume DONE
    updateRun(db, run.id, {
      status: 'success',
      output: result.output,
      tokensUsed: result.tokensUsed,
      modelUsed: model,
      finishedAt: new Date().toISOString(),
    });

    return {
      status: 'DONE',
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
      status: 'BLOCKED',
      output: errorMessage,
      blockerReason: errorMessage,
    };
  }
}
