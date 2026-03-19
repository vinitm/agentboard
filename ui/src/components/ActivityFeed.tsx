import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from './EmptyState';
import { useSocket } from '../hooks/useSocket';
import { api } from '../api/client';
import { timeAgo } from '../lib/time';
import type { Task } from '../types';

interface FeedEvent {
  id: string;
  taskId: number;
  runId: string | null;
  type: string;
  payload: string;
  createdAt: string;
  taskTitle: string;
}

interface Props {
  projectId: string;
  tasks: Task[];
}

const EVENT_COLORS: Record<string, string> = {
  status_changed: 'text-accent-blue', implementation_failed: 'text-accent-red',
  checks_failed: 'text-accent-red', review_panel_failed: 'text-accent-red',
  review_panel_completed: 'text-accent-green', pr_created: 'text-accent-green',
  task_created: 'text-text-tertiary', subtasks_created: 'text-text-tertiary',
  task_error: 'text-accent-red', answer_provided: 'text-accent-purple',
};

function summarizeEvent(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'status_changed': return `moved to ${payload.to}${payload.reason ? ` (${payload.reason})` : ''}`;
    case 'implementation_failed': return `implementation failed (attempt ${payload.attempt})`;
    case 'checks_failed': return `checks failed (attempt ${payload.attempt})`;
    case 'review_panel_failed': {
      const results = payload.results as Array<{ role: string; passed: boolean }> | undefined;
      const failed = results?.filter(r => !r.passed).map(r => r.role).join(', ') ?? 'unknown';
      return `review panel failed: ${failed} (cycle ${payload.reviewCycle})`;
    }
    case 'review_panel_completed': return `review panel passed (cycle ${payload.reviewCycle})`;
    case 'pr_created': return `PR #${payload.prNumber} created`;
    case 'task_created': return 'created';
    case 'subtasks_created': return `${payload.count} subtasks created`;
    case 'task_error': return `error: ${(payload.error as string)?.slice(0, 80)}`;
    case 'answer_provided': return 'human answered';
    default: return type.replace(/_/g, ' ');
  }
}

export const ActivityFeed: React.FC<Props> = ({ projectId, tasks }) => {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const socket = useSocket();

  const taskIds = new Set(tasks.map((t) => t.id));

  const loadEvents = useCallback(async (cursor?: string) => {
    try {
      const params = new URLSearchParams({ projectId, limit: '50' });
      if (cursor) params.set('cursor', cursor);
      const fetched = await api.get<FeedEvent[]>(`/api/events?${params}`);
      if (cursor) {
        setEvents((prev) => [...prev, ...fetched]);
      } else {
        setEvents(fetched);
      }
      setHasMore(fetched.length === 50);
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { setLoading(true); loadEvents(); }, [loadEvents]);

  // Live updates
  useEffect(() => {
    if (!socket) return;
    const onEvent = (event: FeedEvent) => {
      if (taskIds.has(event.taskId)) {
        const taskTitle = tasks.find((t) => t.id === event.taskId)?.title || 'Unknown';
        setEvents((prev) => prev.some((e) => e.id === event.id) ? prev : [{ ...event, taskTitle }, ...prev]);
      }
    };
    socket.on('task:event', onEvent);
    return () => { socket.off('task:event', onEvent); };
  }, [socket, tasks]);

  if (loading) return (
    <div className="p-5 max-w-3xl mx-auto animate-fade-in space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2 px-3">
          <div className="skeleton w-2 h-2 rounded-full" />
          <div className="flex-1 space-y-1">
            <div className="skeleton h-4 w-48" />
            <div className="skeleton h-3 w-32" />
          </div>
          <div className="skeleton h-3 w-12" />
        </div>
      ))}
    </div>
  );

  if (events.length === 0) return (
    <EmptyState
      icon={
        <svg className="w-7 h-7 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
      }
      title="No activity yet"
      description="Events will appear here as the pipeline processes tasks"
    />
  );

  const lastEvent = events[events.length - 1];

  return (
    <div className="p-5 max-w-3xl mx-auto">
      <h2 className="sr-only">Activity events</h2>
      <div className="space-y-1">
        {events.map((event) => {
          const payload = (() => { try { return JSON.parse(event.payload); } catch { return {}; } })();
          const colorClass = (event.type === 'status_changed' && payload.to === 'blocked')
            ? 'text-accent-amber'
            : EVENT_COLORS[event.type] ?? 'text-text-tertiary';
          return (
            <div key={event.id} className="flex items-start gap-3 py-2 px-3 rounded-md hover:bg-bg-tertiary transition-colors group">
              <span className={`mt-1 text-xs ${colorClass}`}>●</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <Link to={`/tasks/${event.taskId}`} className="text-sm font-medium text-text-primary hover:text-accent-blue truncate max-w-[300px]">
                    {event.taskTitle}
                  </Link>
                  <span className="text-[13px] text-text-secondary">{summarizeEvent(event.type, payload)}</span>
                </div>
              </div>
              <span className="text-[11px] text-text-tertiary whitespace-nowrap flex-shrink-0">{timeAgo(event.createdAt)}</span>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="text-center mt-4">
          <button onClick={() => loadEvents(lastEvent?.id)} className="px-4 py-2 text-sm text-text-secondary border border-border-default rounded-md hover:bg-bg-tertiary transition-colors">
            Load more
          </button>
        </div>
      )}
    </div>
  );
};
