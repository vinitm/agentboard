import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock node:child_process before importing the module under test
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../claude-bin.js', () => ({
  claudeBin: () => 'claude',
}));

import { executeClaudeCode } from './executor.js';
import { spawn } from 'node:child_process';

const mockSpawn = vi.mocked(spawn);

/**
 * Create a mock child process that behaves like what `spawn` returns.
 */
function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();

  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeClaudeCode', () => {
  it('captures stdout and returns success on exit code 0', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/worktree',
      model: 'claude-3-5-sonnet-20241022',
    });

    setTimeout(() => {
      child.stdout.emit('data', Buffer.from('some output text'));
      child.emit('close', 0);
    }, 0);

    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('some output text');
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  it('captures stderr alongside stdout with [stderr] prefix', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/worktree',
      model: 'claude-3-5-sonnet-20241022',
    });

    setTimeout(() => {
      child.stdout.emit('data', Buffer.from('stdout content'));
      child.stderr.emit('data', Buffer.from('stderr content'));
      child.emit('close', 0);
    }, 0);

    const result = await promise;

    expect(result.output).toContain('stdout content');
    expect(result.output).toContain('[stderr]');
    expect(result.output).toContain('stderr content');
  });

  it('parses structured JSON output with token usage', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/worktree',
      model: 'claude-3-5-sonnet-20241022',
    });

    const jsonOutput = JSON.stringify({
      result: 'The implementation is complete.',
      usage: { input_tokens: 1200, output_tokens: 300 },
    });

    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(jsonOutput));
      child.emit('close', 0);
    }, 0);

    const result = await promise;

    expect(result.inputTokens).toBe(1200);
    expect(result.outputTokens).toBe(300);
    expect(result.tokensUsed).toBe(1500);
    expect(result.output).toContain('The implementation is complete.');
  });

  it('parses top-level token fields from JSON output', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/worktree',
      model: 'sonnet',
    });

    const jsonOutput = JSON.stringify({
      result: 'Done!',
      input_tokens: 500,
      output_tokens: 150,
    });

    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(jsonOutput));
      child.emit('close', 0);
    }, 0);

    const result = await promise;

    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(150);
    expect(result.tokensUsed).toBe(650);
  });

  it('falls back to text parsing when JSON parse fails', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/worktree',
      model: 'claude-3-5-sonnet-20241022',
    });

    setTimeout(() => {
      child.stdout.emit('data', Buffer.from('Done!\nTokens used: 1500\n'));
      child.emit('close', 0);
    }, 0);

    const result = await promise;

    expect(result.tokensUsed).toBe(1500);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('estimates tokens when no usage pattern is found (~output.length/4)', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/worktree',
      model: 'claude-3-5-sonnet-20241022',
    });

    const outputText = 'a'.repeat(400);
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(outputText));
      child.emit('close', 0);
    }, 0);

    const result = await promise;

    // 400 chars / 4 = 100 tokens
    expect(result.tokensUsed).toBe(100);
  });

  it('handles non-zero exit codes', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/worktree',
      model: 'claude-3-5-sonnet-20241022',
    });

    setTimeout(() => {
      child.stdout.emit('data', Buffer.from('something went wrong'));
      child.emit('close', 2);
    }, 0);

    const result = await promise;

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('something went wrong');
  });

  it('handles spawn error (ENOENT) — resolves with error message and exitCode 1', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/worktree',
      model: 'claude-3-5-sonnet-20241022',
    });

    const spawnError = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });

    setTimeout(() => {
      child.emit('error', spawnError);
    }, 0);

    const result = await promise;

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Failed to spawn claude process');
    expect(result.output).toContain('ENOENT');
    expect(result.tokensUsed).toBe(0);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('calls onOutput callback with each chunk of stdout', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const chunks: string[] = [];
    const onOutput = vi.fn((chunk: string) => {
      chunks.push(chunk);
    });

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/worktree',
      model: 'claude-3-5-sonnet-20241022',
      onOutput,
    });

    setTimeout(() => {
      child.stdout.emit('data', Buffer.from('chunk1'));
      child.stdout.emit('data', Buffer.from('chunk2'));
      child.emit('close', 0);
    }, 0);

    await promise;

    expect(onOutput).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual(['chunk1', 'chunk2']);
  });

  it('writes the prompt to stdin and closes it', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'my prompt text',
      worktreePath: '/tmp/worktree',
      model: 'claude-3-5-sonnet-20241022',
    });

    setTimeout(() => {
      child.emit('close', 0);
    }, 0);

    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith('my prompt text');
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('spawns claude with --output-format json and correct args', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/my-worktree',
      model: 'claude-opus-4-5',
    });

    setTimeout(() => {
      child.emit('close', 0);
    }, 0);

    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['--print', '--output-format', 'json', '--model', 'claude-opus-4-5', '--permission-mode', 'acceptEdits'],
      expect.objectContaining({ cwd: '/tmp/my-worktree' })
    );
  });

  it('includes both --permission-mode and --tools when tools are provided', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/my-worktree',
      model: 'claude-opus-4-5',
      tools: ['Read', 'Glob', 'Grep'],
    });

    setTimeout(() => {
      child.emit('close', 0);
    }, 0);

    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['--print', '--output-format', 'json', '--model', 'claude-opus-4-5', '--permission-mode', 'acceptEdits', '--tools', 'Read,Glob,Grep'],
      expect.objectContaining({ cwd: '/tmp/my-worktree' })
    );
  });

  it('omits --tools when tools array is empty', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/my-worktree',
      model: 'claude-opus-4-5',
      tools: [],
    });

    setTimeout(() => {
      child.emit('close', 0);
    }, 0);

    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['--print', '--output-format', 'json', '--model', 'claude-opus-4-5', '--permission-mode', 'acceptEdits'],
      expect.objectContaining({ cwd: '/tmp/my-worktree' })
    );
  });

  it('uses custom permissionMode when provided', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/my-worktree',
      model: 'claude-opus-4-5',
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      permissionMode: 'bypassPermissions',
    });

    setTimeout(() => {
      child.emit('close', 0);
    }, 0);

    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['--print', '--output-format', 'json', '--model', 'claude-opus-4-5', '--permission-mode', 'bypassPermissions', '--tools', 'Read,Write,Edit,Bash,Glob,Grep'],
      expect.objectContaining({ cwd: '/tmp/my-worktree' })
    );
  });

  it('returns inputTokens and outputTokens as 0 for non-JSON output', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = executeClaudeCode({
      prompt: 'hello',
      worktreePath: '/tmp/worktree',
      model: 'sonnet',
    });

    setTimeout(() => {
      child.stdout.emit('data', Buffer.from('plain text output'));
      child.emit('close', 0);
    }, 0);

    const result = await promise;

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.tokensUsed).toBeGreaterThan(0); // fallback estimate
  });
});
