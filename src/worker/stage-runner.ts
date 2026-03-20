import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { StageLogStage } from '../types/index.js';
import { createStageLog, updateStageLog } from '../db/stage-log-queries.js';
import { broadcastLog, broadcastStageTransition } from '../server/ws.js';
import { createAsyncBufferedWriter, type AsyncBufferedWriter } from './log-writer.js';

export interface StageRunnerOptions {
  taskId: number;
  projectId: string;
  io: Server;
  db: Database.Database;
  logsDir: string;
  projectRoot: string;
  terminalMode?: 'pty' | 'print';
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
  const { taskId, projectId, io, db, logsDir, projectRoot } = opts;

  function getFilePath(stage: StageLogStage, attempt: number): string {
    const dir = path.join(logsDir, String(taskId));
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
        attempt,
        filePath: relativeFilePath,
        startedAt,
        terminalMode: opts.terminalMode ?? 'print',
      });

      broadcastStageTransition(io, { taskId, stage, status: 'running' });

      const asyncWriter: AsyncBufferedWriter | null = opts.terminalMode === 'pty'
        ? createAsyncBufferedWriter(filePath)
        : null;

      const onOutput = (chunk: string): void => {
        if (asyncWriter) {
          asyncWriter.write(chunk);
        } else {
          fs.appendFileSync(filePath, chunk, 'utf-8');
        }
        broadcastLog(io, {
          taskId,
          runId: options?.runId ?? `stage-${stageLog.id}`,
          stage,
          chunk,
          timestamp: new Date().toISOString(),
        });
      };

      try {
        const result = await fn(onOutput);
        const durationMs = Date.now() - startTime;
        const extracted = options?.summarize?.(result) ?? {};

        if (asyncWriter) await asyncWriter.flush();
        asyncWriter?.destroy();

        updateStageLog(db, stageLog.id, {
          status: 'completed',
          summary: extracted.summary,
          tokensUsed: extracted.tokensUsed,
          durationMs,
          completedAt: new Date().toISOString(),
          runId: options?.runId,
        });

        broadcastStageTransition(io, {
          taskId, stage, status: 'completed',
          summary: extracted.summary, durationMs, tokensUsed: extracted.tokensUsed,
        });

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;

        if (asyncWriter) await asyncWriter.flush();
        asyncWriter?.destroy();

        updateStageLog(db, stageLog.id, {
          status: 'failed',
          summary: error instanceof Error ? error.message : String(error),
          durationMs,
          completedAt: new Date().toISOString(),
        });

        broadcastStageTransition(io, { taskId, stage, status: 'failed', durationMs });

        throw error;
      }
    },
  };
}
