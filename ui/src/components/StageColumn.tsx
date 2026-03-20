import React from 'react';
import type { Stage } from '../types';

interface StageColumnProps {
  title: string;
  count: number;
  status: Stage;
  children: React.ReactNode;
}

export const StageColumn: React.FC<StageColumnProps> = ({ title, count, children }) => (
  <div className="flex flex-col min-w-[320px] flex-1">
    <div className="glass-surface flex items-center justify-between px-4 py-3 border-b border-border-default rounded-t-lg">
      <span className="text-sm font-heading font-medium text-text-secondary uppercase tracking-wide">{title}</span>
      <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent-purple/15 text-accent-purple font-medium">{count}</span>
    </div>
    <div className="flex-1 overflow-auto p-2 flex flex-col gap-2">
      {children}
    </div>
  </div>
);
