/**
 * E2E test helpers for agentboard pipeline tests.
 *
 * These tests exercise the full pipeline (worker loop + API + DB) but mock
 * the Claude Code executor so no real LLM calls are made.
 */
import type Database from 'better-sqlite3';
import { createTestDb, createTestConfig, createTestRepo } from '../src/test/helpers.js';
import {
  createProject,
  createTask,
  getTaskById,
  type CreateTaskData,
} from '../src/db/queries.js';
import type { Task, AgentboardConfig } from '../src/types/index.js';

export interface E2EContext {
  db: Database.Database;
  config: AgentboardConfig;
  projectId: string;
  repoPath: string;
  cleanup: () => void;
}

/**
 * Set up a fresh test environment with DB, project, and git repo.
 */
export async function setupE2EContext(
  configOverrides?: Record<string, unknown>
): Promise<E2EContext> {
  const db = createTestDb();
  const { repoPath, cleanup } = await createTestRepo();

  const config = createTestConfig({
    maxConcurrentTasks: 1,
    maxReviewCycles: 2,
    autoMerge: false,
    ...configOverrides,
  });

  const project = createProject(db, {
    name: 'e2e-test-project',
    path: repoPath,
    configPath: `${repoPath}/.agentboard/config.json`,
  });

  return { db, config, projectId: project.id, repoPath, cleanup };
}

/**
 * Create a task in the test project, defaulting to 'ready' status with a spec.
 */
export function createE2ETask(
  db: Database.Database,
  projectId: string,
  overrides?: Partial<CreateTaskData>
): Task {
  return createTask(db, {
    projectId,
    title: 'E2E test task',
    description: 'A task created for E2E testing',
    status: 'ready',
    riskLevel: 'low',
    spec: JSON.stringify({
      title: 'E2E test task',
      requirements: ['Implement the feature'],
      acceptanceCriteria: ['Tests pass'],
    }),
    ...overrides,
  });
}

/**
 * Poll DB until a task reaches one of the expected statuses, or timeout.
 */
export async function waitForTaskStatus(
  db: Database.Database,
  taskId: string,
  expectedStatuses: string[],
  timeoutMs = 30_000,
  pollMs = 200
): Promise<Task> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = getTaskById(db, taskId);
    if (task && expectedStatuses.includes(task.status)) {
      return task;
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  const finalTask = getTaskById(db, taskId);
  throw new Error(
    `Task ${taskId} did not reach status [${expectedStatuses.join(', ')}] within ${timeoutMs}ms. ` +
    `Current status: ${finalTask?.status ?? 'not found'}`
  );
}

/**
 * Build a mock executor response for a given stage.
 * Returns canned JSON output that the stage parsers expect.
 */
export function mockExecutorResponse(stage: string, options?: {
  passed?: boolean;
  issues?: string[];
  subtaskCount?: number;
  role?: string;
}): { output: string; exitCode: number; tokensUsed: number; duration: number } {
  const { passed = true, issues = [], subtaskCount = 0, role } = options ?? {};

  let output: string;

  switch (stage) {
    case 'spec':
      output = JSON.stringify({
        title: 'E2E test task',
        requirements: ['Implement the feature'],
        acceptanceCriteria: ['Tests pass'],
        riskLevel: 'low',
      });
      break;

    case 'planning':
      if (subtaskCount > 0) {
        const subtasks = Array.from({ length: subtaskCount }, (_, i) => ({
          title: `Subtask ${i + 1}`,
          description: `Implementation step ${i + 1}`,
        }));
        output = JSON.stringify({
          approach: 'Decompose into subtasks',
          steps: subtasks.map(s => s.title),
          subtasks,
        });
      } else {
        output = JSON.stringify({
          approach: 'Direct implementation',
          steps: ['Write code', 'Add tests'],
          subtasks: [],
        });
      }
      break;

    case 'implementing':
      output = 'Implementation complete. All changes committed.';
      break;

    case 'checks':
      output = passed
        ? JSON.stringify({ passed: true, results: { test: true, lint: true, typecheck: true } })
        : JSON.stringify({ passed: false, results: { test: false, lint: true, typecheck: true }, errors: ['Test failed'] });
      break;

    case 'review_panel':
      output = `\`\`\`json\n${JSON.stringify({
        passed,
        feedback: passed ? 'Looks good.' : 'Issues found.',
        issues,
      })}\n\`\`\``;
      break;

    case 'pr_creation':
      output = JSON.stringify({ prUrl: 'https://github.com/test/repo/pull/1', prNumber: 1 });
      break;

    default:
      output = `Mock output for stage: ${stage}`;
  }

  return {
    output,
    exitCode: passed !== false ? 0 : 1,
    tokensUsed: 100,
    duration: 500,
  };
}
