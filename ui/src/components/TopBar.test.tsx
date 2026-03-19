import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopBar, emptyFilters } from './TopBar';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe('TopBar', () => {
  it('renders title text', () => {
    render(<TopBar title="My Board" />, { wrapper });
    expect(screen.getByText('My Board')).toBeTruthy();
  });

  it('renders task count badge when taskCount provided', () => {
    render(<TopBar title="Tasks" taskCount={42} />, { wrapper });
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('does not render task count badge when taskCount is undefined', () => {
    render(<TopBar title="Tasks" />, { wrapper });
    // No numeric badge should appear
    expect(screen.queryByText('0')).toBeNull();
  });

  it('search input present with placeholder "Search tasks..."', () => {
    render(
      <TopBar
        title="Tasks"
        filters={emptyFilters}
        onFiltersChange={vi.fn()}
      />,
      { wrapper }
    );
    const input = screen.getByPlaceholderText('Search tasks...');
    expect(input).toBeTruthy();
  });

  it('"New Task" button present when onNewTask callback provided', () => {
    render(<TopBar title="Tasks" onNewTask={vi.fn()} />, { wrapper });
    expect(screen.getByRole('button', { name: /new task/i })).toBeTruthy();
  });

  it('"New Task" button absent when onNewTask is undefined', () => {
    render(<TopBar title="Tasks" />, { wrapper });
    expect(screen.queryByRole('button', { name: /new task/i })).toBeNull();
  });

  it('Filter button present when filters prop provided', () => {
    render(
      <TopBar
        title="Tasks"
        filters={emptyFilters}
        onFiltersChange={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByRole('button', { name: /filter/i })).toBeTruthy();
  });

  it('keyboard shortcut hint ⌘K visible in search area', () => {
    render(
      <TopBar
        title="Tasks"
        filters={emptyFilters}
        onFiltersChange={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByText('⌘K')).toBeTruthy();
  });
});
