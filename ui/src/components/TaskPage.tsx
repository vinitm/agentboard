import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { CopyButton } from './CopyButton';
import { LogViewer } from './LogViewer';
import { RunHistory } from './RunHistory';
import { EventsTimeline } from './EventsTimeline';
import { SubtaskMiniCard } from './SubtaskMiniCard';
import type { Task, Run, TaskStatus } from '../types';

type Tab = 'logs' | 'events' | 'runs';
const ACTIVE_STATUSES: TaskStatus[] = ['planning', 'implementing', 'checks', 'review_spec', 'review_code'];

function getInitialTab(): Tab {
  const hash = window.location.hash.slice(1);
  if (hash === 'logs' || hash === 'events' || hash === 'runs') return hash;
  return 'logs';
}

const statusBadgeColor: Record<string, string> = {
  backlog: 'bg-text-tertiary', ready: 'bg-accent-blue', planning: 'bg-accent-purple',
  implementing: 'bg-accent-purple', checks: 'bg-accent-purple', review_spec: 'bg-accent-purple',
  review_code: 'bg-accent-purple', needs_human_review: 'bg-accent-pink', done: 'bg-accent-green',
  blocked: 'bg-accent-amber', failed: 'bg-accent-red', cancelled: 'bg-text-tertiary',
};

const riskBorderColor: Record<string, string> = {
  high: 'border-accent-red text-accent-red', medium: 'border-accent-amber text-accent-amber', low: 'border-accent-green text-accent-green',
};

interface EventRecord { id: string; taskId: string; runId: string | null; type: string; payload: string; createdAt: string }

export const TaskPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [parentTask, setParentTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [tab, setTab] = useState<Tab>(getInitialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setParentTask(null);
    setSubtasks([]);
    Promise.all([api.get<Task>(`/api/tasks/${id}`), api.get<Run[]>(`/api/runs?taskId=${id}`), api.get<EventRecord[]>(`/api/events?taskId=${id}`)])
      .then(async ([t, r, e]) => {
        setTask(t); setRuns(r); setEvents(e);
        // Fetch parent task if this is a subtask
        if (t.parentTaskId) {
          api.get<Task>(`/api/tasks/${t.parentTaskId}`).then(setParentTask).catch(() => {});
        }
        // Fetch subtasks by getting all tasks for this project and filtering
        api.get<Task[]>(`/api/tasks?projectId=${t.projectId}`).then((all) => {
          setSubtasks(all.filter((s) => s.parentTaskId === t.id));
        }).catch(() => {});
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load task'))
      .finally(() => setLoading(false));
  }, [id]);

  const changeTab = (t: Tab) => { setTab(t); window.location.hash = t; };

  if (loading) return <div className="flex items-center justify-center h-64 text-text-secondary">Loading...</div>;
  if (error || !task) return (
    <div className="flex flex-col items-center justify-center h-64">
      <div className="text-accent-red mb-2">{error || 'Task not found'}</div>
      <Link to="/" className="text-accent-blue hover:underline">← Back to Board</Link>
    </div>
  );

  const isActive = ACTIVE_STATUSES.includes(task.status);
  const tabs: { key: Tab; label: string }[] = [{ key: 'logs', label: 'Live Logs' }, { key: 'events', label: 'Events Timeline' }, { key: 'runs', label: 'Run History' }];

  // Get most recent run output for historical display
  const lastRun = runs.length > 0
    ? runs.slice().sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0]
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-1.5 text-sm flex-shrink-0">
          <Link to="/" className="text-text-secondary hover:text-text-primary">← Board</Link>
          {parentTask && (
            <>
              <span className="text-text-tertiary">/</span>
              <Link to={`/tasks/${parentTask.id}`} className="text-text-secondary hover:text-text-primary truncate max-w-[150px]">{parentTask.title}</Link>
            </>
          )}
        </div>
        <h1 className="text-base font-semibold text-white flex-1 truncate">{task.title}</h1>
        <span className={`${statusBadgeColor[task.status] || 'bg-text-tertiary'} text-white px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase`}>
          {task.status.replace(/_/g, ' ')}
        </span>
        <span className={`border ${riskBorderColor[task.riskLevel] || 'border-text-tertiary text-text-tertiary'} px-2 py-0.5 rounded-full text-[11px] font-semibold`}>
          {task.riskLevel} risk
        </span>
        <span className="text-xs text-text-tertiary">P{task.priority}</span>
        <div className="flex gap-2">
          {task.status === 'failed' && (
            <button onClick={async () => { await api.post(`/api/tasks/${task.id}/retry`); const t = await api.get<Task>(`/api/tasks/${task.id}`); setTask(t); }}
              className="px-3 py-1 rounded-md text-xs font-semibold bg-accent-amber text-white hover:bg-amber-600 transition-colors">Retry</button>
          )}
          <button onClick={async () => { if (confirm('Delete this task?')) { await api.del(`/api/tasks/${task.id}`); window.location.href = '/'; } }}
            className="px-3 py-1 rounded-md text-xs font-semibold bg-accent-red text-white hover:bg-red-600 transition-colors">Delete</button>
        </div>
      </div>

      {/* Subtasks */}
      {subtasks.length > 0 && (
        <div className="px-5 py-3 border-b border-border-default flex-shrink-0">
          <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Subtasks ({subtasks.filter((s) => s.status === 'done').length}/{subtasks.length} done)</div>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3">
            {subtasks
              .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
              .map((sub) => <SubtaskMiniCard key={sub.id} task={sub} />)}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border-default pl-5 flex-shrink-0">
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => changeTab(key)}
            className={`px-5 py-2.5 text-sm border-b-2 transition-colors ${tab === key ? 'border-accent-blue text-accent-blue font-semibold' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
            {label}
            {key === 'logs' && isActive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-green ml-1.5 animate-pulse-dot" />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5">
        {tab === 'logs' && (isActive
          ? <LogViewer taskId={task.id} />
          : lastRun?.output
            ? (
              <div className="relative">
                <div className="absolute top-2 right-2 z-10">
                  <CopyButton text={lastRun.output} />
                </div>
                <div className="bg-bg-secondary font-mono text-xs text-text-primary p-3 rounded-lg max-h-[400px] overflow-y-auto border border-border-default">
                  <div className="text-text-tertiary text-[11px] mb-2">Last run: {lastRun.stage} ({lastRun.status}) — {new Date(lastRun.startedAt).toLocaleString()}</div>
                  <pre className="whitespace-pre-wrap break-all m-0">{lastRun.output}</pre>
                </div>
              </div>
            )
            : <div className="text-text-secondary text-center pt-10">No logs available. Task status: {task.status.replace(/_/g, ' ')}</div>
        )}
        {tab === 'events' && <EventsTimeline taskId={task.id} events={events} />}
        {tab === 'runs' && <RunHistory runs={runs} />}
      </div>
    </div>
  );
};
