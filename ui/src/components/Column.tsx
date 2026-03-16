import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '../types';

const AGENT_COLUMNS: TaskStatus[] = ['planning', 'implementing', 'checks', 'review_panel'];

const COLUMN_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  planning: 'Planning',
  implementing: 'Implementing',
  checks: 'Checks',
  review_panel: 'Review Panel',
  needs_human_review: 'Needs Human Review',
  done: 'Done',
  blocked: 'Blocked',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_HEADER_COLOR: Partial<Record<TaskStatus, string>> = {
  blocked: 'text-accent-amber',
  failed: 'text-accent-red',
  cancelled: 'text-text-tertiary',
};

interface Props {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  subtasksByParent?: Map<string, Task[]>;
  selectedIds?: Set<string>;
  onToggleSelect?: (taskId: string, event: React.MouseEvent) => void;
}

export const Column: React.FC<Props> = ({ status, tasks, onTaskClick, subtasksByParent, selectedIds, onToggleSelect }) => {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const isAgent = AGENT_COLUMNS.includes(status);
  const hasRunning = tasks.some((t) => t.claimedBy);

  return (
    <div
      ref={setNodeRef}
      className={`w-72 flex-shrink-0 rounded-lg p-2.5 flex flex-col transition-all duration-150 ${
        isOver ? 'ring-2 ring-accent-blue bg-bg-tertiary' : 'bg-bg-tertiary'
      } ${isAgent && hasRunning ? 'border-l-2 border-l-accent-purple' : ''}`}
    >
      <div className="flex items-center justify-between mb-2.5 px-1">
        <span className={`text-xs font-bold uppercase tracking-wide ${STATUS_HEADER_COLOR[status] || (isAgent ? 'text-accent-purple' : 'text-text-secondary')}`}>
          {COLUMN_LABELS[status] || status}
        </span>
        <span className="text-[11px] bg-bg-elevated text-text-tertiary rounded-full px-2 py-0.5 font-semibold">
          {tasks.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-[60px]">
        {tasks.length === 0 && (
          <div className="border-2 border-dashed border-border-default rounded-lg h-16 flex items-center justify-center text-xs text-text-tertiary">
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
