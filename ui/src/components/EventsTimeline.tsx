import React, { useState, useEffect } from 'react';
import { CopyButton } from './CopyButton';
import { useSocket } from '../hooks/useSocket';

interface EventRecord { id: string; taskId: number; runId: string | null; type: string; payload: string; createdAt: string }
interface Props { taskId: number; events: EventRecord[] }

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

/** Status badge for pipeline states */
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    blocked: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20',
    done: 'bg-green-500/15 text-green-400 ring-1 ring-green-500/20',
    failed: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/20',
    implementing: 'bg-accent-purple/15 text-accent-purple ring-1 ring-accent-purple/20',
    ready: 'bg-accent-blue/15 text-accent-blue ring-1 ring-accent-blue/20',
    needs_plan_review: 'bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/20',
    needs_human_review: 'bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/20',
    planning: 'bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-500/20',
  };
  const style = colors[status] ?? 'bg-gray-500/15 text-gray-400 ring-1 ring-gray-500/20';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${style}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/** Labeled field row for the detail view */
function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-[10px] uppercase tracking-wider text-text-quaternary font-medium w-20 flex-shrink-0 text-right">{label}</span>
      <span className="text-xs text-text-primary">{children}</span>
    </div>
  );
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function has(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] !== undefined && payload[key] !== null && payload[key] !== '';
}

/** Renders a structured detail view for known event types, with JSON fallback */
function EventDetail({ type, payload }: { type: string; payload: Record<string, unknown> }) {
  switch (type) {
    case 'status_changed':
      return (
        <div className="space-y-0.5">
          <DetailField label="From"><StatusBadge status={str(payload.from)} /></DetailField>
          <DetailField label="To"><StatusBadge status={str(payload.to)} /></DetailField>
          {has(payload, 'reason') && <DetailField label="Reason"><span className="text-text-secondary">{str(payload.reason)}</span></DetailField>}
        </div>
      );

    case 'implementation_failed':
    case 'checks_failed':
      return (
        <div className="space-y-0.5">
          {has(payload, 'attempt') && <DetailField label="Attempt"><span className="font-mono">{str(payload.attempt)}</span></DetailField>}
          {has(payload, 'error') && <DetailField label="Error"><span className="text-red-400">{str(payload.error)}</span></DetailField>}
          {has(payload, 'stage') && <DetailField label="Stage"><span className="text-text-secondary">{str(payload.stage)}</span></DetailField>}
        </div>
      );

    case 'review_panel_failed':
    case 'review_panel_completed': {
      const results = payload.results as Array<{ role: string; passed: boolean }> | undefined;
      return (
        <div className="space-y-0.5">
          {has(payload, 'reviewCycle') && <DetailField label="Cycle"><span className="font-mono">{str(payload.reviewCycle)}</span></DetailField>}
          {results && (
            <DetailField label="Reviewers">
              <div className="flex flex-wrap gap-1.5">
                {results.map((r, i) => (
                  <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    r.passed ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                  }`}>
                    {r.passed ? '\u2713' : '\u2717'} {r.role}
                  </span>
                ))}
              </div>
            </DetailField>
          )}
        </div>
      );
    }

    case 'pr_created':
      return (
        <div className="space-y-0.5">
          {has(payload, 'prNumber') && <DetailField label="PR">{`#${str(payload.prNumber)}`}</DetailField>}
          {has(payload, 'url') && <DetailField label="URL"><span className="text-accent-blue underline">{str(payload.url)}</span></DetailField>}
          {has(payload, 'branch') && <DetailField label="Branch"><span className="font-mono text-text-secondary">{str(payload.branch)}</span></DetailField>}
        </div>
      );

    case 'pr_creation_failed':
      return (
        <div className="space-y-0.5">
          {has(payload, 'error') && <DetailField label="Error"><span className="text-red-400">{str(payload.error)}</span></DetailField>}
        </div>
      );

    case 'subtasks_created':
      return (
        <div className="space-y-0.5">
          <DetailField label="Count"><span className="font-mono">{str(payload.count)}</span></DetailField>
          {Array.isArray(payload.subtasks) && (
            <DetailField label="Subtasks">
              <ul className="space-y-0.5">
                {(payload.subtasks as Array<{ title?: string; id?: number }>).map((s, i) => (
                  <li key={i} className="text-text-secondary">
                    {s.title ?? `Subtask ${s.id ?? i + 1}`}
                  </li>
                ))}
              </ul>
            </DetailField>
          )}
        </div>
      );

    case 'task_error':
      return (
        <div className="space-y-0.5">
          {has(payload, 'error') && <DetailField label="Error"><span className="text-red-400 break-words">{str(payload.error)}</span></DetailField>}
          {has(payload, 'stage') && <DetailField label="Stage"><span className="text-text-secondary">{str(payload.stage)}</span></DetailField>}
        </div>
      );

    case 'answer_provided':
      return (
        <div className="space-y-0.5">
          {has(payload, 'answers') && <DetailField label="Answer"><span className="text-text-secondary whitespace-pre-wrap">{str(payload.answers)}</span></DetailField>}
        </div>
      );

    default:
      // Fallback: render each key as a labeled field
      return (
        <div className="space-y-0.5">
          {Object.entries(payload).map(([key, value]) => (
            <DetailField key={key} label={key}>
              <span className="text-text-secondary font-mono text-[11px] break-words">
                {str(value)}
              </span>
            </DetailField>
          ))}
        </div>
      );
  }
}

function formatEventTime(dateStr: string, prevDateStr?: string): { time: string; showDate: boolean; date: string } {
  const d = new Date(dateStr);
  const time = d.toLocaleTimeString();
  const dateLabel = d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  if (!prevDateStr) return { time, showDate: true, date: dateLabel };
  const prev = new Date(prevDateStr);
  const showDate = d.toDateString() !== prev.toDateString();
  return { time, showDate, date: dateLabel };
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
      {events.map((event, idx) => {
        const payload = (() => { try { return JSON.parse(event.payload); } catch { return {}; } })();
        const colorClass = getEventColor(event.type, payload);
        const isExpanded = expanded.has(event.id);
        return (
          <div key={event.id} className="relative mb-4 cursor-pointer" role="button" tabIndex={0} onClick={() => toggleExpand(event.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(event.id); } }}>
            <div className={`absolute -left-6 top-0.5 text-sm leading-none ${colorClass}`}>{'\u25CF'}</div>
            <div className="flex gap-3 items-baseline">
              {(() => {
                const { time, showDate, date } = formatEventTime(event.createdAt, idx > 0 ? events[idx - 1].createdAt : undefined);
                return (
                  <span className="text-[11px] text-text-tertiary whitespace-nowrap min-w-[70px]">
                    {showDate && <span className="block text-[10px] text-text-quaternary font-medium">{date}</span>}
                    {time}
                  </span>
                );
              })()}
              <span className="text-[13px] text-text-primary">{summarizeEvent(event.type, payload)}</span>
            </div>
            {isExpanded && (
              <div className="relative mt-2 p-3 bg-bg-secondary rounded-md border border-border-default">
                <div className="absolute top-2 right-2">
                  <CopyButton text={JSON.stringify(payload, null, 2)} />
                </div>
                <EventDetail type={event.type} payload={payload} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
