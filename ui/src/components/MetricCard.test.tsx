import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from './MetricCard';

describe('MetricCard', () => {
  it('renders value and label', () => {
    render(<MetricCard label="Tasks" value={847} />);
    expect(screen.getByText('847')).toBeDefined();
    expect(screen.getByText('Tasks')).toBeDefined();
  });

  it('renders string values', () => {
    render(<MetricCard label="Rate" value="99.9%" />);
    expect(screen.getByText('99.9%')).toBeDefined();
  });

  it('shows up trend arrow', () => {
    const { container } = render(<MetricCard label="Tasks" value={10} trend="up" />);
    expect(container.querySelector('[data-trend="up"]')).not.toBeNull();
  });

  it('shows down trend arrow', () => {
    const { container } = render(<MetricCard label="Tasks" value={10} trend="down" />);
    expect(container.querySelector('[data-trend="down"]')).not.toBeNull();
  });

  it('shows flat trend arrow', () => {
    const { container } = render(<MetricCard label="Tasks" value={10} trend="flat" />);
    expect(container.querySelector('[data-trend="flat"]')).not.toBeNull();
  });

  it('renders optional icon', () => {
    const { container } = render(
      <MetricCard label="Tasks" value={10} icon={<span data-testid="icon">📊</span>} />
    );
    expect(screen.getByTestId('icon')).toBeDefined();
  });

  it('omits trend section when trend is not provided', () => {
    const { container } = render(<MetricCard label="Tasks" value={10} />);
    expect(container.querySelector('[data-trend]')).toBeNull();
  });
});
