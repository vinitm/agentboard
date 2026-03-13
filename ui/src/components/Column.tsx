import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '../types';

const AGENT_COLUMNS: TaskStatus[] = [
  'planning',
  'implementing',
  'checks',
  'review_spec',
  'review_code',
];

const COLUMN_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  planning: 'Planning',
  implementing: 'Implementing',
  checks: 'Checks',
  review_spec: 'Review: Spec',
  review_code: 'Review: Code Quality',
  needs_human_review: 'Needs Human Review',
  done: 'Done',
  blocked: 'Blocked',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

interface Props {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  subtasksByParent?: Map<string, Task[]>;
  onSubtaskClick?: (task: Task) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (taskId: string, event: React.MouseEvent) => void;
}

export const Column: React.FC<Props> = ({ status, tasks, onTaskClick, subtasksByParent, onSubtaskClick, selectedIds, onToggleSelect }) => {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const isAgent = AGENT_COLUMNS.includes(status);

  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: 280,
        maxWidth: 320,
        flex: '0 0 280px',
        background: isOver ? '#dbeafe' : isAgent ? '#eff6ff' : '#f3f4f6',
        borderRadius: 10,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        transition: 'background 0.15s',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          padding: '0 4px',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13, color: '#374151' }}>
          {COLUMN_LABELS[status] || status}
        </span>
        <span
          style={{
            fontSize: 12,
            background: '#e5e7eb',
            borderRadius: 10,
            padding: '1px 8px',
            color: '#6b7280',
            fontWeight: 600,
          }}
        >
          {tasks.length}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 60 }}>
        {tasks
          .sort((a, b) => a.columnPosition - b.columnPosition || b.priority - a.priority)
          .map((task) => (
            <div key={task.id} style={{ position: 'relative' }}>
              {selectedIds && onToggleSelect && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(task.id)}
                  onClick={(e) => onToggleSelect(task.id, e)}
                  onChange={() => {}}
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    zIndex: 10,
                    cursor: 'pointer',
                    accentColor: '#3b82f6',
                  }}
                />
              )}
              <TaskCard
                task={task}
                onClick={() => onTaskClick(task)}
                selected={selectedIds?.has(task.id)}
                subtasks={subtasksByParent?.get(task.id) || []}
                onSubtaskClick={onSubtaskClick}
              />
            </div>
          ))}
      </div>
    </div>
  );
};
