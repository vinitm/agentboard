import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Task } from '../types';

interface Props {
  task: Task;
}

const statusDotColor: Record<string, string> = {
  done: 'bg-accent-green',
  needs_human_review: 'bg-accent-pink',
  implementing: 'bg-accent-purple',
  checks: 'bg-accent-purple',
  review_spec: 'bg-accent-purple',
  review_code: 'bg-accent-purple',
  planning: 'bg-accent-purple',
  blocked: 'bg-accent-amber',
  failed: 'bg-accent-red',
  ready: 'bg-text-tertiary',
  backlog: 'bg-text-tertiary',
  cancelled: 'bg-text-tertiary',
};

function leftBorderClass(status: string): string {
  if (status === 'blocked') return 'border-l-accent-amber';
  if (status === 'failed') return 'border-l-accent-red';
  if (status === 'needs_human_review') return 'border-l-accent-pink';
  if (['planning', 'implementing', 'checks', 'review_spec', 'review_code'].includes(status)) return 'border-l-accent-purple';
  if (status === 'done') return 'border-l-accent-green';
  return 'border-l-transparent';
}

export const SubtaskMiniCard: React.FC<Props> = ({ task }) => {
  const navigate = useNavigate();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigate(`/tasks/${task.id}`);
  };

  return (
    <div
      onClick={handleClick}
      onPointerDown={(e) => e.stopPropagation()}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border border-border-default border-l-[3px] ${leftBorderClass(task.status)} bg-bg-tertiary hover:bg-bg-elevated cursor-pointer transition-colors`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotColor[task.status] || 'bg-text-tertiary'}`} />
      <span className="text-xs text-text-secondary truncate flex-1">{task.title}</span>
      {task.status === 'failed' && (
        <svg className="w-3 h-3 text-accent-red flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      )}
      {task.claimedBy && (
        <svg className="w-3 h-3 text-accent-purple flex-shrink-0 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
};
