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

  // Returns null for ready
  it('returns null for ready — no segments in DOM', () => {
    const { container } = render(<PipelineBar status="ready" />);
    expect(container.querySelector('[data-segment]')).toBeNull();
  });

  // Returns null for cancelled
  it('returns null for cancelled — no segments in DOM', () => {
    const { container } = render(<PipelineBar status="cancelled" />);
    expect(container.querySelector('[data-segment]')).toBeNull();
  });

  // Failed: 7 segments, 0 completed, 0 current
  it('failed status renders 7 segments with 0 completed and 0 current', () => {
    const { container } = render(<PipelineBar status="failed" />);
    const segments = container.querySelectorAll('[data-segment]');
    expect(segments).toHaveLength(7);
    const completed = container.querySelectorAll('[data-completed="true"]');
    expect(completed).toHaveLength(0);
    const current = container.querySelectorAll('[data-current="true"]');
    expect(current).toHaveLength(0);
  });

  // needs_human_review shows all 7 completed
  it('needs_human_review shows all 7 segments completed', () => {
    const { container } = render(<PipelineBar status="needs_human_review" />);
    const completed = container.querySelectorAll('[data-completed="true"]');
    expect(completed).toHaveLength(7);
  });

  // showLabels=true renders label text
  it('showLabels=true renders label text', () => {
    render(<PipelineBar status="implementing" showLabels={true} />);
    expect(screen.getByText('Spec')).toBeTruthy();
    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('Impl')).toBeTruthy();
    expect(screen.getByText('Checks')).toBeTruthy();
  });

  // showLabels=false (default) does NOT render labels
  it('showLabels=false (default) does not render label text', () => {
    render(<PipelineBar status="implementing" />);
    expect(screen.queryByText('Spec')).toBeNull();
    expect(screen.queryByText('Plan')).toBeNull();
    expect(screen.queryByText('Impl')).toBeNull();
  });

  // spec_review shows "0/7"
  it('spec_review shows 0/7 count', () => {
    render(<PipelineBar status="spec_review" />);
    expect(screen.getByText('0/7')).toBeTruthy();
  });

  // final_review shows "5/7"
  it('final_review shows 5/7 count', () => {
    render(<PipelineBar status="final_review" />);
    expect(screen.getByText('5/7')).toBeTruthy();
  });
});
