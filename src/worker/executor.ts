import { spawn } from 'node:child_process';

export interface ExecuteOptions {
  prompt: string;
  worktreePath: string;
  model: string;
  timeout?: number;
  /** Explicit tool list (e.g. ['Read','Glob','Grep']). When set, appends --tools to restrict available tools. */
  tools?: string[];
  /** Permission mode for the session. Defaults to 'acceptEdits'. */
  permissionMode?: 'acceptEdits' | 'bypassPermissions';
  /** Optional callback invoked with each chunk of stdout/stderr as it arrives. */
  onOutput?: (chunk: string) => void;
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
  const { prompt, worktreePath, model, timeout = 300_000, tools, permissionMode = 'acceptEdits', onOutput } = options;
  const startTime = Date.now();

  return new Promise<ExecuteResult>((resolve) => {
    const args = ['--print', '--model', model, '--permission-mode', permissionMode];

    if (tools && tools.length > 0) {
      args.push('--tools', tools.join(','));
    }

    const child = spawn('claude', args, {
      cwd: worktreePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        output: `Failed to spawn claude process: ${err.message}`,
        exitCode: 1,
        tokensUsed: 0,
        duration: Date.now() - startTime,
      });
    });

    // Write the prompt to stdin, then close it
    child.stdin.write(prompt);
    child.stdin.end();

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (onOutput) onOutput(text);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (onOutput) onOutput(text);
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      const timeoutSuffix = timedOut
        ? `\n[timeout] Process killed after ${Math.round(timeout / 1000)}s timeout`
        : '';
      const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '') + timeoutSuffix;
      const exitCode = timedOut ? 124 : (code ?? 1);

      // Try to parse token usage from output
      const tokensUsed = parseTokenUsage(output);

      resolve({
        output,
        exitCode,
        tokensUsed,
        duration,
      });
    });
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
