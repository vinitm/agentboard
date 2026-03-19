import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { CopyButton } from './CopyButton';
import { LogViewer } from './LogViewer';
import { BlockedPanel } from './BlockedPanel';
import { PRPanel } from './PRPanel';
import { PlanReviewPanel } from './PlanReviewPanel';
import { RunHistory } from './RunHistory';
import { EventsTimeline } from './EventsTimeline';
import { SubtaskMiniCard } from './SubtaskMiniCard';
import { StageAccordion } from './StageAccordion';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './Toast';
import type { Task, Run, TaskStatus, PlanReviewAction } from '../types';

type Tab = 'stages' | 'events' | 'runs';
const ACTIVE_STATUSES: TaskStatus[] = ['spec_review', 'planning', 'implementing', 'checks', 'code_quality', 'final_review', 'pr_creation'];

/** For subtasks, collapse internal pipeline states into simplified labels. */
function getSubtaskDisplayStatus(task: Task): string {
  switch (task.status) {
    case 'done': return 'done';
    case 'failed': return 'failed';
    case 'blocked': return 'blocked';
    case 'cancelled': return 'cancelled';
    case 'backlog': return 'queued';
    default: return task.claimedBy ? 'running' : 'next';
  }
}

function getInitialTab(): Tab {
  const hash = window.location.hash.slice(1);
  if (hash === 'stages' || hash === 'events' || hash === 'runs') return hash;
  return 'stages';
}

const statusBadgeColor: Record<string, string> = {
  backlog: 'bg-text-tertiary', ready: 'bg-accent-blue', spec_review: 'bg-[#3b82f6]', planning: 'bg-accent-purple',
  implementing: 'bg-accent-purple', checks: 'bg-accent-purple', code_quality: 'bg-[#8b5cf6]',
  final_review: 'bg-[#14b8a6]', pr_creation: 'bg-[#22c55e]',
  needs_human_review: 'bg-accent-pink', done: 'bg-accent-green',
  blocked: 'bg-accent-amber', failed: 'bg-accent-red', cancelled: 'bg-text-tertiary',
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
    <div className="flex border-b border-border-default pl-5">
      <div className="skeleton h-4 w-20 mx-5 my-3" />
      <div className="skeleton h-4 w-20 mx-5 my-3" />
      <div className="skeleton h-4 w-20 mx-5 my-3" />
    </div>
    <div className="p-5 space-y-3">
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-3/4" />
      <div className="skeleton h-4 w-1/2" />
      <div className="skeleton h-32 w-full mt-4" />
    </div>
  </div>
);

const MOVABLE_COLUMNS: TaskStatus[] = ['backlog', 'ready', 'cancelled', 'done'];

export const TaskPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const taskId = id ? Number(id) : undefined;
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [parentTask, setParentTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [tab, setTab] = useState<Tab>(getInitialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'delete' | 'skip' | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (taskId === undefined || isNaN(taskId)) return;
    setLoading(true);
    setParentTask(null);
    setSubtasks([]);
    Promise.all([api.get<Task>(`/api/tasks/${taskId}`), api.get<Run[]>(`/api/runs?taskId=${taskId}`), api.get<EventRecord[]>(`/api/events?taskId=${taskId}`)])
      .then(async ([t, r, e]) => {
        setTask(t); setRuns(r); setEvents(e);
        if (t.parentTaskId) {
          api.get<Task>(`/api/tasks/${t.parentTaskId}`).then(setParentTask).catch(() => {});
        }
        api.get<Task[]>(`/api/tasks?projectId=${t.projectId}`).then((all) => {
          setSubtasks(all.filter((s) => s.parentTaskId === t.id));
        }).catch(() => {});
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load task'))
      .finally(() => setLoading(false));
  }, [taskId]);

  const changeTab = (t: Tab) => { setTab(t); window.location.hash = t; };

  if (loading) return <PageSkeleton />;

  if (error || !task) return (
    <div className="flex flex-col items-center justify-center h-64 animate-fade-in">
      <svg className="w-10 h-10 text-accent-red mb-3 opacity-60" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      <div className="text-accent-red mb-2">{error || 'Task not found'}</div>
      <Link to="/" className="text-accent-blue hover:underline text-sm">← Back to Board</Link>
    </div>
  );

  const isSubtask = !!task.parentTaskId;
  const isActive = ACTIVE_STATUSES.includes(task.status);
  const displayStatus = isSubtask ? getSubtaskDisplayStatus(task) : task.status.replace(/_/g, ' ');
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'stages', label: 'Stages' },
    { key: 'events', label: 'Events', count: events.length },
    { key: 'runs', label: 'Runs', count: runs.length },
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
            Board
          </Link>
          {parentTask && (
            <>
              <span className="text-text-tertiary">/</span>
              <Link to={`/tasks/${parentTask.id}`} className="text-text-secondary hover:text-text-primary truncate max-w-[150px] transition-colors">{parentTask.title}</Link>
            </>
          )}
        </div>
        <h1 className="text-base font-semibold text-white flex-1 truncate">{task.title}</h1>
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
          {!isSubtask && (
            <select
              onChange={async (e) => {
                if (!e.target.value) return;
                try {
                  const moved = await api.post<Task>(`/api/tasks/${task.id}/move`, { column: e.target.value });
                  setTask(moved);
                } catch (err) {
                  toast(`Cannot move task: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
                }
                e.target.value = '';
              }}
              className="rounded-md px-2 py-1 text-xs bg-bg-tertiary border border-border-default text-text-primary"
              defaultValue=""
            >
              <option value="" disabled>Move to...</option>
              {MOVABLE_COLUMNS.map((col) => <option key={col} value={col}>{col}</option>)}
            </select>
          )}
          {(task.status === 'failed' || task.status === 'blocked') && (
            <button onClick={async () => { await api.post(`/api/tasks/${task.id}/retry`); const t = await api.get<Task>(`/api/tasks/${task.id}`); setTask(t); }}
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-accent-amber text-white hover:bg-amber-600 transition-colors">Retry</button>
          )}
          {isSubtask && (task.status === 'blocked' || task.status === 'failed') && (
            <button onClick={() => setConfirmAction('skip')}
              className="px-3 py-1 rounded-lg text-xs font-semibold border border-text-tertiary text-text-secondary hover:bg-bg-tertiary transition-colors">Skip</button>
          )}
          <button onClick={() => setConfirmAction('delete')}
            className="px-3 py-1 rounded-lg text-xs font-semibold border border-accent-red text-accent-red hover:bg-accent-red hover:text-white transition-colors">Delete</button>
        </div>
      </div>

      {/* Subtasks */}
      {subtasks.length > 0 && (
        <div className="px-5 py-3 border-b border-border-default flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Subtasks</span>
            <span className="text-[11px] text-text-tertiary bg-bg-tertiary px-2 py-0.5 rounded-full font-medium">
              {subtasks.filter((s) => s.status === 'done').length}/{subtasks.length} done
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3">
            {subtasks
              .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
              .map((sub) => <SubtaskMiniCard key={sub.id} task={sub} />)}
          </div>
        </div>
      )}

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
      {task.status === 'blocked' && task.blockedReason && !isSubtask && (
        <div className="px-5 py-3 border-b border-border-default flex-shrink-0">
          <BlockedPanel taskId={task.id} blockedReason={task.blockedReason} onAnswer={async (taskIdParam: number, answers: string) => {
            const answered = await api.post<Task>(`/api/tasks/${taskIdParam}/answer`, { answers });
            setTask(answered);
            return answered;
          }} />
        </div>
      )}
      {task.status === 'blocked' && task.blockedReason && isSubtask && (
        <div className="px-5 py-3 border-b border-border-default flex-shrink-0">
          <div className="rounded-lg border border-accent-amber/30 bg-accent-amber/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-accent-amber flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-semibold text-accent-amber">Subtask Blocked</span>
            </div>
            <p className="text-sm text-text-secondary whitespace-pre-wrap">{task.blockedReason}</p>
            <p className="text-xs text-text-tertiary mt-2">Use Retry to re-run this subtask, or Skip to cancel it and continue with the next one.</p>
          </div>
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

      {/* Tabs */}
      <div className="flex border-b border-border-default pl-5 flex-shrink-0">
        {tabs.map(({ key, label, count }) => (
          <button key={key} onClick={() => changeTab(key)}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-sm border-b-2 transition-colors ${tab === key ? 'border-accent-blue text-accent-blue font-semibold' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
            {label}
            {key === 'stages' && isActive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse-dot" />}
            {count !== undefined && count > 0 && key !== 'stages' && (
              <span className="text-[10px] text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full font-medium">{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5">
        {tab === 'stages' && (
          <StageAccordion
            taskId={task.id}
            parentTaskId={isSubtask ? task.parentTaskId! : undefined}
            subtasks={subtasks.map(s => ({ id: s.id, title: s.title, status: s.status }))}
          />
        )}
        {tab === 'events' && <EventsTimeline taskId={task.id} events={events} />}
        {tab === 'runs' && <RunHistory runs={runs} />}
      </div>

      <ConfirmDialog
        open={confirmAction === 'delete'}
        title="Delete this task?"
        description="This will permanently delete the task and all its data. This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          setConfirmAction(null);
          await api.del(`/api/tasks/${task.id}`);
          navigate('/');
        }}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'skip'}
        title="Skip this subtask?"
        description="It will be cancelled and the next subtask will be promoted."
        confirmLabel="Skip"
        variant="warning"
        onConfirm={async () => {
          setConfirmAction(null);
          const updated = await api.post<Task>(`/api/tasks/${task.id}/skip`);
          setTask(updated);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
};
