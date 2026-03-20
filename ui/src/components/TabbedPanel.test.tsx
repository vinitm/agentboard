import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabbedPanel } from './TabbedPanel.js';

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'logs', label: 'Logs', count: 5 },
  { id: 'spec', label: 'Spec' },
];

describe('TabbedPanel', () => {
  it('renders all tab labels', () => {
    render(<TabbedPanel tabs={tabs} activeTab="overview" onTabChange={() => {}}><div>Content</div></TabbedPanel>);
    expect(screen.getByText('Overview')).toBeDefined();
    expect(screen.getByText('Logs')).toBeDefined();
    expect(screen.getByText('Spec')).toBeDefined();
  });

  it('shows count badge', () => {
    render(<TabbedPanel tabs={tabs} activeTab="overview" onTabChange={() => {}}><div>Content</div></TabbedPanel>);
    expect(screen.getByText('5')).toBeDefined();
  });

  it('calls onTabChange when tab clicked', () => {
    const onChange = vi.fn();
    render(<TabbedPanel tabs={tabs} activeTab="overview" onTabChange={onChange}><div>Content</div></TabbedPanel>);
    fireEvent.click(screen.getByText('Logs'));
    expect(onChange).toHaveBeenCalledWith('logs');
  });

  it('renders children', () => {
    render(<TabbedPanel tabs={tabs} activeTab="overview" onTabChange={() => {}}><div>Tab content</div></TabbedPanel>);
    expect(screen.getByText('Tab content')).toBeDefined();
  });

  it('highlights active tab with bottom border', () => {
    render(<TabbedPanel tabs={tabs} activeTab="logs" onTabChange={() => {}}><div>Content</div></TabbedPanel>);
    const logsButton = screen.getByRole('tab', { selected: true });
    expect(logsButton.textContent).toContain('Logs');
  });

  it('renders tab with icon', () => {
    const tabsWithIcon = [
      { id: 'overview', label: 'Overview', icon: <span data-testid="icon">📋</span> },
    ];
    render(<TabbedPanel tabs={tabsWithIcon} activeTab="overview" onTabChange={() => {}}><div>Content</div></TabbedPanel>);
    expect(screen.getByTestId('icon')).toBeDefined();
  });
});
