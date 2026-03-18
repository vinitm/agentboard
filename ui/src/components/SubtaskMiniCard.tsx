import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Task } from '../types';

interface Props {
  task: Task;
}

/** Collapse all pipeline states into a simple 4-state model for subtasks. */
function getSubtaskDisplay(task: Task): { color: string; borderColor: string; label: string } {
  switch (task.status) {
    case 'done':
      return { color: 'bg-accent-green', borderColor: 'border-l-accent-green', label: 'Done' };
    case 'failed':
      return { color: 'bg-accent-red', borderColor: 'border-l-accent-red', label: 'Failed' };
    case 'blocked':
      return { color: 'bg-accent-amber', borderColor: 'border-l-accent-amber', label: 'Blocked' };
    case 'cancelled':
      return { color: 'bg-text-tertiary', borderColor: 'border-l-transparent', label: 'Cancelled' };
    case 'backlog':
      return { color: 'bg-text-tertiary', borderColor: 'border-l-transparent', label: 'Queued' };
    default:
      // ready + any agent-controlled status = Running
      if (task.claimedBy) {
        return { color: 'bg-accent-purple', borderColor: 'border-l-accent-purple', label: 'Running' };
      }
      return { color: 'bg-accent-blue', borderColor: 'border-l-accent-blue', label: 'Next' };
  }
}

export const SubtaskMiniCard: React.FC<Props> = ({ task }) => {
  const navigate = useNavigate();
  const { color, borderColor, label } = getSubtaskDisplay(task);
  const isRunning = !!task.claimedBy && !['done', 'failed', 'cancelled'].includes(task.status);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigate(`/tasks/${task.id}`);
  };

  return (
    <div
      onClick={handleClick}
      onPointerDown={(e) => e.stopPropagation()}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border-default border-l-[3px] ${borderColor} bg-bg-tertiary hover:bg-bg-elevated cursor-pointer transition-colors group`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color} ${isRunning ? 'animate-pulse-dot' : ''}`} />
      <span className="text-xs text-text-secondary truncate flex-1 group-hover:text-text-primary transition-colors">{task.title}</span>
      <span className="text-[10px] text-text-tertiary flex-shrink-0">{label}</span>
      {task.status === 'failed' && (
        <svg className="w-3 h-3 text-accent-red flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      )}
      {task.status === 'blocked' && (
        <svg className="w-3 h-3 text-accent-amber flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
        </svg>
      )}
      {task.status === 'done' && (
        <svg className="w-3 h-3 text-accent-green flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
      {isRunning && (
        <svg className="w-3 h-3 text-accent-purple flex-shrink-0 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
};
