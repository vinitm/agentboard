import fs from 'node:fs';
import path from 'node:path';

const SEPARATOR = '════════════════════════════════════════════════════════════════════════════════';
const STAGE_SEP = '── ';

function timestamp(): string {
  return new Date().toISOString();
}

/**
 * A buffered log writer that collects chunks in memory
 * and flushes them to the parent TaskLogger on demand.
 * Used for parallel stages (e.g. review panel reviewers)
 * to avoid interleaved output in the log file.
 */
export interface BufferedWriter {
  /** Append a chunk to the in-memory buffer. */
  write(chunk: string): void;
  /** Return all buffered content and clear the buffer. */
  flush(): string;
}

export function createBufferedWriter(): BufferedWriter {
  const buffer: string[] = [];
  return {
    write(chunk: string): void {
      buffer.push(`[${timestamp()}] ${chunk}`);
    },
    flush(): string {
      const content = buffer.join('');
      buffer.length = 0;
      return content;
    },
  };
}

/**
 * A single-file logger for a task.
 * Parallel stages (review panel) use buffered writers
 * that flush sequentially after completion.
 */
export interface TaskLogger {
  /** Write the task header (called once at creation). */
  readonly logPath: string;

  /** Mark the start of a pipeline stage. */
  stageStart(stage: string, runId: string, attempt: number, model: string): void;

  /** Append a streaming chunk from Claude output. */
  write(chunk: string): void;

  /** Mark the end of a pipeline stage. */
  stageEnd(status: string, tokens?: number, durationMs?: number): void;

  /** Write a parallel section header (e.g. reviewer role). */
  parallelSectionStart(label: string, runId: string): void;

  /** Append pre-buffered content (from a BufferedWriter.flush()). */
  writeBuffered(content: string): void;

  /** Write a parallel section end. */
  parallelSectionEnd(label: string, status: string, details?: string): void;

  /** Write an event line. */
  event(type: string, data?: string): void;

  /** Write an error line. */
  error(message: string): void;

  /** Get the current file size in bytes. */
  sizeBytes(): number;
}

export function createTaskLogger(
  configDir: string,
  taskId: number,
  title: string,
  riskLevel: string
): TaskLogger {
  const logsDir = path.join(configDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const logPath = path.join(logsDir, `${taskId}.log`);

  // Write task header
  const header = [
    SEPARATOR,
    `TASK: ${title}`,
    `ID: ${taskId} | Risk: ${riskLevel} | Started: ${timestamp()}`,
    SEPARATOR,
    '',
  ].join('\n');

  fs.appendFileSync(logPath, header, 'utf-8');

  return {
    logPath,

    stageStart(stage: string, runId: string, attempt: number, model: string): void {
      const line = `\n${STAGE_SEP}STAGE: ${stage} (run: ${runId}, attempt: ${attempt}) ${'─'.repeat(40)}\n[${timestamp()}] [start] model=${model}\n`;
      fs.appendFileSync(logPath, line, 'utf-8');
    },

    write(chunk: string): void {
      const line = `[${timestamp()}] ${chunk}`;
      fs.appendFileSync(logPath, line, 'utf-8');
    },

    stageEnd(status: string, tokens?: number, durationMs?: number): void {
      const parts = [`[${timestamp()}] [end] status=${status}`];
      if (tokens !== undefined) parts.push(`tokens=${tokens}`);
      if (durationMs !== undefined) parts.push(`duration=${durationMs}ms`);
      fs.appendFileSync(logPath, parts.join(' ') + '\n', 'utf-8');
    },

    parallelSectionStart(label: string, runId: string): void {
      const line = `\n  ${STAGE_SEP}${label} (run: ${runId}) ${'─'.repeat(30)}\n`;
      fs.appendFileSync(logPath, line, 'utf-8');
    },

    writeBuffered(content: string): void {
      if (content.length > 0) {
        // Indent buffered content for visual nesting under parallel sections
        const indented = content.split('\n').map(l => l ? `  ${l}` : l).join('\n');
        fs.appendFileSync(logPath, indented, 'utf-8');
      }
    },

    parallelSectionEnd(label: string, status: string, details?: string): void {
      const parts = [`  [${timestamp()}] [end] ${label} status=${status}`];
      if (details) parts.push(details);
      fs.appendFileSync(logPath, parts.join(' ') + '\n', 'utf-8');
    },

    event(type: string, data?: string): void {
      const line = `\n${STAGE_SEP}EVENT: ${type} ${'─'.repeat(50)}\n[${timestamp()}] ${data ?? ''}\n`;
      fs.appendFileSync(logPath, line, 'utf-8');
    },

    error(message: string): void {
      fs.appendFileSync(logPath, `[${timestamp()}] [ERROR] ${message}\n`, 'utf-8');
    },

    sizeBytes(): number {
      try {
        return fs.statSync(logPath).size;
      } catch {
        return 0;
      }
    },
  };
}

/**
 * Open an existing task log file for appending.
 */
export function openTaskLogger(logPath: string): TaskLogger {
  return {
    logPath,

    stageStart(stage: string, runId: string, attempt: number, model: string): void {
      const line = `\n  ${STAGE_SEP}STAGE: ${stage} (run: ${runId}, attempt: ${attempt}) ${'─'.repeat(34)}\n  [${timestamp()}] [start] model=${model}\n`;
      fs.appendFileSync(logPath, line, 'utf-8');
    },

    write(chunk: string): void {
      const line = `  [${timestamp()}] ${chunk}`;
      fs.appendFileSync(logPath, line, 'utf-8');
    },

    stageEnd(status: string, tokens?: number, durationMs?: number): void {
      const parts = [`  [${timestamp()}] [end] status=${status}`];
      if (tokens !== undefined) parts.push(`tokens=${tokens}`);
      if (durationMs !== undefined) parts.push(`duration=${durationMs}ms`);
      fs.appendFileSync(logPath, parts.join(' ') + '\n', 'utf-8');
    },

    parallelSectionStart(label: string, runId: string): void {
      const line = `\n    ${STAGE_SEP}${label} (run: ${runId}) ${'─'.repeat(26)}\n`;
      fs.appendFileSync(logPath, line, 'utf-8');
    },

    writeBuffered(content: string): void {
      if (content.length > 0) {
        const indented = content.split('\n').map(l => l ? `    ${l}` : l).join('\n');
        fs.appendFileSync(logPath, indented, 'utf-8');
      }
    },

    parallelSectionEnd(label: string, status: string, details?: string): void {
      const parts = [`    [${timestamp()}] [end] ${label} status=${status}`];
      if (details) parts.push(details);
      fs.appendFileSync(logPath, parts.join(' ') + '\n', 'utf-8');
    },

    event(type: string, data?: string): void {
      const line = `\n  ${STAGE_SEP}EVENT: ${type} ${'─'.repeat(44)}\n  [${timestamp()}] ${data ?? ''}\n`;
      fs.appendFileSync(logPath, line, 'utf-8');
    },

    error(message: string): void {
      fs.appendFileSync(logPath, `  [${timestamp()}] [ERROR] ${message}\n`, 'utf-8');
    },

    sizeBytes(): number {
      try {
        return fs.statSync(logPath).size;
      } catch {
        return 0;
      }
    },
  };
}

/**
 * Delete log files older than retentionDays.
 */
export function cleanupOldLogs(configDir: string, retentionDays: number = 30): number {
  const logsDir = path.join(configDir, 'logs');
  if (!fs.existsSync(logsDir)) return 0;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  for (const entry of fs.readdirSync(logsDir, { withFileTypes: true })) {
    const entryPath = path.join(logsDir, entry.name);
    try {
      const stat = fs.statSync(entryPath);
      if (stat.mtimeMs < cutoff) {
        if (entry.isDirectory()) {
          // Per-stage log directories (logs/{taskId}/)
          fs.rmSync(entryPath, { recursive: true, force: true });
          deleted++;
        } else if (entry.name.endsWith('.log')) {
          // Monolithic log files (legacy)
          fs.unlinkSync(entryPath);
          deleted++;
        }
      }
    } catch {
      // Best effort
    }
  }

  if (deleted > 0) {
    console.log(`[worker] Cleaned up ${deleted} log files older than ${retentionDays} days`);
  }
  return deleted;
}
