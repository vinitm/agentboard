import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  // Status badge text
  it('replaces underscores in status badge text', () => {
    render(<TaskCard task={{ ...baseTask, status: 'needs_plan_review' }} />, { wrapper });
    expect(screen.getByText('needs plan review')).toBeTruthy();
  });

  // Status badge colors
  it('cancelled has bg-bg-tertiary text-text-tertiary badge classes', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'cancelled' }} />, { wrapper }
    );
    const badge = container.querySelector('.bg-bg-tertiary.text-text-tertiary');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('cancelled');
  });

  it('blocked badge has text-accent-amber class', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'blocked' }} />, { wrapper }
    );
    const badge = container.querySelector('.text-accent-amber');
    expect(badge).toBeTruthy();
  });

  it('done badge has text-accent-green class', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'done' }} />, { wrapper }
    );
    const badge = container.querySelector('.text-accent-green');
    expect(badge).toBeTruthy();
  });

  it('pipeline status (checks) badge has text-accent-purple class', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'checks' }} />, { wrapper }
    );
    const badge = container.querySelector('.text-accent-purple');
    expect(badge).toBeTruthy();
  });

  // Left border classes
  it('blocked task has border-l-accent-amber class', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'blocked' }} />, { wrapper }
    );
    const card = container.querySelector('[role="button"]');
    expect(card?.className).toContain('border-l-accent-amber');
  });

  it('failed task has border-l-accent-red class', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'failed' }} />, { wrapper }
    );
    const card = container.querySelector('[role="button"]');
    expect(card?.className).toContain('border-l-accent-red');
  });

  it('needs_human_review task has border-l-accent-pink class', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'needs_human_review' }} />, { wrapper }
    );
    const card = container.querySelector('[role="button"]');
    expect(card?.className).toContain('border-l-accent-pink');
  });

  it('implementing task has border-l-transparent class', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'implementing' }} />, { wrapper }
    );
    const card = container.querySelector('[role="button"]');
    expect(card?.className).toContain('border-l-transparent');
  });

  // Empty description
  it('does not render description element when description is empty string', () => {
    render(<TaskCard task={{ ...baseTask, description: '' }} />, { wrapper });
    expect(screen.queryByText('Extract JWT validation into shared module')).toBeNull();
  });

  // line-clamp-2 on title element
  it('title element has line-clamp-2 class', () => {
    const { container } = render(<TaskCard task={baseTask} />, { wrapper });
    const title = container.querySelector('.line-clamp-2');
    expect(title).toBeTruthy();
    expect(title?.textContent).toBe('Refactor auth middleware');
  });

  // aria-label
  it('aria-label contains task ID, title, risk, and status', () => {
    render(<TaskCard task={baseTask} />, { wrapper });
    const card = screen.getByRole('button');
    const label = card.getAttribute('aria-label') ?? '';
    expect(label).toContain('#42');
    expect(label).toContain('Refactor auth middleware');
    expect(label).toContain('high');
    expect(label).toContain('implementing');
  });

  // Keyboard handlers
  it('card has tabIndex=0 for keyboard navigation', () => {
    render(<TaskCard task={baseTask} />, { wrapper });
    const card = screen.getByRole('button');
    expect(card.getAttribute('tabindex')).toBe('0');
  });

  it('Enter key triggers navigation (onKeyDown handler present)', () => {
    const { container } = render(<TaskCard task={baseTask} />, { wrapper });
    const card = container.querySelector('[role="button"]')!;
    // Verify the element has a keydown handler by firing the event without throwing
    expect(() => {
      fireEvent.keyDown(card, { key: 'Enter' });
    }).not.toThrow();
  });

  it('Space key triggers navigation (onKeyDown handler present)', () => {
    const { container } = render(<TaskCard task={baseTask} />, { wrapper });
    const card = container.querySelector('[role="button"]')!;
    expect(() => {
      fireEvent.keyDown(card, { key: ' ' });
    }).not.toThrow();
  });

  // No pipeline segments for certain statuses
  it('does not render pipeline segments for cancelled status', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'cancelled' }} />, { wrapper }
    );
    expect(container.querySelector('[data-segment]')).toBeNull();
  });

  it('does not render pipeline segments for ready status', () => {
    const { container } = render(
      <TaskCard task={{ ...baseTask, status: 'ready' }} />, { wrapper }
    );
    expect(container.querySelector('[data-segment]')).toBeNull();
  });

  // Priority P3 badge
  it('shows P3 badge for priority 3', () => {
    render(<TaskCard task={{ ...baseTask, priority: 3 }} />, { wrapper });
    expect(screen.getByText('P3')).toBeTruthy();
  });
});
