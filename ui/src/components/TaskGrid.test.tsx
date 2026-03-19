import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskGrid } from './TaskGrid';
import type { Task } from '../types';

const makeTasks = (overrides: Partial<Task>[]): Task[] =>
  overrides.map((o, i) => ({
    id: i + 1,
    projectId: 'p1',
    title: `Task ${i + 1}`,
    description: '',
    status: 'backlog' as const,
    riskLevel: 'low' as const,
    priority: 0,
    spec: null,
    blockedReason: null,
    blockedAtStage: null,
    claimedAt: null,
    claimedBy: null,
    chatSessionId: null,
    createdAt: '2026-03-19T10:00:00Z',
    updatedAt: '2026-03-19T10:00:00Z',
    ...o,
  }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe('TaskGrid', () => {
  it('groups tasks by status phase', () => {
    const tasks = makeTasks([
      { status: 'blocked' },
      { status: 'implementing' },
      { status: 'backlog' },
      { status: 'done' },
    ]);
    render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    expect(screen.getByText('Needs Attention')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Queued')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('hides empty groups', () => {
    const tasks = makeTasks([{ status: 'backlog' }]);
    render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    expect(screen.queryByText('Needs Attention')).toBeNull();
    expect(screen.queryByText('Running')).toBeNull();
    expect(screen.getByText('Queued')).toBeTruthy();
  });

  it('shows loading skeleton', () => {
    const { container } = render(
      <TaskGrid tasks={[]} loading={true} />, { wrapper }
    );
    expect(container.querySelector('.skeleton')).toBeTruthy();
  });

  it('shows empty state when no tasks', () => {
    render(<TaskGrid tasks={[]} loading={false} />, { wrapper });
    expect(screen.getByText(/no tasks/i)).toBeTruthy();
  });

  it('sorts by priority descending within group', () => {
    const tasks = makeTasks([
      { title: 'Low', status: 'backlog', priority: 0 },
      { title: 'High', status: 'backlog', priority: 2 },
      { title: 'Med', status: 'backlog', priority: 1 },
    ]);
    const { container } = render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    const cards = container.querySelectorAll('[role="button"]');
    expect(cards[0]?.textContent).toContain('High');
  });

  // Completed group collapsed by default
  it('Completed group header is visible but card text is not in DOM by default', () => {
    const tasks = makeTasks([{ status: 'done', title: 'Done Task' }]);
    render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    // Header should be visible
    expect(screen.getByText('Completed')).toBeTruthy();
    // Card title should NOT be in DOM while collapsed
    expect(screen.queryByText('Done Task')).toBeNull();
  });

  // Click Completed header expands
  it('clicking Completed header makes card visible', () => {
    const tasks = makeTasks([{ status: 'done', title: 'Done Task' }]);
    render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    fireEvent.click(screen.getByText('Completed'));
    expect(screen.getByText('Done Task')).toBeTruthy();
  });

  // Attention group header accent class
  it('Needs Attention group header has text-accent-amber class', () => {
    const tasks = makeTasks([{ status: 'blocked' }]);
    const { container } = render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    const header = container.querySelector('h2.text-accent-amber');
    expect(header).toBeTruthy();
    expect(header?.textContent).toBe('Needs Attention');
  });

  // Running group header accent class
  it('Running group header has text-accent-purple class', () => {
    const tasks = makeTasks([{ status: 'implementing' }]);
    const { container } = render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    const header = container.querySelector('h2.text-accent-purple');
    expect(header).toBeTruthy();
    expect(header?.textContent).toBe('Running');
  });

  // Count badge
  it('count badge shows correct number of tasks in group', () => {
    const tasks = makeTasks([
      { status: 'backlog' },
      { status: 'backlog' },
      { status: 'backlog' },
    ]);
    render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    expect(screen.getByText('3')).toBeTruthy();
  });

  // All 4 attention statuses map to Needs Attention
  it('all 4 attention statuses map to Needs Attention group', () => {
    const tasks = makeTasks([
      { status: 'blocked' },
      { status: 'failed' },
      { status: 'needs_plan_review' },
      { status: 'needs_human_review' },
    ]);
    render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    // Only one "Needs Attention" header should exist
    const headers = screen.getAllByText('Needs Attention');
    expect(headers).toHaveLength(1);
    // Count badge should show 4
    expect(screen.getByText('4')).toBeTruthy();
  });

  // Secondary sort by updatedAt when priority equal
  it('secondary sort by updatedAt (most recent first) when priority is equal', () => {
    const tasks = makeTasks([
      { title: 'Older', status: 'backlog', priority: 1, updatedAt: '2026-03-10T10:00:00Z' },
      { title: 'Newer', status: 'backlog', priority: 1, updatedAt: '2026-03-18T10:00:00Z' },
    ]);
    const { container } = render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    const cards = container.querySelectorAll('[role="button"]');
    expect(cards[0]?.textContent).toContain('Newer');
    expect(cards[1]?.textContent).toContain('Older');
  });

  // Single task shows correct group and count
  it('single task shows in correct group with count 1', () => {
    const tasks = makeTasks([{ status: 'implementing' }]);
    render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  // Cancelled maps to Completed group
  it('cancelled task maps to Completed group (visible after expand)', () => {
    const tasks = makeTasks([{ status: 'cancelled', title: 'Cancelled Task' }]);
    render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    // Initially collapsed
    expect(screen.queryByText('Cancelled Task')).toBeNull();
    // Expand by clicking header
    fireEvent.click(screen.getByText('Completed'));
    expect(screen.getByText('Cancelled Task')).toBeTruthy();
  });

  // Queued group has no special accent class
  it('Queued group header has no accent class (uses text-text-primary)', () => {
    const tasks = makeTasks([{ status: 'backlog' }]);
    const { container } = render(<TaskGrid tasks={tasks} loading={false} />, { wrapper });
    // Should not have amber or purple accent
    expect(container.querySelector('h2.text-accent-amber')).toBeNull();
    expect(container.querySelector('h2.text-accent-purple')).toBeNull();
    // The Queued header exists as text-text-primary (default class applied when no accentClass)
    const queuedHeader = screen.getByText('Queued');
    expect(queuedHeader.className).toContain('text-text-primary');
  });
});
