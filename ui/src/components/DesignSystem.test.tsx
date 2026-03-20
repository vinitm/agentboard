import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DesignSystem } from './DesignSystem';

describe('DesignSystem', () => {
  it('renders the page title', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Aetherium Design System')).toBeDefined();
  });
  it('renders color palette section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Color Palette')).toBeDefined();
  });
  it('renders typography section', () => {
    render(<DesignSystem />);
    // "Typography" appears in both nav and section heading
    expect(screen.getAllByText('Typography').length).toBeGreaterThan(0);
  });
  it('renders components section', () => {
    render(<DesignSystem />);
    // "Components" appears in both nav and section heading
    expect(screen.getAllByText('Components').length).toBeGreaterThan(0);
  });
});
