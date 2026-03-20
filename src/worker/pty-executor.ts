import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExecuteResult } from './executor.js';
import type { PtyHandle } from './pty-manager.js';

export type { PtyHandle } from './pty-manager.js';

// ---------------------------------------------------------------------------
// ANSI stripping
// ---------------------------------------------------------------------------

/**
 * Remove all ANSI escape sequences from a string.
 * Covers CSI sequences, OSC sequences, and simple two-char escapes.
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001b\u009b](\[[0-9;]*[A-Za-z]|\][^\u0007]*\u0007|[()][AB012]|[A-Za-z])/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// ---------------------------------------------------------------------------
// Prompt detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the last non-empty line of `rawText` is a bare Claude Code
 * prompt (`>` or `> `), while rejecting markdown blockquotes and `>` that
 * appears inside fenced code blocks.
 */
export function detectPrompt(rawText: string): boolean {
  const cleaned = stripAnsi(rawText);
  const lines = cleaned.split('\n');

  let inCodeBlock = false;

  // Walk all lines to track code-block parity
  let lastNonEmptyTrimmed = '';
  let lastNonEmptyInCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trimStart();

    // Toggle code-block state on lines starting with triple backticks
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }

    if (trimmed.length > 0) {
      lastNonEmptyTrimmed = trimmed;
      lastNonEmptyInCodeBlock = inCodeBlock;
    }
  }

  // Reject if inside a code block
  if (lastNonEmptyInCodeBlock) {
    return false;
  }

  // Accept only bare `>` or `> ` (with optional trailing whitespace)
  const bare = lastNonEmptyTrimmed.trimEnd();
  if (bare !== '>' && bare !== '> ') {
    // Also handle the case where it's just '>' followed by spaces
    if (bare === '>') return true;
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Session states
// ---------------------------------------------------------------------------

export type SessionState =
  | 'SPAWNING'
  | 'READY'
  | 'WORKING'
  | 'IDLE'
  | 'EXTRACTING'
  | 'EXITING'
  | 'DONE'
  | 'FAILED';

export type StateChangeCallback = (from: SessionState, to: SessionState) => void;

// ---------------------------------------------------------------------------
// PtySessionState — state machine for a single PTY session
// ---------------------------------------------------------------------------

export class PtySessionState {
  private _state: SessionState = 'SPAWNING';
  private _buffer = '';
  private _quiescenceTimer: ReturnType<typeof setTimeout> | null = null;
  private _onStateChange: StateChangeCallback | null = null;
  private _quiescenceMs: number;
  private _destroyed = false;

  constructor(quiescenceMs = 3000) {
    this._quiescenceMs = quiescenceMs;
  }

  get state(): SessionState {
    return this._state;
  }

  get buffer(): string {
    return this._buffer;
  }

  /**
   * Register a callback fired on every state transition.
   */
  setOnStateChange(cb: StateChangeCallback): void {
    this._onStateChange = cb;
  }

  /**
   * Transition to a new state. Logs and notifies listeners.
   */
  transition(newState: SessionState): void {
    if (this._destroyed) return;
    const from = this._state;
    this._state = newState;
    console.log(`[pty-session] ${from} -> ${newState}`);
    if (this._onStateChange) {
      this._onStateChange(from, newState);
    }
  }

  /**
   * Feed raw PTY data into the state machine.
   * Accumulates the buffer and manages quiescence timers for prompt detection.
   */
  onData(data: string): void {
    if (this._destroyed) return;
    this._buffer += data;

    // Only run quiescence detection in SPAWNING or WORKING states
    if (this._state !== 'SPAWNING' && this._state !== 'WORKING') {
      return;
    }

    // Clear any existing quiescence timer — new data resets the clock
    if (this._quiescenceTimer !== null) {
      clearTimeout(this._quiescenceTimer);
      this._quiescenceTimer = null;
    }

    // Check for prompt; if detected, start a quiescence timer
    if (detectPrompt(this._buffer)) {
      const targetState: SessionState = this._state === 'SPAWNING' ? 'READY' : 'IDLE';
      // Use a shorter quiescence for SPAWNING → READY (2s) vs WORKING → IDLE (configured)
      const delay = this._state === 'SPAWNING' ? Math.min(2000, this._quiescenceMs) : this._quiescenceMs;

      this._quiescenceTimer = setTimeout(() => {
        // Re-check that state hasn't changed while waiting
        if (this._destroyed) return;
        if (
          (targetState === 'READY' && this._state === 'SPAWNING') ||
          (targetState === 'IDLE' && this._state === 'WORKING')
        ) {
          this.transition(targetState);
        }
      }, delay);
    }
  }

  /**
   * Clear the accumulated output buffer.
   */
  clearBuffer(): void {
    this._buffer = '';
  }

  /**
   * Tear down timers and mark the session as destroyed.
   */
  destroy(): void {
    this._destroyed = true;
    if (this._quiescenceTimer !== null) {
      clearTimeout(this._quiescenceTimer);
      this._quiescenceTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Stage result file I/O
// ---------------------------------------------------------------------------

export interface PtyStageResult {
  /** Free-form JSON written by the agent. */
  [key: string]: unknown;
}

/**
 * Read `.agentboard/stage-result.json` from a worktree path.
 * Returns null if the file doesn't exist or is unparseable.
 */
export async function readStageResultFile(worktreePath: string): Promise<PtyStageResult | null> {
  const filePath = join(worktreePath, '.agentboard', 'stage-result.json');
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as PtyStageResult;
  } catch {
    return null;
  }
}

/**
 * Delete `.agentboard/stage-result.json` from a worktree path (best-effort).
 */
export async function cleanStageResultFile(worktreePath: string): Promise<void> {
  const filePath = join(worktreePath, '.agentboard', 'stage-result.json');
  try {
    await unlink(filePath);
  } catch {
    // Ignore — file may not exist
  }
}

// ---------------------------------------------------------------------------
// Cost output parsing
// ---------------------------------------------------------------------------

/**
 * Parse the output of the `/cost` slash command.
 * Looks for patterns like:
 *   - "Input tokens: 12,345"
 *   - "Output tokens: 6,789"
 */
export function parseCostOutput(rawOutput: string): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;

  const inputMatch = rawOutput.match(/input\s*tokens?\s*[:=]\s*([\d,]+)/i);
  if (inputMatch?.[1]) {
    inputTokens = parseInt(inputMatch[1].replace(/,/g, ''), 10);
  }

  const outputMatch = rawOutput.match(/output\s*tokens?\s*[:=]\s*([\d,]+)/i);
  if (outputMatch?.[1]) {
    outputTokens = parseInt(outputMatch[1].replace(/,/g, ''), 10);
  }

  return { inputTokens, outputTokens };
}

// ---------------------------------------------------------------------------
// Main PTY executor
// ---------------------------------------------------------------------------

export interface ExecutePtySessionOptions {
  /** The PTY handle from pty-manager. */
  handle: PtyHandle;
  /** The prompt to inject once the session is ready. */
  prompt: string;
  /** Path to the worktree for reading stage-result.json. */
  worktreePath: string;
  /** Overall timeout in milliseconds (default 300_000). */
  timeout?: number;
  /** Quiescence period in milliseconds (default 3000). */
  quiescenceMs?: number;
  /** Optional callback for streaming raw output. */
  onOutput?: (chunk: string) => void;
}

/**
 * Drive a Claude Code PTY session through its full lifecycle:
 *
 *   SPAWNING → READY → (inject prompt) → WORKING → IDLE →
 *   EXTRACTING → (send /cost, /exit) → EXITING → DONE | FAILED
 *
 * Resolves with an `ExecuteResult` containing the captured output, exit code,
 * token usage, and duration.
 */
export function executePtySession(options: ExecutePtySessionOptions): Promise<ExecuteResult> {
  const {
    handle,
    prompt,
    worktreePath,
    timeout = 300_000,
    quiescenceMs = 3000,
    onOutput,
  } = options;

  const startTime = Date.now();
  const session = new PtySessionState(quiescenceMs);
  let fullOutput = '';
  let costOutput = '';
  let exited = false;
  let exitCode = 0;

  return new Promise<ExecuteResult>((resolve) => {
    // Timeout guard
    const timer = setTimeout(() => {
      if (exited) return;
      exited = true;
      session.destroy();
      handle.kill();
      resolve({
        output: fullOutput + '\n[timeout] PTY killed after ' + Math.round(timeout / 1000) + 's',
        exitCode: 124,
        tokensUsed: 0,
        inputTokens: 0,
        outputTokens: 0,
        duration: Date.now() - startTime,
      });
    }, timeout);

    // Wire up PTY data → state machine
    handle.onData((data: string) => {
      fullOutput += data;
      if (onOutput) onOutput(data);
      session.onData(data);

      // In EXTRACTING state, accumulate cost output
      if (session.state === 'EXTRACTING') {
        costOutput += data;
      }
    });

    // Wire up PTY exit
    handle.onExit((code: number, _signal?: number) => {
      if (exited) return;
      exited = true;
      clearTimeout(timer);

      exitCode = code;
      session.transition(exitCode === 0 ? 'DONE' : 'FAILED');
      session.destroy();

      // Read result file and parse cost
      void (async () => {
        const stageResult = await readStageResultFile(worktreePath);
        const cost = parseCostOutput(costOutput);

        const tokensUsed = cost.inputTokens + cost.outputTokens;
        resolve({
          output: fullOutput,
          exitCode,
          tokensUsed,
          inputTokens: cost.inputTokens,
          outputTokens: cost.outputTokens,
          duration: Date.now() - startTime,
          ...(stageResult ? { stageResult } : {}),
        } as ExecuteResult);
      })();
    });

    // State change handler — drives the lifecycle
    session.setOnStateChange((_from: SessionState, to: SessionState) => {
      if (exited) return;

      if (to === 'READY') {
        // Inject the prompt
        session.clearBuffer();
        handle.write(prompt + '\n');
        session.transition('WORKING');
      }

      if (to === 'IDLE') {
        // Start extraction: send /cost, wait, then /exit
        session.transition('EXTRACTING');
        handle.write('/cost\n');

        setTimeout(() => {
          if (exited) return;
          session.transition('EXITING');
          handle.write('/exit\n');
        }, 2000);
      }
    });
  });
}
