import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GlassCard } from './GlassCard';

describe('GlassCard', () => {
  it('renders children', () => {
    render(<GlassCard>Hello</GlassCard>);
    expect(screen.getByText('Hello')).toBeDefined();
  });

  it('applies default variant classes', () => {
    const { container } = render(<GlassCard>Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('glass-surface');
  });

  it('applies highlighted variant', () => {
    const { container } = render(<GlassCard variant="highlighted">Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-accent-blue');
  });

  it('applies error variant', () => {
    const { container } = render(<GlassCard variant="error">Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-accent-red');
  });

  it('applies glow when enabled', () => {
    const { container } = render(<GlassCard glow>Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('glow-primary');
  });

  it('applies padding sizes', () => {
    const { container } = render(<GlassCard padding="lg">Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('p-6');
  });

  it('applies sm padding', () => {
    const { container } = render(<GlassCard padding="sm">Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('p-3');
  });

  it('applies md padding by default', () => {
    const { container } = render(<GlassCard>Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('p-4');
  });

  it('merges custom className with default classes', () => {
    const { container } = render(<GlassCard className="custom-class">Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('glass-surface');
    expect(card.className).toContain('custom-class');
  });

  it('applies glow-error variant when variant is error and glow is true', () => {
    const { container } = render(
      <GlassCard variant="error" glow>
        Content
      </GlassCard>
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('glow-error');
  });

  it('applies glow-secondary variant when variant is highlighted and glow is true', () => {
    const { container } = render(
      <GlassCard variant="highlighted" glow>
        Content
      </GlassCard>
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('glow-secondary');
  });

  it('has border and rounded corners', () => {
    const { container } = render(<GlassCard>Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border');
    expect(card.className).toContain('rounded-lg');
  });
});
