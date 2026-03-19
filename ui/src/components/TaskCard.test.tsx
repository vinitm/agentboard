import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskCard } from './TaskCard';
import type { Task } from '../types';

const baseTask: Task = {
  id: 42,
  projectId: 'p1',
  title: 'Refactor auth middleware',
  description: 'Extract JWT validation into shared module',
  status: 'implementing',
  riskLevel: 'high',
  priority: 1,
  spec: null,
  blockedReason: null,
  blockedAtStage: null,
  claimedAt: null,
  claimedBy: null,
  chatSessionId: null,
  createdAt: '2026-03-19T10:00:00Z',
  updatedAt: '2026-03-19T10:02:00Z',
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe('TaskCard', () => {
  it('renders task ID and title', () => {
    render(<TaskCard task={baseTask} />, { wrapper });
    expect(screen.getByText('#42')).toBeTruthy();
    expect(screen.getByText('Refactor auth middleware')).toBeTruthy();
  });

  it('renders description', () => {
    render(<TaskCard task={baseTask} />, { wrapper });
    expect(screen.getByText('Extract JWT validation into shared module')).toBeTruthy();
  });

  it('shows priority badge when > 0', () => {
    render(<TaskCard task={baseTask} />, { wrapper });
    expect(screen.getByText('P1')).toBeTruthy();
  });

  it('hides priority badge when 0', () => {
    render(<TaskCard task={{ ...baseTask, priority: 0 }} />, { wrapper });
    expect(screen.queryByText('P0')).toBeNull();
  });

  it('shows running spinner when claimed', () => {
    render(<TaskCard task={{ ...baseTask, claimedBy: 'worker-1' }} />, { wrapper });
    expect(screen.getByLabelText('Running')).toBeTruthy();
  });

  it('renders pipeline bar for pipeline statuses', () => {
    const { container } = render(<TaskCard task={baseTask} />, { wrapper });
    expect(container.querySelector('[data-segment]')).toBeTruthy();
  });

  it('does not render pipeline bar for backlog', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'backlog' }} />, { wrapper }
    );
    expect(container.querySelector('[data-segment]')).toBeNull();
  });
});
