import React from 'react';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface TabbedPanelProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children: React.ReactNode;
}

export const TabbedPanel: React.FC<TabbedPanelProps> = ({ tabs, activeTab, onTabChange, children }) => (
  <div>
    <div className="flex border-b border-border-default" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTab}
          onClick={() => onTabChange(tab.id)}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-heading font-medium transition-colors cursor-pointer ${
            tab.id === activeTab
              ? 'text-accent-blue border-b-2 border-accent-blue -mb-px'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {tab.icon}
          {tab.label}
          {tab.count != null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-purple/15 text-accent-purple font-medium">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
    <div role="tabpanel" className="mt-4">{children}</div>
  </div>
);
