import { execFile } from 'node:child_process';

export interface ExecuteOptions {
  prompt: string;
  worktreePath: string;
  model: string;
  timeout?: number;
}

export interface ExecuteResult {
  output: string;
  exitCode: number;
  tokensUsed: number;
  duration: number;
}

/**
 * Spawn a Claude Code CLI subprocess and capture results.
 *
 * Uses `claude --print --model <model>` for non-interactive mode,
 * piping the prompt to stdin.
 */
export function executeClaudeCode(options: ExecuteOptions): Promise<ExecuteResult> {
  const { prompt, worktreePath, model, timeout = 300_000 } = options;
  const startTime = Date.now();

  return new Promise<ExecuteResult>((resolve) => {
    const args = ['--print', '--model', model, '-p', prompt];

    const child = execFile(
      'claude',
      args,
      {
        cwd: worktreePath,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        const duration = Date.now() - startTime;
        const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
        const rawCode = error
          ? (error as NodeJS.ErrnoException & { code?: string | number }).code
          : 0;
        const exitCode = typeof rawCode === 'number' ? rawCode : 1;

        // Try to parse token usage from output
        const tokensUsed = parseTokenUsage(output);

        resolve({
          output,
          exitCode,
          tokensUsed,
          duration,
        });
      }
    );

    // Safety: if child process is somehow null
    if (!child) {
      resolve({
        output: 'Failed to spawn claude process',
        exitCode: 1,
        tokensUsed: 0,
        duration: Date.now() - startTime,
      });
    }
  });
}

/**
 * Attempt to parse token usage from Claude CLI output.
 * Falls back to an estimate based on output length.
 */
function parseTokenUsage(output: string): number {
  // Look for common patterns like "tokens used: 1234" or "Total tokens: 1234"
  const patterns = [
    /tokens?\s*used\s*[:=]\s*(\d+)/i,
    /total\s*tokens?\s*[:=]\s*(\d+)/i,
    /(\d+)\s*tokens?\s*used/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) {
      return parseInt(match[1], 10);
    }
  }

  // Estimate: ~4 chars per token
  return Math.ceil(output.length / 4);
}
