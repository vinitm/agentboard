import React, { useState, useEffect } from 'react';
import { CopyButton } from './CopyButton';
import { useSocket } from '../hooks/useSocket';

interface EventRecord { id: string; taskId: string; runId: string | null; type: string; payload: string; createdAt: string }
interface Props { taskId: string; events: EventRecord[] }

const EVENT_COLORS: Record<string, string> = {
  status_changed: 'text-accent-blue', implementation_failed: 'text-accent-red',
  checks_failed: 'text-accent-red', review_panel_failed: 'text-accent-red',
  review_panel_completed: 'text-accent-green', pr_created: 'text-accent-green',
  task_created: 'text-text-tertiary', subtasks_created: 'text-text-tertiary',
  task_error: 'text-accent-red', answer_provided: 'text-accent-purple',
};

function getEventColor(type: string, payload: Record<string, unknown>): string {
  if (type === 'status_changed' && payload.to === 'blocked') return 'text-accent-amber';
  return EVENT_COLORS[type] ?? 'text-text-tertiary';
}

function summarizeEvent(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'status_changed': return `Status changed: ${payload.from} → ${payload.to}${payload.reason ? ` (${payload.reason})` : ''}`;
    case 'implementation_failed': return `Implementation failed (attempt ${payload.attempt})`;
    case 'checks_failed': return `Checks failed (attempt ${payload.attempt})`;
    case 'review_panel_failed': {
      const results = payload.results as Array<{ role: string; passed: boolean }> | undefined;
      const failed = results?.filter(r => !r.passed).map(r => r.role).join(', ') ?? 'unknown';
      return `Review panel failed: ${failed} (cycle ${payload.reviewCycle})`;
    }
    case 'review_panel_completed': return `Review panel passed (cycle ${payload.reviewCycle})`;
    case 'pr_created': return `PR #${payload.prNumber} created`;
    case 'pr_creation_failed': return `PR creation failed: ${payload.error}`;
    case 'task_created': return 'Task created';
    case 'subtasks_created': return `${payload.count} subtasks created`;
    case 'task_error': return `Error: ${(payload.error as string)?.slice(0, 100)}`;
    case 'answer_provided': return 'Human provided answers';
    default: return type.replace(/_/g, ' ');
  }
}

export const EventsTimeline: React.FC<Props> = ({ taskId, events: initialEvents }) => {
  const [events, setEvents] = useState<EventRecord[]>(initialEvents);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const socket = useSocket();

  useEffect(() => { setEvents(initialEvents); }, [initialEvents]);

  useEffect(() => {
    if (!socket) return;
    const onEvent = (event: EventRecord) => {
      if (event.taskId === taskId) setEvents((prev) => prev.some((e) => e.id === event.id) ? prev : [...prev, event]);
    };
    socket.on('task:event', onEvent);
    return () => { socket.off('task:event', onEvent); };
  }, [socket, taskId]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  if (events.length === 0) return <div className="text-text-secondary text-center py-5">No events yet</div>;

  return (
    <div className="relative pl-7">
      <div className="absolute left-2 top-1 bottom-1 w-0.5 bg-border-default" />
      {events.map((event) => {
        const payload = (() => { try { return JSON.parse(event.payload); } catch { return {}; } })();
        const colorClass = getEventColor(event.type, payload);
        const isExpanded = expanded.has(event.id);
        return (
          <div key={event.id} className="relative mb-4 cursor-pointer" onClick={() => toggleExpand(event.id)}>
            <div className={`absolute -left-6 top-0.5 text-sm leading-none ${colorClass}`}>●</div>
            <div className="flex gap-3 items-baseline">
              <span className="text-[11px] text-text-tertiary whitespace-nowrap min-w-[70px]">{new Date(event.createdAt).toLocaleTimeString()}</span>
              <span className="text-[13px] text-text-primary">{summarizeEvent(event.type, payload)}</span>
            </div>
            {isExpanded && (
              <div className="relative mt-2">
                <div className="absolute top-2 right-2">
                  <CopyButton text={JSON.stringify(payload, null, 2)} />
                </div>
                <pre className="p-3 bg-bg-secondary rounded-md text-xs text-text-primary font-mono overflow-auto max-h-[300px] whitespace-pre-wrap break-words border border-border-default">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
