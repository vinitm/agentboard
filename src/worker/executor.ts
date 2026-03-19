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
  inputTokens: number;
  outputTokens: number;
  duration: number;
}

/**
 * Spawn a Claude Code CLI subprocess and capture results.
 *
 * Uses `claude --print --output-format json --model <model>` for non-interactive mode,
 * piping the prompt to stdin. The JSON output format provides structured token usage data.
 */
export function executeClaudeCode(options: ExecuteOptions): Promise<ExecuteResult> {
  const { prompt, worktreePath, model, timeout = 300_000, tools, permissionMode = 'acceptEdits', onOutput } = options;
  const startTime = Date.now();

  return new Promise<ExecuteResult>((resolve) => {
    const args = ['--print', '--output-format', 'json', '--model', model, '--permission-mode', permissionMode];

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
        inputTokens: 0,
        outputTokens: 0,
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
      const exitCode = timedOut ? 124 : (code ?? 1);

      // Try to parse structured JSON output from Claude CLI
      const parsed = parseJsonOutput(stdout);

      const output = (parsed?.result ?? stdout) + (stderr ? `\n[stderr]\n${stderr}` : '') + timeoutSuffix;
      const inputTokens = parsed?.inputTokens ?? 0;
      const outputTokens = parsed?.outputTokens ?? 0;
      const tokensUsed = inputTokens + outputTokens || parseTokenUsageFallback(output);

      resolve({
        output,
        exitCode,
        tokensUsed,
        inputTokens,
        outputTokens,
        duration,
      });
    });
  });
}

interface ParsedJsonOutput {
  result: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Parse structured JSON output from `claude --output-format json`.
 * Returns the text result and token counts, or null if parsing fails.
 */
function parseJsonOutput(stdout: string): ParsedJsonOutput | null {
  try {
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;

    // Claude CLI JSON output contains 'result' (the text output) and 'usage' or top-level token fields
    const result = typeof parsed.result === 'string' ? parsed.result : stdout;

    let inputTokens = 0;
    let outputTokens = 0;

    // Check for usage object (standard Claude CLI JSON format)
    if (parsed.usage && typeof parsed.usage === 'object') {
      const usage = parsed.usage as Record<string, unknown>;
      inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
      outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
    }

    // Also check top-level fields
    if (typeof parsed.input_tokens === 'number') {
      inputTokens = parsed.input_tokens;
    }
    if (typeof parsed.output_tokens === 'number') {
      outputTokens = parsed.output_tokens;
    }

    return { result, inputTokens, outputTokens };
  } catch {
    return null;
  }
}

/**
 * Fallback: attempt to parse token usage from plain-text Claude CLI output.
 * Falls back to an estimate based on output length.
 */
function parseTokenUsageFallback(output: string): number {
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
