import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { SubtaskMiniCard } from './SubtaskMiniCard';
import type { Task } from '../types';

interface Props {
  task: Task;
  onClick: () => void;
  selected?: boolean;
  subtasks?: Task[];
}

const riskDotColor: Record<string, string> = {
  low: 'bg-accent-green',
  medium: 'bg-accent-amber',
  high: 'bg-accent-red',
};

const statusDotColor: Record<string, string> = {
  done: 'bg-accent-green',
  needs_human_review: 'bg-accent-pink',
  implementing: 'bg-accent-purple',
  checks: 'bg-accent-purple',
  review_panel: 'bg-accent-purple',
  planning: 'bg-accent-purple',
  blocked: 'bg-accent-amber',
  failed: 'bg-accent-red',
  ready: 'bg-text-tertiary',
  backlog: 'bg-text-tertiary',
  cancelled: 'bg-text-tertiary',
};

function leftBorderClass(task: Task): string {
  if (task.status === 'blocked') return 'border-l-accent-amber';
  if (task.status === 'failed') return 'border-l-accent-red';
  if (task.status === 'needs_human_review') return 'border-l-accent-pink';
  if (task.claimedBy) return 'border-l-accent-purple';
  return 'border-l-transparent';
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const TaskCard: React.FC<Props> = ({ task, onClick, selected, subtasks = [] }) => {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const hasSubtasks = subtasks.length > 0;
  const doneCount = subtasks.filter((s) => s.status === 'done').length;
  const subtasksRunning = subtasks.some((s) => s.claimedBy);

  const style: React.CSSProperties = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)${isDragging ? ' rotate(2deg)' : ''}` }
    : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`bg-bg-secondary rounded-lg p-3 mb-2 border border-border-default border-l-[3px] ${leftBorderClass(task)} cursor-grab transition-shadow duration-150 ${
        isDragging ? 'shadow-2xl opacity-85' : 'shadow-sm hover:bg-bg-tertiary hover:border-border-hover'
      } ${selected ? 'ring-2 ring-accent-blue' : ''}`}
    >
      <div className="text-sm font-medium text-text-primary line-clamp-2 mb-1.5">{task.title}</div>
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className={`w-2 h-2 rounded-full ${riskDotColor[task.riskLevel] || 'bg-text-tertiary'}`} />
        <span className="text-text-tertiary">{task.riskLevel}</span>
        {task.priority > 0 && <span className="text-text-tertiary">P{task.priority}</span>}
        <span className="text-text-tertiary">{timeAgo(task.updatedAt)}</span>
        {task.claimedBy && (
          <span className="flex items-center gap-1 text-accent-purple">
            <svg className="w-3 h-3 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
            running
          </span>
        )}
        {subtasksRunning && !task.claimedBy && (
          <span className="flex items-center gap-1 text-accent-purple">
            <svg className="w-3 h-3 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
            subtasks
          </span>
        )}
      </div>

      {/* Subtask progress */}
      {hasSubtasks && (
        <div className="mt-2 pt-2 border-t border-border-default">
          <div
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setExpanded(!expanded); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-2 cursor-pointer text-xs text-text-tertiary select-none"
          >
            <span className={`text-[10px] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>▶</span>
            {/* Mini progress bar */}
            <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-green transition-all duration-300"
                style={{ width: `${(doneCount / subtasks.length) * 100}%` }}
              />
            </div>
            <span>{doneCount}/{subtasks.length}</span>
          </div>

          {expanded && (
            <div className="mt-1.5 space-y-1">
              {subtasks
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map((sub) => (
                  <SubtaskMiniCard key={sub.id} task={sub} />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
