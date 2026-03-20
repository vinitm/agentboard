import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { BlockedPanel } from './BlockedPanel';
import { PRPanel } from './PRPanel';
import { PlanReviewPanel } from './PlanReviewPanel';
import { RunHistory } from './RunHistory';
import { EventsTimeline } from './EventsTimeline';
import { PipelineBar } from './PipelineBar';
import { StageAccordion } from './StageAccordion';
import { TaskForm } from './TaskForm';
import { TaskDescription } from './TaskDescription';
import { TaskSidebar } from './TaskSidebar';
import { ChatHistory } from './ChatHistory';
import { ArtifactsTab } from './ArtifactsTab';
import { CostsTab } from './CostsTab';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './Toast';
import { useSocket } from '../hooks/useSocket';
import { timeAgo } from '../lib/time';
import type { Task, Run, TaskStatus, RiskLevel, PlanReviewAction, PersistedChatMessage } from '../types';

type Tab = 'overview' | 'stages' | 'events' | 'runs' | 'chat' | 'artifacts' | 'costs';
const ACTIVE_STATUSES: TaskStatus[] = ['spec_review', 'planning', 'implementing', 'checks', 'code_quality', 'final_review', 'pr_creation'];
const ALL_TABS: Tab[] = ['overview', 'stages', 'events', 'runs', 'chat', 'artifacts', 'costs'];

function getInitialTab(): Tab {
  const hash = window.location.hash.slice(1) as Tab;
  if (ALL_TABS.includes(hash)) return hash;
  return 'overview';
}

const statusBadgeColor: Record<string, string> = {
  backlog: 'bg-text-tertiary', ready: 'bg-accent-blue', spec_review: 'bg-accent-blue', planning: 'bg-accent-purple',
  implementing: 'bg-accent-purple', checks: 'bg-accent-purple', code_quality: 'bg-accent-purple',
  final_review: 'bg-accent-green', pr_creation: 'bg-accent-green',
  needs_human_review: 'bg-accent-pink', done: 'bg-accent-green',
  blocked: 'bg-accent-amber', failed: 'bg-accent-red', cancelled: 'bg-text-tertiary',
  needs_plan_review: 'bg-accent-amber',
};

const riskBorderColor: Record<string, string> = {
  high: 'border-accent-red text-accent-red', medium: 'border-accent-amber text-accent-amber', low: 'border-accent-green text-accent-green',
};

interface EventRecord { id: string; taskId: number; runId: string | null; type: string; payload: string; createdAt: string }

// Skeleton loader for the page
const PageSkeleton: React.FC = () => (
  <div className="flex flex-col h-full animate-fade-in">
    <div className="flex items-center gap-4 px-5 py-3 border-b border-border-default">
      <div className="skeleton h-4 w-16" />
      <div className="skeleton h-5 w-64" />
      <div className="ml-auto skeleton h-5 w-20 rounded-full" />
    </div>
    <div className="px-5 py-3 border-b border-border-default">
      <div className="skeleton h-3 w-full rounded-full" />
    </div>
    <div className="flex-1 flex gap-5 p-5">
      <div className="flex-1 space-y-3">
        <div className="skeleton h-24 w-full rounded-lg" />
        <div className="skeleton h-40 w-full rounded-lg" />
        <div className="skeleton h-64 w-full rounded-lg" />
      </div>
      <div className="w-[280px] space-y-3 shrink-0">
        <div className="skeleton h-28 w-full rounded-lg" />
        <div className="skeleton h-24 w-full rounded-lg" />
        <div className="skeleton h-40 w-full rounded-lg" />
        <div className="skeleton h-28 w-full rounded-lg" />
      </div>
    </div>
  </div>
);

const MOVABLE_COLUMNS: TaskStatus[] = ['backlog', 'ready', 'cancelled', 'done'];

export const TaskPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const taskId = id ? Number(id) : undefined;
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [chatCount, setChatCount] = useState(0);
  const [tab, setTab] = useState<Tab>(getInitialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'delete' | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<{ isTask: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const { toast } = useToast();
  const socket = useSocket();

  const handleDeleteClick = async () => {
    try {
      const impact = await api.get<typeof deleteImpact>(`/api/tasks/${task?.id}/delete-impact`);
      setDeleteImpact(impact);
    } catch {
      setDeleteImpact(null);
    }
    setConfirmAction('delete');
  };

  useEffect(() => {
    if (taskId === undefined || isNaN(taskId)) return;
    setLoading(true);
    Promise.all([
      api.get<Task>(`/api/tasks/${taskId}`),
      api.get<Run[]>(`/api/runs?taskId=${taskId}`),
      api.get<EventRecord[]>(`/api/events?taskId=${taskId}`),
      api.get<PersistedChatMessage[]>(`/api/tasks/${taskId}/chat/messages`).catch(() => []),
    ])
      .then(([t, r, e, msgs]) => {
        setTask(t); setRuns(r); setEvents(e); setChatCount(msgs.length);
        // Auto-open spec editor for draft tasks with in-progress chat
        if (t.status === 'backlog' && t.chatSessionId) {
          setEditing(true);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load task'))
      .finally(() => setLoading(false));
  }, [taskId]);

  // Live task updates via WebSocket
  useEffect(() => {
    if (!socket || !taskId) return;
    const onUpdated = (updated: Task) => {
      if (updated.id === taskId) setTask(updated);
    };
    const onMoved = (moved: Task) => {
      if (moved.id === taskId) setTask(moved);
    };
    const onEvent = (event: EventRecord) => {
      if (event.taskId === taskId) {
        setEvents((prev) => prev.some((e) => e.id === event.id) ? prev : [...prev, event]);
      }
    };
    socket.on('task:updated', onUpdated);
    socket.on('task:moved', onMoved);
    socket.on('task:event', onEvent);
    return () => {
      socket.off('task:updated', onUpdated);
      socket.off('task:moved', onMoved);
      socket.off('task:event', onEvent);
    };
  }, [socket, taskId]);

  // Update page title
  useEffect(() => {
    if (task) document.title = `Task #${task.id} — Agentboard`;
    return () => { document.title = 'Agentboard'; };
  }, [task]);

  const handleEditSubmit = async (data: { title: string; description: string; spec: string; riskLevel: RiskLevel; priority: number }) => {
    if (!task) return;
    const updated = await api.put<Task>(`/api/tasks/${task.id}`, data);
    setTask(updated);
    setEditing(false);
  };

  const changeTab = (t: Tab) => { setTab(t); window.location.hash = t; };

  if (loading) return <PageSkeleton />;

  if (error || !task) return (
    <div className="flex flex-col items-center justify-center h-64 animate-fade-in">
      <svg className="w-10 h-10 text-accent-red mb-3 opacity-60" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      <div className="text-accent-red mb-2">{error || 'Task not found'}</div>
      <Link to="/" className="text-accent-blue hover:underline text-sm">Back to Tasks</Link>
    </div>
  );

  const isActive = ACTIVE_STATUSES.includes(task.status);
  const displayStatus = task.status.replace(/_/g, ' ');

  // Count artifacts from runs (lazy — just show run count as proxy until tab is opened)
  const artifactProxyCount = runs.filter(r => r.status === 'success').length;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'stages', label: 'Stages' },
    { key: 'events', label: 'Events', count: events.length },
    { key: 'runs', label: 'Runs', count: runs.length },
    { key: 'chat', label: 'Chat', count: chatCount },
    { key: 'artifacts', label: 'Artifacts', count: artifactProxyCount },
    { key: 'costs', label: 'Costs' },
  ];

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-1.5 text-sm flex-shrink-0">
          <Link to="/" className="text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Tasks
          </Link>
        </div>
        <div className="flex items-baseline gap-2 flex-1 min-w-0">
          <span className="text-xs text-text-tertiary font-mono shrink-0">#{task.id}</span>
          <h1 className="text-base font-semibold text-white truncate">{task.title}</h1>
          <span className="text-[11px] text-text-tertiary shrink-0 hidden sm:inline">{timeAgo(task.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`${statusBadgeColor[task.status] || 'bg-text-tertiary'} text-white px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase flex items-center gap-1`}>
            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse-dot" />}
            {displayStatus}
          </span>
          <span className={`border ${riskBorderColor[task.riskLevel] || 'border-text-tertiary text-text-tertiary'} px-2 py-0.5 rounded-full text-[11px] font-semibold`}>
            {task.riskLevel}
          </span>
          {task.priority > 0 && (
            <span className="text-xs text-text-tertiary bg-bg-tertiary px-2 py-0.5 rounded-full font-medium">P{task.priority}</span>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {task.status === 'backlog' && task.chatSessionId && (
            <button onClick={() => setEditing(true)}
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-accent-blue text-white hover:bg-accent-blue-hover transition-colors">
              Continue Spec
            </button>
          )}
          {!isActive && !(task.status === 'backlog' && task.chatSessionId) && (
            <button onClick={() => setEditing(true)}
              className="px-3 py-1 rounded-lg text-xs font-semibold border border-border-hover text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors">
              Edit
            </button>
          )}
          <select
              value=""
              onChange={async (e) => {
                const column = e.target.value;
                if (!column) return;
                if (column === 'cancelled' && !window.confirm('Cancel this task? This will stop all active work.')) {
                  e.target.value = '';
                  return;
                }
                try {
                  const moved = await api.post<Task>(`/api/tasks/${task.id}/move`, { column });
                  setTask(moved);
                  toast(`Task moved to ${column}`, 'success');
                } catch (err) {
                  toast(`Cannot move task: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
                }
              }}
              className="rounded-md px-2 py-1 text-xs bg-bg-tertiary border border-border-default text-text-primary"
            >
              <option value="" disabled>Move to...</option>
              {MOVABLE_COLUMNS.map((col) => <option key={col} value={col}>{col}</option>)}
            </select>
          {(task.status === 'failed' || task.status === 'blocked') && (
            <button onClick={async () => { await api.post(`/api/tasks/${task.id}/retry`); const t = await api.get<Task>(`/api/tasks/${task.id}`); setTask(t); }}
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-accent-amber text-white hover:bg-amber-600 transition-colors">Retry</button>
          )}
          {task.claimedBy && task.claimedAt && (Date.now() - new Date(task.claimedAt).getTime() > 10 * 60 * 1000) && (
            <button onClick={async () => {
              try {
                const updated = await api.post<Task>(`/api/tasks/${task.id}/unclaim`);
                setTask(updated);
                toast('Task unclaimed successfully', 'success');
              } catch (err) {
                toast(`Failed to unclaim: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
              }
            }}
              className="px-3 py-1 rounded-lg text-xs font-semibold border border-accent-amber text-accent-amber hover:bg-accent-amber hover:text-white transition-colors">
              Force Unclaim
            </button>
          )}
          <button onClick={handleDeleteClick}
            className="px-3 py-1 rounded-lg text-xs font-semibold border border-accent-red text-accent-red hover:bg-accent-red hover:text-white transition-colors">Delete</button>
        </div>
      </div>

      {/* Pipeline progress */}
      <div className="px-5 py-3 border-b border-border-default flex-shrink-0">
        <PipelineBar status={task.status} showLabels />
      </div>

      {/* Action panels */}
      {task.status === 'needs_plan_review' && (
        <div className="px-5 py-3 border-b border-border-default flex-shrink-0">
          <PlanReviewPanel task={task} onReview={async (taskIdParam: number, action: PlanReviewAction) => {
            const updated = await api.post<Task>(`/api/tasks/${taskIdParam}/review-plan`, action);
            setTask(updated);
            return updated;
          }} />
        </div>
      )}
      {task.status === 'blocked' && task.blockedReason && (
        <div className="px-5 py-3 border-b border-border-default flex-shrink-0">
          <BlockedPanel taskId={task.id} blockedReason={task.blockedReason} onAnswer={async (taskIdParam: number, answers: string) => {
            const answered = await api.post<Task>(`/api/tasks/${taskIdParam}/answer`, { answers });
            setTask(answered);
            return answered;
          }} />
        </div>
      )}
      {task.status === 'needs_human_review' && (
        <div className="px-5 py-3 border-b border-border-default flex-shrink-0">
          <PRPanel task={task} onMove={async (taskIdParam: number, column: TaskStatus) => {
            const moved = await api.post<Task>(`/api/tasks/${taskIdParam}/move`, { column });
            setTask(moved);
            return moved;
          }} />
        </div>
      )}

      {/* Two-column layout: main content + sidebar */}
      <div className="flex-1 overflow-auto">
        <div className="flex gap-5 p-5 min-h-full">
          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Tabs */}
            <div className="flex border-b border-border-default -mx-0 overflow-x-auto">
              {tabs.map(({ key, label, count }) => (
                <button key={key} onClick={() => changeTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap ${tab === key ? 'border-accent-blue text-accent-blue font-semibold' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                  {label}
                  {key === 'stages' && isActive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse-dot" />}
                  {count !== undefined && count > 0 && key !== 'stages' && (
                    <span className="text-[10px] text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full font-medium">{count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="pt-1">
              {tab === 'overview' && <TaskDescription task={task} />}
              {tab === 'stages' && <StageAccordion taskId={task.id} />}
              {tab === 'events' && <EventsTimeline taskId={task.id} events={events} />}
              {tab === 'runs' && <RunHistory runs={runs} />}
              {tab === 'chat' && <ChatHistory taskId={task.id} />}
              {tab === 'artifacts' && <ArtifactsTab runs={runs} />}
              {tab === 'costs' && <CostsTab taskId={task.id} runs={runs} />}
            </div>
          </div>

          {/* Sidebar */}
          <TaskSidebar task={task} events={events} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction === 'delete'}
        title="Delete this task?"
        description="This will permanently delete the task and all its data. This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          setConfirmAction(null);
          setDeleteImpact(null);
          await api.del(`/api/tasks/${task.id}`);
          navigate('/');
        }}
        onCancel={() => { setConfirmAction(null); setDeleteImpact(null); }}
      />
      {editing && task && (
        <TaskForm
          initial={task}
          projectId={task.projectId}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
};
