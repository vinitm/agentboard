import type Database from 'better-sqlite3';
import type { Task } from '../types/index.js';
import {
  getLatestRunByTaskAndStage,
  listRunsByTask,
  listArtifactsByRun,
  listEventsByTask,
} from '../db/queries.js';

export interface BuildTaskPacketOptions {
  includeFailures?: boolean;
  includeAnswers?: boolean;
}

/**
 * Build the prompt context packet for an agent run.
 *
 * Lean packet containing:
 * - Task spec (from task.spec JSON)
 * - File hints (from planner output, if available)
 * - Failure summary (from previous failed run, if any)
 * - User answers (from events with type 'answer_provided')
 */
export function buildTaskPacket(
  db: Database.Database,
  task: Task,
  options?: BuildTaskPacketOptions
): string {
  const sections: string[] = [];

  // ── Task spec ──────────────────────────────────────────────────────
  sections.push('## Task');
  sections.push(`**Title:** ${task.title}`);
  sections.push(`**Description:** ${task.description}`);
  if (task.spec) {
    sections.push(`**Spec:**\n${task.spec}`);
  }

  // ── File hints from planning run ───────────────────────────────────
  const planningRun = getLatestRunByTaskAndStage(db, task.id, 'planning');
  if (planningRun?.output) {
    try {
      const planOutput = JSON.parse(planningRun.output) as {
        fileHints?: string[];
        planSummary?: string;
      };
      if (planOutput.fileHints && planOutput.fileHints.length > 0) {
        sections.push('## File Hints');
        sections.push(planOutput.fileHints.map((f) => `- ${f}`).join('\n'));
      }
      if (planOutput.planSummary) {
        sections.push('## Plan Summary');
        sections.push(planOutput.planSummary);
      }
    } catch {
      // Planning output was not valid JSON; check artifacts instead
    }

    // Also check artifacts for file_hints
    const planArtifacts = listArtifactsByRun(db, planningRun.id);
    for (const artifact of planArtifacts) {
      if (artifact.name === 'file_hints') {
        sections.push('## File Hints (artifact)');
        sections.push(artifact.content);
      }
    }
  }

  // ── Failure summary from previous failed run ───────────────────────
  if (options?.includeFailures !== false) {
    const runs = listRunsByTask(db, task.id);
    const failedRun = runs.find((r) => r.status === 'failed');
    if (failedRun?.output) {
      sections.push('## Previous Failure');
      // Truncate to keep context lean
      const truncated =
        failedRun.output.length > 2000
          ? failedRun.output.slice(0, 2000) + '\n...(truncated)'
          : failedRun.output;
      sections.push(truncated);
    }
  }

  // ── User answers from events ───────────────────────────────────────
  if (options?.includeAnswers !== false) {
    const events = listEventsByTask(db, task.id);
    const answers = events.filter((e) => e.type === 'answer_provided');
    if (answers.length > 0) {
      sections.push('## User Answers');
      for (const answer of answers) {
        try {
          const payload = JSON.parse(answer.payload) as {
            question?: string;
            answer?: string;
          };
          if (payload.question && payload.answer) {
            sections.push(`**Q:** ${payload.question}\n**A:** ${payload.answer}`);
          } else {
            sections.push(answer.payload);
          }
        } catch {
          sections.push(answer.payload);
        }
      }
    }
  }

  return sections.join('\n\n');
}
