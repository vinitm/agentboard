import React from 'react';
import type { TaskStatus } from '../types.js';

interface StatusBadgeProps {
  status: TaskStatus;
  size?: 'sm' | 'md';
  pulse?: boolean;
}

const STATUS_STYLES: Record<TaskStatus, string> = {
  backlog: 'bg-text-tertiary/15 text-text-tertiary ring-1 ring-text-tertiary/20',
  ready: 'bg-text-tertiary/15 text-text-tertiary ring-1 ring-text-tertiary/20',
  spec_review: 'bg-accent-purple/15 text-accent-purple ring-1 ring-accent-purple/20',
  planning: 'bg-accent-purple/15 text-accent-purple ring-1 ring-accent-purple/20',
  needs_plan_review: 'bg-accent-purple/15 text-accent-purple ring-1 ring-accent-purple/20',
  implementing: 'bg-accent-blue/15 text-accent-blue ring-1 ring-accent-blue/20',
  checks: 'bg-accent-green/15 text-accent-green ring-1 ring-accent-green/20',
  code_quality: 'bg-accent-green/15 text-accent-green ring-1 ring-accent-green/20',
  final_review: 'bg-accent-pink/15 text-accent-pink ring-1 ring-accent-pink/20',
  needs_human_review: 'bg-accent-purple/15 text-accent-purple ring-1 ring-accent-purple/20',
  pr_creation: 'bg-aeth-secondary-container/15 text-aeth-secondary-container ring-1 ring-aeth-secondary-container/20',
  done: 'bg-accent-green/15 text-accent-green ring-1 ring-accent-green/20',
  failed: 'bg-accent-red/15 text-accent-red ring-1 ring-accent-red/20',
  blocked: 'bg-accent-red/15 text-accent-red ring-1 ring-accent-red/20',
  cancelled: 'bg-text-tertiary/10 text-text-tertiary ring-1 ring-text-tertiary/10',
};

const PULSE_STATUSES: Set<TaskStatus> = new Set(['implementing']);

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  pulse,
}) => {
  const showPulse = pulse ?? PULSE_STATUSES.has(status);
  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
  const label = status.replace(/_/g, ' ');

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizeClass} ${STATUS_STYLES[status]}`}>
      {showPulse && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-dot" />
      )}
      {label}
    </span>
  );
};
