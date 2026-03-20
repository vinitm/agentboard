import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  stripAnsi,
  detectPrompt,
  PtySessionState,
  readStageResultFile,
  cleanStageResultFile,
  parseCostOutput,
  executePtySession,
} from './pty-executor.js';
import type { PtyHandle } from './pty-manager.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// stripAnsi
// ---------------------------------------------------------------------------

describe('stripAnsi', () => {
  it('passes through plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('removes CSI color codes', () => {
    expect(stripAnsi('\u001b[32mgreen\u001b[0m')).toBe('green');
  });

  it('removes CSI cursor movement sequences', () => {
    expect(stripAnsi('\u001b[2Jhello\u001b[H')).toBe('hello');
  });

  it('removes multiple ANSI sequences in one string', () => {
    const input = '\u001b[1m\u001b[36mbold cyan\u001b[0m normal';
    expect(stripAnsi(input)).toBe('bold cyan normal');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// detectPrompt
// ---------------------------------------------------------------------------

describe('detectPrompt', () => {
  it('detects bare ">"', () => {
    expect(detectPrompt('some output\n>')).toBe(true);
  });

  it('detects "> " (with trailing space)', () => {
    expect(detectPrompt('some output\n> ')).toBe(true);
  });

  it('detects ">" with leading whitespace', () => {
    expect(detectPrompt('output\n  > ')).toBe(true);
  });

  it('rejects markdown blockquotes ("> some text")', () => {
    expect(detectPrompt('output\n> some quoted text')).toBe(false);
  });

  it('rejects ">" inside a fenced code block', () => {
    const text = '```\nsome code\n>\n```';
    // The > is inside the code block (between opening and closing ```)
    expect(detectPrompt(text)).toBe(false);
  });

  it('accepts ">" after a closed code block', () => {
    const text = '```\ncode\n```\n>';
    expect(detectPrompt(text)).toBe(true);
  });

  it('detects prompt with ANSI wrapping', () => {
    const text = 'output\n\u001b[32m>\u001b[0m ';
    expect(detectPrompt(text)).toBe(true);
  });

  it('rejects when last non-empty line is not a prompt', () => {
    expect(detectPrompt('hello world\n')).toBe(false);
  });

  it('handles empty input', () => {
    expect(detectPrompt('')).toBe(false);
  });

  it('rejects "> " followed by text (blockquote)', () => {
    expect(detectPrompt('> hello there')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PtySessionState
// ---------------------------------------------------------------------------

describe('PtySessionState', () => {
  it('starts in SPAWNING state', () => {
    const session = new PtySessionState();
    expect(session.state).toBe('SPAWNING');
    session.destroy();
  });

  it('transitions to READY on prompt detection after quiescence', () => {
    const session = new PtySessionState(100);
    const changes: string[] = [];
    session.setOnStateChange((_from, to) => changes.push(to));

    session.onData('Welcome to Claude\n> ');

    // Before quiescence elapses
    expect(session.state).toBe('SPAWNING');

    // After quiescence
    vi.advanceTimersByTime(100);
    expect(session.state).toBe('READY');
    expect(changes).toContain('READY');

    session.destroy();
  });

  it('resets quiescence timer on new data', () => {
    const session = new PtySessionState(200);

    session.onData('Welcome\n> ');
    vi.advanceTimersByTime(150); // not yet
    expect(session.state).toBe('SPAWNING');

    // New data resets the timer
    session.onData('\nmore output\n> ');
    vi.advanceTimersByTime(150); // still not enough from the reset
    expect(session.state).toBe('SPAWNING');

    vi.advanceTimersByTime(50); // now 200ms from last data
    expect(session.state).toBe('READY');

    session.destroy();
  });

  it('transitions WORKING → IDLE on prompt after quiescence', () => {
    const session = new PtySessionState(100);

    // Fast-track to WORKING
    session.transition('READY');
    session.transition('WORKING');
    session.clearBuffer();

    session.onData('Done implementing\n> ');
    vi.advanceTimersByTime(100);
    expect(session.state).toBe('IDLE');

    session.destroy();
  });

  it('clearBuffer resets the buffer', () => {
    const session = new PtySessionState();
    session.onData('some data');
    expect(session.buffer).toBe('some data');
    session.clearBuffer();
    expect(session.buffer).toBe('');
    session.destroy();
  });

  it('destroy prevents further transitions', () => {
    const session = new PtySessionState(50);
    session.destroy();
    session.onData('> ');
    vi.advanceTimersByTime(100);
    expect(session.state).toBe('SPAWNING'); // unchanged
  });

  it('logs state transitions', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const session = new PtySessionState();
    session.transition('READY');
    expect(logSpy).toHaveBeenCalledWith('[pty-session] SPAWNING -> READY');
    logSpy.mockRestore();
    session.destroy();
  });
});

// ---------------------------------------------------------------------------
// readStageResultFile / cleanStageResultFile
// ---------------------------------------------------------------------------

describe('readStageResultFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.useRealTimers();
    tmpDir = await mkdtemp(join(tmpdir(), 'pty-exec-test-'));
  });

  afterEach(async () => {
    vi.useFakeTimers();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null when file does not exist', async () => {
    const result = await readStageResultFile(tmpDir);
    expect(result).toBeNull();
  });

  it('parses valid JSON stage result', async () => {
    const dir = join(tmpDir, '.agentboard');
    await mkdir(dir, { recursive: true });
    const data = { status: 'approved', summary: 'All good' };
    await writeFile(join(dir, 'stage-result.json'), JSON.stringify(data));

    const result = await readStageResultFile(tmpDir);
    expect(result).toEqual(data);
  });

  it('returns null for invalid JSON', async () => {
    const dir = join(tmpDir, '.agentboard');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'stage-result.json'), 'not json{{{');

    const result = await readStageResultFile(tmpDir);
    expect(result).toBeNull();
  });
});

describe('cleanStageResultFile', () => {
  it('does not throw when file does not exist', async () => {
    vi.useRealTimers();
    const tmpDir = await mkdtemp(join(tmpdir(), 'pty-clean-test-'));
    await expect(cleanStageResultFile(tmpDir)).resolves.toBeUndefined();
    await rm(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// parseCostOutput
// ---------------------------------------------------------------------------

describe('parseCostOutput', () => {
  it('extracts token numbers from /cost output', () => {
    const raw = `
Session cost:
  Input tokens: 12,345
  Output tokens: 6,789
  Total cost: $0.42
`;
    const result = parseCostOutput(raw);
    expect(result.inputTokens).toBe(12345);
    expect(result.outputTokens).toBe(6789);
  });

  it('handles output without commas', () => {
    const raw = 'Input tokens: 500\nOutput tokens: 200';
    const result = parseCostOutput(raw);
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(200);
  });

  it('returns zeros when no token info found', () => {
    const result = parseCostOutput('no relevant data here');
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('handles partial matches (only input)', () => {
    const result = parseCostOutput('Input tokens: 1000');
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// executePtySession
// ---------------------------------------------------------------------------

describe('executePtySession', () => {
  function createMockHandle(): PtyHandle & {
    _dataHandlers: Array<(data: string) => void>;
    _exitHandlers: Array<(exitCode: number, signal?: number) => void>;
    _written: string[];
    simulateData: (data: string) => void;
    simulateExit: (code: number) => void;
  } {
    const _dataHandlers: Array<(data: string) => void> = [];
    const _exitHandlers: Array<(exitCode: number, signal?: number) => void> = [];
    const _written: string[] = [];

    return {
      pty: {} as never,
      pid: 12345,
      stageLogId: 1,
      createdAt: new Date(),
      _dataHandlers,
      _exitHandlers,
      _written,
      write(data: string) {
        _written.push(data);
      },
      onData(cb: (data: string) => void) {
        _dataHandlers.push(cb);
      },
      onExit(cb: (exitCode: number, signal?: number) => void) {
        _exitHandlers.push(cb);
      },
      kill: vi.fn(),
      resize: vi.fn(),
      simulateData(data: string) {
        for (const cb of _dataHandlers) cb(data);
      },
      simulateExit(code: number) {
        for (const cb of _exitHandlers) cb(code);
      },
    };
  }

  it('times out and kills PTY with exit code 124', async () => {
    const handle = createMockHandle();
    const promise = executePtySession({
      handle,
      prompt: 'do stuff',
      worktreePath: '/tmp/fake',
      timeout: 5000,
      quiescenceMs: 100,
    });

    // Advance past timeout
    vi.advanceTimersByTime(5000);

    const result = await promise;
    expect(result.exitCode).toBe(124);
    expect(result.output).toContain('[timeout]');
    expect(handle.kill).toHaveBeenCalled();
  });

  it('injects prompt on READY and transitions to WORKING', async () => {
    const handle = createMockHandle();
    const promise = executePtySession({
      handle,
      prompt: 'implement the feature',
      worktreePath: '/tmp/fake',
      timeout: 30000,
      quiescenceMs: 100,
    });

    // Simulate the initial prompt appearing
    handle.simulateData('Welcome to Claude Code\n> ');
    vi.advanceTimersByTime(2000); // quiescence for SPAWNING→READY

    // The prompt should have been written
    expect(handle._written).toContain('implement the feature\n');

    // Now simulate work completing with a prompt
    handle.simulateData('Done!\n> ');
    vi.advanceTimersByTime(100); // quiescence for WORKING→IDLE

    // After IDLE, it should send /cost
    expect(handle._written).toContain('/cost\n');

    // Wait for the /exit delay
    vi.advanceTimersByTime(2000);
    expect(handle._written).toContain('/exit\n');

    // Simulate process exit
    handle.simulateExit(0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
  });

  it('calls onOutput with each data chunk', async () => {
    const handle = createMockHandle();
    const chunks: string[] = [];

    const promise = executePtySession({
      handle,
      prompt: 'test',
      worktreePath: '/tmp/fake',
      timeout: 10000,
      quiescenceMs: 50,
      onOutput: (chunk) => chunks.push(chunk),
    });

    handle.simulateData('chunk1');
    handle.simulateData('chunk2');
    handle.simulateExit(0);

    const _result = await promise;
    expect(chunks).toEqual(['chunk1', 'chunk2']);
  });
});
