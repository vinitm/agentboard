import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '../types';

const AGENT_COLUMNS: TaskStatus[] = ['planning', 'implementing', 'checks', 'review_panel'];

const COLUMN_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  planning: 'Planning',
  needs_plan_review: 'Plan Review',
  implementing: 'Implementing',
  checks: 'Checks',
  review_panel: 'Review Panel',
  needs_human_review: 'Needs Review',
  done: 'Done',
  blocked: 'Blocked',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_HEADER_COLOR: Partial<Record<TaskStatus, string>> = {
  blocked: 'text-accent-amber',
  failed: 'text-accent-red',
  cancelled: 'text-text-tertiary',
  done: 'text-accent-green',
  needs_human_review: 'text-accent-pink',
  needs_plan_review: 'text-accent-amber',
};

const STATUS_DOT_COLOR: Partial<Record<TaskStatus, string>> = {
  backlog: 'bg-text-tertiary',
  ready: 'bg-accent-blue',
  planning: 'bg-accent-purple',
  needs_plan_review: 'bg-accent-amber',
  implementing: 'bg-accent-purple',
  checks: 'bg-accent-purple',
  review_panel: 'bg-accent-purple',
  needs_human_review: 'bg-accent-pink',
  done: 'bg-accent-green',
  blocked: 'bg-accent-amber',
  failed: 'bg-accent-red',
  cancelled: 'bg-text-tertiary',
};

interface Props {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  subtasksByParent?: Map<string, Task[]>;
  selectedIds?: Set<string>;
  onToggleSelect?: (taskId: string, event: React.MouseEvent) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Column: React.FC<Props> = ({ status, tasks, onTaskClick, subtasksByParent, selectedIds, onToggleSelect, collapsed, onToggleCollapse }) => {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const isAgent = AGENT_COLUMNS.includes(status);
  const hasRunning = tasks.some((t) => t.claimedBy);

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        className={`w-10 flex-shrink-0 rounded-lg p-1.5 flex flex-col items-center transition-all duration-200 cursor-pointer ${
          isOver ? 'ring-2 ring-accent-blue bg-bg-tertiary' : 'bg-bg-tertiary hover:bg-bg-elevated'
        }`}
        onClick={onToggleCollapse}
        title={`${COLUMN_LABELS[status]} (${tasks.length}) — click to expand`}
      >
        <span className={`w-2 h-2 rounded-full mb-1.5 ${STATUS_DOT_COLOR[status] || 'bg-text-tertiary'} ${hasRunning ? 'animate-pulse-dot' : ''}`} />
        <span className="text-[10px] font-bold text-text-tertiary [writing-mode:vertical-lr] tracking-wider uppercase">
          {COLUMN_LABELS[status]}
        </span>
        {tasks.length > 0 && (
          <span className="mt-1.5 text-[10px] bg-bg-elevated text-text-tertiary rounded-full w-5 h-5 flex items-center justify-center font-semibold">
            {tasks.length}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`w-72 flex-shrink-0 rounded-lg p-2.5 flex flex-col transition-all duration-150 ${
        isOver ? 'ring-2 ring-accent-blue bg-bg-tertiary' : 'bg-bg-tertiary'
      } ${isAgent && hasRunning ? 'border-l-2 border-l-accent-purple' : ''}`}
    >
      <div className="flex items-center justify-between mb-2.5 px-1 group">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT_COLOR[status] || 'bg-text-tertiary'} ${hasRunning ? 'animate-pulse-dot' : ''}`} />
          <span className={`text-xs font-bold uppercase tracking-wide ${STATUS_HEADER_COLOR[status] || (isAgent ? 'text-accent-purple' : 'text-text-secondary')}`}>
            {COLUMN_LABELS[status] || status}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] bg-bg-elevated text-text-tertiary rounded-full px-2 py-0.5 font-semibold tabular-nums">
            {tasks.length}
          </span>
          {onToggleCollapse && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
              className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-text-primary transition-opacity p-0.5 rounded"
              title="Collapse column"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-[60px]">
        {tasks.length === 0 && (
          <div className="border-2 border-dashed border-border-default rounded-lg h-16 flex items-center justify-center text-xs text-text-tertiary gap-1.5">
            <svg className="w-3.5 h-3.5 opacity-50" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Drop here
          </div>
        )}
        {tasks
          .sort((a, b) => a.columnPosition - b.columnPosition || b.priority - a.priority)
          .map((task) => (
            <div key={task.id} className="relative">
              {selectedIds && onToggleSelect && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(task.id)}
                  onClick={(e) => onToggleSelect(task.id, e)}
                  onChange={() => {}}
                  className="absolute top-2 right-2 z-10 cursor-pointer accent-accent-blue"
                />
              )}
              <TaskCard
                task={task}
                onClick={() => onTaskClick(task)}
                selected={selectedIds?.has(task.id)}
                subtasks={subtasksByParent?.get(task.id) || []}
              />
            </div>
          ))}
      </div>
    </div>
  );
};
