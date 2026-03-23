import { describe, it, expect } from 'vitest';
import { parseLogLine, parseLogText, groupIntoBlocks } from './parse-log-lines.js';

describe('parseLogLine', () => {
  it('parses separator lines', () => {
    const result = parseLogLine('════════════════════════════════════════════════════════════════════════════════');
    expect(result.type).toBe('separator');
  });

  it('parses stage headers', () => {
    const result = parseLogLine('── STAGE: planning (run: abc123, attempt: 1) ────────────────────────────────────');
    expect(result.type).toBe('stage');
    expect(result.content).toContain('planning');
    expect(result.metadata.run).toBe('abc123');
    expect(result.metadata.attempt).toBe('1');
  });

  it('parses subtask headers', () => {
    const result = parseLogLine('── SUBTASK 1/3: Add user authentication (42) ──────────────────────────');
    expect(result.type).toBe('subtask');
    expect(result.content).toBe('1/3: Add user authentication (42)');
    expect(result.metadata.index).toBe('1/3');
  });

  it('parses event headers', () => {
    const result = parseLogLine('── EVENT: subtasks_created ──────────────────────────────────────────────');
    expect(result.type).toBe('event');
    expect(result.content).toBe('subtasks_created');
  });

  it('parses task headers', () => {
    const result = parseLogLine('TASK: Add login page');
    expect(result.type).toBe('header');
    expect(result.content).toBe('Add login page');
  });

  it('parses [start] lines with metadata', () => {
    const result = parseLogLine('[2026-03-18T10:30:00.000Z] [start] model=claude-opus-4-6');
    expect(result.type).toBe('start');
    expect(result.timestamp).toBe('2026-03-18T10:30:00.000Z');
    expect(result.metadata.model).toBe('claude-opus-4-6');
  });

  it('parses [end] lines with metadata', () => {
    const result = parseLogLine('[2026-03-18T10:30:05.000Z] [end] status=completed tokens=1234 duration=5000ms');
    expect(result.type).toBe('end');
    expect(result.metadata.status).toBe('completed');
    expect(result.metadata.tokens).toBe('1234');
    expect(result.metadata.duration).toBe('5000ms');
  });

  it('parses [ERROR] lines', () => {
    const result = parseLogLine('[2026-03-18T10:30:05.000Z] [ERROR] Command failed with exit code 1');
    expect(result.type).toBe('error');
    expect(result.content).toBe('Command failed with exit code 1');
  });

  it('parses regular timestamped content', () => {
    const result = parseLogLine('[2026-03-18T10:30:00.000Z] Writing file src/index.ts...');
    expect(result.type).toBe('timestamp');
    expect(result.content).toBe('Writing file src/index.ts...');
  });

  it('parses plain content', () => {
    const result = parseLogLine('This is just some output text');
    expect(result.type).toBe('content');
    expect(result.content).toBe('This is just some output text');
  });

  it('handles indented stage headers from subtask loggers', () => {
    const result = parseLogLine('  ── STAGE: checks (run: xyz, attempt: 1) ──────────────────────────────────');
    expect(result.type).toBe('stage');
  });
});

describe('parseLogText', () => {
  it('parses multi-line log text', () => {
    const text = [
      '════════════════════════════════════════════════════════════════════════════════',
      'TASK: Add login page',
      'ID: 42 | Risk: medium | Started: 2026-03-18T10:30:00.000Z',
      '════════════════════════════════════════════════════════════════════════════════',
      '',
      '── STAGE: planning (run: abc, attempt: 1) ────────────────',
      '[2026-03-18T10:30:00.000Z] [start] model=claude-opus-4-6',
      '[2026-03-18T10:30:01.000Z] Creating implementation plan...',
      '[2026-03-18T10:30:05.000Z] [end] status=completed tokens=500 duration=5000ms',
    ].join('\n');

    const lines = parseLogText(text);
    expect(lines).toHaveLength(9);
    expect(lines[0].type).toBe('separator');
    expect(lines[1].type).toBe('header');
    expect(lines[5].type).toBe('stage');
    expect(lines[6].type).toBe('start');
    expect(lines[7].type).toBe('timestamp');
    expect(lines[8].type).toBe('end');
  });

  it('returns empty array for empty input', () => {
    expect(parseLogText('')).toHaveLength(0);
  });
});

describe('groupIntoBlocks', () => {
  it('groups consecutive content lines into a markdown block', () => {
    const lines = parseLogText('## Heading\n- item 1\n- item 2');
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('markdown');
    if (blocks[0].kind === 'markdown') {
      expect(blocks[0].text).toContain('## Heading');
      expect(blocks[0].text).toContain('- item 1');
    }
  });

  it('groups consecutive timestamp lines into a markdown block with first timestamp', () => {
    const lines = parseLogText(
      '[2026-03-18T10:30:00.000Z] ## Analysis\n[2026-03-18T10:30:01.000Z] The code looks good\n[2026-03-18T10:30:02.000Z] - No issues found'
    );
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(1);
    if (blocks[0].kind === 'markdown') {
      expect(blocks[0].timestamp).toBe('2026-03-18T10:30:00.000Z');
      expect(blocks[0].text).toContain('## Analysis');
    }
  });

  it('preserves structural lines as individual blocks', () => {
    const text = [
      '── STAGE: planning (run: abc, attempt: 1) ──────',
      '[2026-03-18T10:30:00.000Z] [start] model=opus',
      '## My Plan',
      '- Step 1',
      '[2026-03-18T10:31:00.000Z] [end] status=completed',
    ].join('\n');
    const lines = parseLogText(text);
    const blocks = groupIntoBlocks(lines);

    expect(blocks[0]).toEqual(expect.objectContaining({ kind: 'line' }));
    if (blocks[0].kind === 'line') expect(blocks[0].line.type).toBe('stage');

    expect(blocks[1]).toEqual(expect.objectContaining({ kind: 'line' }));
    if (blocks[1].kind === 'line') expect(blocks[1].line.type).toBe('start');

    expect(blocks[2]).toEqual(expect.objectContaining({ kind: 'markdown' }));

    expect(blocks[3]).toEqual(expect.objectContaining({ kind: 'line' }));
    if (blocks[3].kind === 'line') expect(blocks[3].line.type).toBe('end');
  });

  it('skips empty content blocks', () => {
    const lines = parseLogText('\n\n');
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(0);
  });

  it('handles mixed content and timestamp lines in one block', () => {
    const lines = parseLogText(
      '[2026-03-18T10:30:00.000Z] First line\nplain continuation\n[2026-03-18T10:30:01.000Z] Third line'
    );
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(1);
    if (blocks[0].kind === 'markdown') {
      expect(blocks[0].text).toContain('First line');
      expect(blocks[0].text).toContain('plain continuation');
      expect(blocks[0].text).toContain('Third line');
    }
  });

  it('preserves indented code in plain content lines for markdown code blocks', () => {
    const lines = parseLogText(
      '[2026-03-18T10:30:00.000Z] Here is some code:\n    const x = 1;\n    const y = 2;'
    );
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(1);
    if (blocks[0].kind === 'markdown') {
      expect(blocks[0].text).toContain('    const x = 1;');
      expect(blocks[0].text).toContain('    const y = 2;');
    }
  });
});
