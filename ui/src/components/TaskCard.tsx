import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Task } from '../types';

interface Props {
  task: Task;
  onClick: () => void;
  selected?: boolean;
}

const riskColors: Record<string, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

export const TaskCard: React.FC<Props> = ({ task, onClick, selected }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

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
      </div>
    </div>
  );
};
