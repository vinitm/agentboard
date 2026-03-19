import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PipelineBar } from './PipelineBar';
import { timeAgo } from '../lib/time';
import type { Task } from '../types';

const riskDotColor: Record<string, string> = {
  low: 'bg-accent-green',
  medium: 'bg-accent-amber',
  high: 'bg-accent-red',
};

const statusBadgeColor: Record<string, string> = {
  backlog: 'bg-bg-tertiary text-text-secondary',
  ready: 'bg-bg-tertiary text-text-secondary',
  blocked: 'bg-accent-amber/15 text-accent-amber',
  failed: 'bg-accent-red/15 text-accent-red',
  needs_plan_review: 'bg-accent-amber/15 text-accent-amber',
  needs_human_review: 'bg-accent-pink/15 text-accent-pink',
  done: 'bg-accent-green/15 text-accent-green',
  cancelled: 'bg-bg-tertiary text-text-tertiary',
};

function leftBorderClass(task: Task): string {
  if (task.status === 'blocked' || task.status === 'needs_plan_review') return 'border-l-accent-amber';
  if (task.status === 'failed') return 'border-l-accent-red';
  if (task.status === 'needs_human_review') return 'border-l-accent-pink';
  return 'border-l-transparent';
}

export const TaskCard: React.FC<{ task: Task }> = ({ task }) => {
  const navigate = useNavigate();
  const isRunning = !!task.claimedBy;

  return (
    <div
      onClick={() => navigate(`/tasks/${task.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/tasks/${task.id}`); } }}
      tabIndex={0}
      role="button"
      aria-label={`Task #${task.id}: ${task.title}, ${task.riskLevel} risk, ${task.status.replace(/_/g, ' ')}`}
      className={`bg-bg-secondary rounded-lg p-3 border border-border-default border-l-[3px] ${leftBorderClass(task)} cursor-pointer transition-all duration-150 animate-fade-in hover:bg-bg-tertiary hover:border-border-hover hover:shadow-md ${isRunning ? 'card-running' : ''}`}
    >
      {/* Title row */}
      <div className="flex items-start gap-1.5 mb-1">
        <span className="text-xs text-text-tertiary font-mono shrink-0">#{task.id}</span>
        <span className="text-sm font-medium text-text-primary line-clamp-2">{task.title}</span>
      </div>

      {/* Description */}
      {task.description && (
        <div className="text-[11px] text-text-tertiary line-clamp-1 mb-2">{task.description}</div>
      )}

      {/* Pipeline progress bar */}
      <div className="mb-2">
        <PipelineBar status={task.status} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusBadgeColor[task.status] || 'bg-accent-purple/15 text-accent-purple'}`}>
          {task.status.replace(/_/g, ' ')}
        </span>
        {task.priority > 0 && (
          <span className="bg-bg-tertiary px-1 py-0.5 rounded text-[10px] font-semibold text-text-secondary">
            P{task.priority}
          </span>
        )}
        <span className={`w-2 h-2 rounded-full ${riskDotColor[task.riskLevel] || 'bg-text-tertiary'}`} aria-hidden="true" />
        <span className="text-text-tertiary">{task.riskLevel}</span>
        <span className="text-text-tertiary ml-auto">{timeAgo(task.updatedAt)}</span>
        {isRunning && (
          <span className="flex items-center text-accent-purple" aria-label="Running">
            <svg className="w-3 h-3 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
};
