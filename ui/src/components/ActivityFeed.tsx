import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import { api } from '../api/client';
import type { Task } from '../types';

interface FeedEvent {
  id: string;
  taskId: string;
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

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

  if (loading) return <div className="flex items-center justify-center h-64 text-text-secondary">Loading activity...</div>;

  if (events.length === 0) return <div className="flex items-center justify-center h-64 text-text-secondary">No activity yet</div>;

  const lastEvent = events[events.length - 1];

  return (
    <div className="p-5 max-w-3xl mx-auto">
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
