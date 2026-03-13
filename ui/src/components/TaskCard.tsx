import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Task } from '../types';

interface Props {
  task: Task;
  onClick: () => void;
  selected?: boolean;
  subtasks?: Task[];
  onSubtaskClick?: (task: Task) => void;
}

const riskColors: Record<string, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

const statusDotColors: Record<string, string> = {
  done: '#22c55e',
  needs_human_review: '#22c55e',
  implementing: '#3b82f6',
  checks: '#3b82f6',
  review_spec: '#3b82f6',
  review_code: '#3b82f6',
  planning: '#3b82f6',
  blocked: '#f59e0b',
  failed: '#ef4444',
  ready: '#9ca3af',
  backlog: '#9ca3af',
  cancelled: '#9ca3af',
};

export const TaskCard: React.FC<Props> = ({ task, onClick, selected, subtasks = [], onSubtaskClick }) => {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const hasSubtasks = subtasks.length > 0;
  const doneCount = subtasks.filter((s) => s.status === 'done').length;
  const subtasksRunning = subtasks.some((s) => s.claimedBy);

  const style: React.CSSProperties = {
    background: selected ? '#dbeafe' : '#fff',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 8,
    boxShadow: isDragging
      ? '0 8px 24px rgba(0,0,0,0.18)'
      : '0 1px 3px rgba(0,0,0,0.1)',
    cursor: 'grab',
    transform: transform
      ? `translate(${transform.x}px, ${transform.y}px)${isDragging ? ' rotate(2deg)' : ''}`
      : undefined,
    opacity: isDragging ? 0.85 : 1,
    borderLeft: `4px solid ${
      task.status === 'blocked'
        ? '#f59e0b'
        : task.status === 'failed'
          ? '#ef4444'
          : task.claimedBy
            ? '#3b82f6'
            : '#e5e7eb'
    }`,
    transition: isDragging ? 'none' : 'box-shadow 0.15s',
  };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} onClick={onClick}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{task.title}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 4,
            background: riskColors[task.riskLevel] || '#e5e7eb',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          {task.riskLevel}
        </span>
        {task.priority > 0 && (
          <span style={{ fontSize: 11, color: '#6b7280' }}>P{task.priority}</span>
        )}
        {task.claimedBy && (
          <span
            style={{
              fontSize: 11,
              color: '#3b82f6',
              animation: 'pulse 2s infinite',
            }}
          >
            running
          </span>
        )}
        {subtasksRunning && !task.claimedBy && (
          <span
            style={{
              fontSize: 11,
              color: '#3b82f6',
              animation: 'pulse 2s infinite',
            }}
          >
            subtasks running
          </span>
        )}
      </div>

      {/* Collapsible subtask section */}
      {hasSubtasks && (
        <div style={{ marginTop: 8, borderTop: '1px solid #e5e7eb', paddingTop: 6 }}>
          <div
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setExpanded(!expanded);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              fontSize: 12,
              color: '#6b7280',
              userSelect: 'none',
            }}
          >
            <span style={{
              display: 'inline-block',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s',
              fontSize: 10,
            }}>
              ▶
            </span>
            <span>
              {doneCount}/{subtasks.length} subtasks done
            </span>
          </div>

          {expanded && (
            <div style={{ marginTop: 4 }}>
              {subtasks
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map((sub) => (
                  <div
                    key={sub.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSubtaskClick?.(sub);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '3px 0',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: '#374151',
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: statusDotColors[sub.status] || '#9ca3af',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {sub.title.length > 40 ? sub.title.slice(0, 40) + '...' : sub.title}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
