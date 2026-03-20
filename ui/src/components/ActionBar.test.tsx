import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionBar } from './ActionBar';

describe('ActionBar', () => {
  const actions = [
    { label: 'Approve', variant: 'primary' as const, onClick: vi.fn() },
    { label: 'Abort', variant: 'danger' as const, onClick: vi.fn() },
  ];

  it('renders all action buttons', () => {
    render(<ActionBar actions={actions} />);
    expect(screen.getByText('Approve')).toBeDefined();
    expect(screen.getByText('Abort')).toBeDefined();
  });

  it('calls onClick when button clicked', () => {
    const mockFn = vi.fn();
    const testActions = [
      { label: 'Test', variant: 'primary' as const, onClick: mockFn },
    ];
    render(<ActionBar actions={testActions} />);
    fireEvent.click(screen.getByText('Test'));
    expect(mockFn).toHaveBeenCalled();
  });

  it('applies split alignment', () => {
    const { container } = render(<ActionBar actions={actions} align="split" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('justify-between');
  });

  it('applies left alignment', () => {
    const { container } = render(<ActionBar actions={actions} align="left" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('justify-start');
  });

  it('applies right alignment by default', () => {
    const { container } = render(<ActionBar actions={actions} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('justify-end');
  });

  it('separates destructive and safe actions in split mode', () => {
    const testActions = [
      { label: 'Approve', variant: 'primary' as const, onClick: vi.fn() },
      { label: 'Abort', variant: 'danger' as const, onClick: vi.fn() },
      { label: 'Skip', variant: 'secondary' as const, onClick: vi.fn() },
    ];
    const { container } = render(<ActionBar actions={testActions} align="split" />);
    const leftGroup = container.querySelector('.justify-between > div:first-child');
    const rightGroup = container.querySelector('.justify-between > div:last-child');
    expect(leftGroup?.textContent).toContain('Abort');
    expect(rightGroup?.textContent).toContain('Approve');
    expect(rightGroup?.textContent).toContain('Skip');
  });

  it('renders with icon prop', () => {
    const testActions = [
      {
        label: 'Save',
        variant: 'primary' as const,
        onClick: vi.fn(),
        icon: <span data-testid="test-icon">✓</span>,
      },
    ];
    render(<ActionBar actions={testActions} />);
    expect(screen.getByTestId('test-icon')).toBeDefined();
    expect(screen.getByText('Save')).toBeDefined();
  });

  it('passes loading state to button', () => {
    const testActions = [
      { label: 'Submit', variant: 'primary' as const, onClick: vi.fn(), loading: true },
    ];
    render(<ActionBar actions={testActions} />);
    const button = screen.getByText('Submit').closest('button');
    expect(button?.disabled).toBe(true);
  });
});
