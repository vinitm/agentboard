import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { StageLogStage } from '../types/index.js';
import { createStageLog, updateStageLog } from '../db/stage-log-queries.js';
import { broadcastLog, broadcastStageTransition } from '../server/ws.js';

export interface StageRunnerOptions {
  taskId: string;
  projectId: string;
  subtaskId?: string;
  io: Server;
  db: Database.Database;
  logsDir: string;
  projectRoot: string;
}

export interface ExecuteOptions {
  attempt?: number;
  runId?: string;
}

export interface StageRunner {
  execute<T>(
    stage: StageLogStage,
    fn: (onOutput: (chunk: string) => void) => T | Promise<T>,
    options?: ExecuteOptions & {
      summarize?: (result: T) => { summary?: string; tokensUsed?: number };
    }
  ): Promise<T>;
}

export function createStageRunner(opts: StageRunnerOptions): StageRunner {
  const { taskId, projectId, subtaskId, io, db, logsDir, projectRoot } = opts;

  function getFilePath(stage: StageLogStage, attempt: number): string {
    const dir = subtaskId
      ? path.join(logsDir, taskId, `subtask-${subtaskId}`)
      : path.join(logsDir, taskId);
    const fileName = attempt > 1 ? `${stage}-${attempt}.log` : `${stage}.log`;
    return path.join(dir, fileName);
  }

  return {
    async execute<T>(
      stage: StageLogStage,
      fn: (onOutput: (chunk: string) => void) => T | Promise<T>,
      options?: ExecuteOptions & {
        summarize?: (result: T) => { summary?: string; tokensUsed?: number };
      }
    ): Promise<T> {
      const attempt = options?.attempt ?? 1;
      const filePath = getFilePath(stage, attempt);
      const relativeFilePath = path.relative(projectRoot, filePath);
      const startedAt = new Date().toISOString();
      const startTime = Date.now();

      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      const stageLog = createStageLog(db, {
        taskId,
        projectId,
        runId: options?.runId,
        stage,
        subtaskId,
        attempt,
        filePath: relativeFilePath,
        startedAt,
      });

      broadcastStageTransition(io, { taskId, stage, subtaskId, status: 'running' });

      const onOutput = (chunk: string): void => {
        fs.appendFileSync(filePath, chunk, 'utf-8');
        broadcastLog(io, {
          taskId,
          runId: options?.runId ?? `stage-${stageLog.id}`,
          stage,
          subtaskId,
          chunk,
          timestamp: new Date().toISOString(),
        });
      };

      try {
        const result = await fn(onOutput);
        const durationMs = Date.now() - startTime;
        const extracted = options?.summarize?.(result) ?? {};

        updateStageLog(db, stageLog.id, {
          status: 'completed',
          summary: extracted.summary,
          tokensUsed: extracted.tokensUsed,
          durationMs,
          completedAt: new Date().toISOString(),
          runId: options?.runId,
        });

        broadcastStageTransition(io, {
          taskId, stage, subtaskId, status: 'completed',
          summary: extracted.summary, durationMs, tokensUsed: extracted.tokensUsed,
        });

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;

        updateStageLog(db, stageLog.id, {
          status: 'failed',
          summary: error instanceof Error ? error.message : String(error),
          durationMs,
          completedAt: new Date().toISOString(),
        });

        broadcastStageTransition(io, { taskId, stage, subtaskId, status: 'failed', durationMs });

        throw error;
      }
    },
  };
}
