import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { LogViewer } from './LogViewer';
import { BlockedPanel } from './BlockedPanel';
import { PRPanel } from './PRPanel';
import { RunHistory } from './RunHistory';
import type { Task, TaskStatus, Run, SpecTemplate } from '../types';

interface Props {
  task: Task;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<Task>) => Promise<Task>;
  onAnswer: (id: string, answers: string) => Promise<Task>;
  onRetry: (id: string) => Promise<Task>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (task: Task) => void;
  onMove: (id: string, column: TaskStatus) => Promise<Task>;
}

export const TaskDetail: React.FC<Props> = ({
  task,
  onClose,
  onUpdate,
  onAnswer,
  onRetry,
  onDelete,
  onEdit,
  onMove,
}) => {
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    api
      .get<Run[]>(`/api/runs?taskId=${task.id}`)
      .then(setRuns)
      .catch(console.error);
  }, [task.id]);

  let spec: Partial<SpecTemplate> | null = null;
  if (task.spec) {
    try {
      spec = JSON.parse(task.spec) as Partial<SpecTemplate>;
    } catch {
      // spec is not JSON
    }
  }

  const isAgentActive = ['planning', 'implementing', 'checks', 'review_spec', 'review_code'].includes(task.status);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: 60,
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          maxWidth: 700,
          width: '90%',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>{task.title}</h2>
          <button onClick={onClose} style={closeBtnStyle}>
            &times;
          </button>
        </div>

        {/* Meta */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <Badge label={task.status} color={statusColor(task.status)} />
          <Badge label={`Risk: ${task.riskLevel}`} color={riskColor(task.riskLevel)} />
          <Badge label={`Priority: ${task.priority}`} color="#6b7280" />
        </div>

        {/* Description */}
        {task.description && (
          <div style={{ marginBottom: 16 }}>
            <h4 style={sectionTitle}>Description</h4>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, color: '#374151' }}>
              {task.description}
            </p>
          </div>
        )}

        {/* Spec */}
        {spec && (
          <div style={{ marginBottom: 16 }}>
            <h4 style={sectionTitle}>Spec</h4>
            {Object.entries(spec).map(([key, val]) =>
              val ? (
                <div key={key} style={{ marginBottom: 8 }}>
                  <strong style={{ fontSize: 12, color: '#6b7280', textTransform: 'capitalize' }}>
                    {key.replace(/([A-Z])/g, ' $1')}
                  </strong>
                  <p style={{ margin: '2px 0 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>{val}</p>
                </div>
              ) : null,
            )}
          </div>
        )}

        {/* Status-specific panels */}
        {task.status === 'blocked' && task.blockedReason && (
          <BlockedPanel
            taskId={task.id}
            blockedReason={task.blockedReason}
            onAnswer={onAnswer}
          />
        )}

        {task.status === 'needs_human_review' && (
          <PRPanel task={task} onMove={onMove} />
        )}

        {/* Failed */}
        {task.status === 'failed' && (
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => onRetry(task.id)} style={{ ...btnStyle, background: '#ef4444' }}>
              Retry Task
            </button>
          </div>
        )}

        {/* Live logs when agent is active */}
        {isAgentActive && (
          <div style={{ marginBottom: 16 }}>
            <h4 style={sectionTitle}>Live Logs</h4>
            <LogViewer taskId={task.id} />
          </div>
        )}

        {/* Run history */}
        <div style={{ marginBottom: 16 }}>
          <h4 style={sectionTitle}>Runs ({runs.length})</h4>
          <RunHistory runs={runs} />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
          <button onClick={() => onEdit(task)} style={{ ...btnStyle, background: '#3b82f6' }}>
            Edit
          </button>
          <button
            onClick={async () => {
              if (confirm('Delete this task?')) {
                await onDelete(task.id);
                onClose();
              }
            }}
            style={{ ...btnStyle, background: '#ef4444' }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

// -- Helpers --

const Badge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <span
    style={{
      fontSize: 12,
      padding: '2px 8px',
      borderRadius: 4,
      background: color,
      color: '#fff',
      fontWeight: 600,
    }}
  >
    {label}
  </span>
);

function statusColor(s: string): string {
  const map: Record<string, string> = {
    backlog: '#9ca3af',
    ready: '#3b82f6',
    planning: '#8b5cf6',
    implementing: '#8b5cf6',
    checks: '#8b5cf6',
    review_spec: '#8b5cf6',
    review_code: '#8b5cf6',
    needs_human_review: '#f59e0b',
    done: '#22c55e',
    blocked: '#f59e0b',
    failed: '#ef4444',
    cancelled: '#6b7280',
  };
  return map[s] || '#6b7280';
}

function riskColor(r: string): string {
  return r === 'high' ? '#ef4444' : r === 'medium' ? '#f59e0b' : '#22c55e';
}

const sectionTitle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 13,
  color: '#6b7280',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const btnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: '8px 16px',
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

const closeBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  fontSize: 24,
  cursor: 'pointer',
  color: '#9ca3af',
  lineHeight: 1,
};
