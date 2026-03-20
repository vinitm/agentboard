import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskForm } from './TaskForm';
import type { Task } from '../types';

// Mock api client so chat-history fetch doesn't fail
vi.mock('../api/client', () => ({
  api: {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue({ id: 1 }),
    put: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(undefined),
  },
}));

const defaultProps = {
  projectId: 'proj-1',
  onSubmit: vi.fn().mockResolvedValue(undefined),
  onCancel: vi.fn(),
};

const baseTask: Task = {
  id: 1,
  projectId: 'proj-1',
  title: 'Existing Task Title',
  description: 'Existing description',
  status: 'backlog',
  riskLevel: 'low',
  priority: 0,
  spec: null,
  blockedReason: null,
  blockedAtStage: null,
  claimedAt: null,
  claimedBy: null,
  chatSessionId: null,
  createdAt: '2026-03-19T10:00:00Z',
  updatedAt: '2026-03-19T10:00:00Z',
};

describe('TaskForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog with "New Task" title', () => {
    render(<TaskForm {...defaultProps} />);
    expect(screen.getByText('New Task')).toBeTruthy();
  });

  it('shows chat textarea with placeholder "Describe what you need built..."', () => {
    render(<TaskForm {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Describe what you need built...');
    expect(textarea).toBeTruthy();
    // Should be a textarea, not an input
    expect(textarea.tagName.toLowerCase()).toBe('textarea');
  });

  it('spec preview panel shows "Goal" label', () => {
    render(<TaskForm {...defaultProps} />);
    expect(screen.getByText('Goal')).toBeTruthy();
  });

  it('spec preview panel shows "User Scenarios" label', () => {
    render(<TaskForm {...defaultProps} />);
    expect(screen.getByText('User Scenarios')).toBeTruthy();
  });

  it('spec preview panel shows "Success Criteria" label', () => {
    render(<TaskForm {...defaultProps} />);
    expect(screen.getByText('Success Criteria')).toBeTruthy();
  });

  it('"Skip to quick create" link present on fresh form', () => {
    render(<TaskForm {...defaultProps} />);
    expect(screen.getByText(/skip to quick create/i)).toBeTruthy();
  });

  it('"Cancel" button present', () => {
    render(<TaskForm {...defaultProps} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });

  it('Cancel button calls onCancel when no chat work exists', () => {
    const onCancel = vi.fn();
    render(<TaskForm {...defaultProps} onCancel={onCancel} />);
    // Fresh form: only 1 message (welcome), no input — handleCancel calls onCancel directly
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Close (X) button exists in dialog header', () => {
    render(<TaskForm {...defaultProps} />);
    // Radix Dialog renders into document.body via portal, not into the container
    // The close button (index 0) has an SVG X icon with path starting with M4.293
    const allButtons = document.body.querySelectorAll('button');
    const xButton = Array.from(allButtons).find((btn) => {
      const path = btn.querySelector('path');
      return path?.getAttribute('d')?.startsWith('M4.293');
    });
    expect(xButton).toBeTruthy();
  });

  it('shows "Edit Task" title when initial task prop provided', () => {
    render(<TaskForm {...defaultProps} initial={baseTask} />);
    expect(screen.getByText('Edit Task')).toBeTruthy();
  });

  it('Cancel on fresh form (no chat progress) calls onCancel without confirm', () => {
    const onCancel = vi.fn();
    render(<TaskForm {...defaultProps} onCancel={onCancel} />);
    // Fresh form: only welcome message, no user input — should cancel directly
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
