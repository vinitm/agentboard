import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PipelineBar } from './PipelineBar';

describe('PipelineBar', () => {
  it('shows 7 segments', () => {
    const { container } = render(<PipelineBar status="implementing" />);
    const segments = container.querySelectorAll('[data-segment]');
    expect(segments).toHaveLength(7);
  });

  it('marks completed stages', () => {
    const { container } = render(<PipelineBar status="implementing" />);
    // spec_review and planning are before implementing (index 2), so 2 completed
    const completed = container.querySelectorAll('[data-completed="true"]');
    expect(completed).toHaveLength(2);
  });

  it('marks current stage', () => {
    const { container } = render(<PipelineBar status="checks" />);
    const current = container.querySelector('[data-current="true"]');
    expect(current).toBeTruthy();
  });

  it('shows all green when done', () => {
    const { container } = render(<PipelineBar status="done" />);
    const completed = container.querySelectorAll('[data-completed="true"]');
    expect(completed).toHaveLength(7);
  });

  it('shows stage count', () => {
    render(<PipelineBar status="implementing" />);
    expect(screen.getByText('2/7')).toBeTruthy();
  });

  it('maps needs_plan_review to planning stage with amber', () => {
    const { container } = render(<PipelineBar status="needs_plan_review" />);
    const current = container.querySelector('[data-current="true"]');
    expect(current?.getAttribute('data-stage')).toBe('planning');
  });

  it('returns null for backlog/ready', () => {
    const { container } = render(<PipelineBar status="backlog" />);
    expect(container.querySelector('[data-segment]')).toBeNull();
  });
});
