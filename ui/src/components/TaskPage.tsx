import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { LogViewer } from './LogViewer';
import { RunHistory } from './RunHistory';
import { EventsTimeline } from './EventsTimeline';
import type { Task, Run, TaskStatus } from '../types';

type Tab = 'logs' | 'events' | 'runs';

const ACTIVE_STATUSES: TaskStatus[] = ['planning', 'implementing', 'checks', 'review_spec', 'review_code'];

function getInitialTab(): Tab {
  const hash = window.location.hash.slice(1);
  if (hash === 'logs' || hash === 'events' || hash === 'runs') return hash;
  return 'logs';
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    backlog: '#9ca3af', ready: '#3b82f6', planning: '#8b5cf6',
    implementing: '#f59e0b', checks: '#f59e0b', review_spec: '#f59e0b',
    review_code: '#f59e0b', needs_human_review: '#ec4899', done: '#22c55e',
    blocked: '#f97316', failed: '#ef4444', cancelled: '#6b7280',
  };
  return map[status] ?? '#9ca3af';
}

function riskColor(risk: string): string {
  return risk === 'high' ? '#ef4444' : risk === 'medium' ? '#f59e0b' : '#22c55e';
}

interface EventRecord {
  id: string;
  taskId: string;
  runId: string | null;
  type: string;
  payload: string;
  createdAt: string;
}

export const TaskPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [tab, setTab] = useState<Tab>(getInitialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get<Task>(`/api/tasks/${id}`),
      api.get<Run[]>(`/api/runs?taskId=${id}`),
      api.get<EventRecord[]>(`/api/events?taskId=${id}`),
    ])
      .then(([t, r, e]) => {
        setTask(t);
        setRuns(r);
        setEvents(e);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load task'))
      .finally(() => setLoading(false));
  }, [id]);

  const changeTab = (t: Tab) => {
    setTab(t);
    window.location.hash = t;
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>;
  }

  if (error || !task) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: '#ef4444', marginBottom: 8 }}>{error || 'Task not found'}</div>
        <Link to="/" style={{ color: '#3b82f6' }}>&larr; Back to Board</Link>
      </div>
    );
  }

  const isActive = ACTIVE_STATUSES.includes(task.status);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexShrink: 0,
        }}
      >
        <Link to="/" style={{ color: '#6b7280', textDecoration: 'none', fontSize: 14 }}>
          &larr; Board
        </Link>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#111827', flex: 1 }}>
          {task.title}
        </h1>
        <span
          style={{
            background: statusColor(task.status),
            color: '#fff',
            padding: '2px 10px',
            borderRadius: 12,
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase',
          }}
        >
          {task.status.replace(/_/g, ' ')}
        </span>
        <span
          style={{
            border: `1px solid ${riskColor(task.riskLevel)}`,
            color: riskColor(task.riskLevel),
            padding: '2px 8px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {task.riskLevel} risk
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>P{task.priority}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {task.status === 'failed' && (
            <button
              onClick={async () => {
                await api.post(`/api/tasks/${task.id}/retry`);
                const t = await api.get<Task>(`/api/tasks/${task.id}`);
                setTask(t);
              }}
              style={{ ...actionBtn, background: '#f59e0b' }}
            >
              Retry
            </button>
          )}
          <button
            onClick={async () => {
              if (confirm('Delete this task?')) {
                await api.del(`/api/tasks/${task.id}`);
                window.location.href = '/';
              }
            }}
            style={{ ...actionBtn, background: '#ef4444' }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          gap: 0,
          paddingLeft: 20,
          flexShrink: 0,
        }}
      >
        {([
          { key: 'logs' as Tab, label: 'Live Logs' },
          { key: 'events' as Tab, label: 'Events Timeline' },
          { key: 'runs' as Tab, label: 'Run History' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => changeTab(key)}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderBottom: tab === key ? '2px solid #3b82f6' : '2px solid transparent',
              background: 'none',
              color: tab === key ? '#3b82f6' : '#6b7280',
              fontWeight: tab === key ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {label}
            {key === 'logs' && isActive && (
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#22c55e',
                  marginLeft: 6,
                  animation: 'pulse 2s infinite',
                }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'logs' && (
          isActive ? (
            <LogViewer taskId={task.id} />
          ) : (
            <div style={{ color: '#9ca3af', textAlign: 'center', paddingTop: 40 }}>
              No active execution. Task status: {task.status.replace(/_/g, ' ')}
            </div>
          )
        )}
        {tab === 'events' && <EventsTimeline taskId={task.id} events={events} />}
        {tab === 'runs' && <RunHistory runs={runs} />}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
};

const actionBtn: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: '4px 12px',
  color: '#fff',
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
};
