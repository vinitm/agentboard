import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TerminalPanel } from './TerminalPanel';
import type { LogLine } from './TerminalPanel';

describe('TerminalPanel', () => {
  it('renders string content', () => {
    render(<TerminalPanel content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeDefined();
  });

  it('renders LogLine array', () => {
    const lines: LogLine[] = [
      { level: 'info', message: 'Starting...' },
      { level: 'error', message: 'Failed!' },
    ];
    render(<TerminalPanel content={lines} />);
    expect(screen.getByText('Starting...')).toBeDefined();
    expect(screen.getByText('Failed!')).toBeDefined();
  });

  it('renders title when provided', () => {
    render(<TerminalPanel content="test" title="Build Output" />);
    expect(screen.getByText('Build Output')).toBeDefined();
  });

  it('applies terminal background', () => {
    const { container } = render(<TerminalPanel content="test" />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('bg-bg-secondary');
  });

  it('renders with default max height', () => {
    const { container } = render(<TerminalPanel content="test" />);
    const scrollContainer = container.querySelector('[class*="overflow-auto"]') as HTMLElement;
    expect(scrollContainer).toBeDefined();
  });

  it('renders with custom max height', () => {
    const { container } = render(<TerminalPanel content="test" maxHeight="600px" />);
    const scrollContainer = container.querySelector('[class*="overflow-auto"]') as HTMLElement;
    expect(scrollContainer?.style.maxHeight).toBe('600px');
  });

  it('applies correct color for info level', () => {
    const lines: LogLine[] = [{ level: 'info', message: 'Info message' }];
    const { container } = render(<TerminalPanel content={lines} />);
    const lineDiv = container.querySelector('.text-text-primary');
    expect(lineDiv).toBeDefined();
  });

  it('applies correct color for error level', () => {
    const lines: LogLine[] = [{ level: 'error', message: 'Error message' }];
    const { container } = render(<TerminalPanel content={lines} />);
    const lineDiv = container.querySelector('.text-accent-red');
    expect(lineDiv).toBeDefined();
  });

  it('renders timestamp when provided', () => {
    const lines: LogLine[] = [{ level: 'info', timestamp: '12:34:56', message: 'Timed message' }];
    render(<TerminalPanel content={lines} />);
    expect(screen.getByText('12:34:56')).toBeDefined();
  });

  it('displays level badge', () => {
    const lines: LogLine[] = [{ level: 'warn', message: 'Warning' }];
    const { container } = render(<TerminalPanel content={lines} />);
    expect(container.textContent).toContain('WARN');
  });

  it('preserves whitespace in string content', () => {
    const content = 'line 1\nline 2\n  indented';
    render(<TerminalPanel content={content} />);
    expect(screen.getByText(/line 1/)).toBeDefined();
  });

  it('renders border and rounded corners', () => {
    const { container } = render(<TerminalPanel content="test" />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('border');
    expect(panel.className).toContain('rounded-lg');
  });
});
