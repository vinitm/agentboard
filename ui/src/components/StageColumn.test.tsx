import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageColumn } from './StageColumn';

describe('StageColumn', () => {
  it('renders title and count', () => {
    render(
      <StageColumn title="Implementing" count={3} status="implementing">
        <div>Cards</div>
      </StageColumn>,
    );
    expect(screen.getByText('Implementing')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
  });

  it('renders children', () => {
    render(
      <StageColumn title="Test" count={0} status="checks">
        <div>Child content</div>
      </StageColumn>,
    );
    expect(screen.getByText('Child content')).toBeDefined();
  });

  it('renders with different stages', () => {
    const { rerender } = render(
      <StageColumn title="Spec Review" count={1} status="spec_review">
        <div>Content</div>
      </StageColumn>,
    );
    expect(screen.getByText('Spec Review')).toBeDefined();

    rerender(
      <StageColumn title="PR Creation" count={2} status="pr_creation">
        <div>Content</div>
      </StageColumn>,
    );
    expect(screen.getByText('PR Creation')).toBeDefined();
  });

  it('renders count badge correctly with zero count', () => {
    render(
      <StageColumn title="Planning" count={0} status="planning">
        <div>No items</div>
      </StageColumn>,
    );
    expect(screen.getByText('0')).toBeDefined();
  });

  it('renders count badge correctly with large count', () => {
    render(
      <StageColumn title="Code Quality" count={99} status="code_quality">
        <div>Many items</div>
      </StageColumn>,
    );
    expect(screen.getByText('99')).toBeDefined();
  });

  it('renders multiple children', () => {
    render(
      <StageColumn title="Final Review" count={2} status="final_review">
        <div>Item 1</div>
        <div>Item 2</div>
      </StageColumn>,
    );
    expect(screen.getByText('Item 1')).toBeDefined();
    expect(screen.getByText('Item 2')).toBeDefined();
  });
});
