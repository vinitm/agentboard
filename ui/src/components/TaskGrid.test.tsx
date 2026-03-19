import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
