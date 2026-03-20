import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge.js';

describe('StatusBadge', () => {
  it('renders status label', () => {
    render(<StatusBadge status="implementing" />);
    expect(screen.getByText('implementing')).toBeDefined();
  });

  it('formats status labels with underscores', () => {
    render(<StatusBadge status="spec_review" />);
    expect(screen.getByText('spec review')).toBeDefined();
  });

  it('applies pulse class when pulse prop is true', () => {
    const { container } = render(<StatusBadge status="implementing" pulse />);
    const dot = container.querySelector('[class*="animate-pulse-dot"]');
    expect(dot).not.toBeNull();
  });

  it('applies sm size', () => {
    const { container } = render(<StatusBadge status="done" size="sm" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('text-[10px]');
  });

  it('maps done to green color', () => {
    const { container } = render(<StatusBadge status="done" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('bg-accent-green/15');
  });

  it('maps failed to error color', () => {
    const { container } = render(<StatusBadge status="failed" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('bg-accent-red/15');
  });
});
