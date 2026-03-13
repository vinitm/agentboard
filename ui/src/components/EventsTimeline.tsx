import React, { useState, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket';

interface EventRecord {
  id: string;
  taskId: string;
  runId: string | null;
  type: string;
  payload: string;
  createdAt: string;
}

interface Props {
  taskId: string;
  events: EventRecord[];
}

const EVENT_STYLES: Record<string, { icon: string; color: string }> = {
  status_changed: { icon: '\u25CF', color: '#3b82f6' },
  implementation_failed: { icon: '\u25CF', color: '#ef4444' },
  checks_failed: { icon: '\u25CF', color: '#ef4444' },
  review_spec_failed: { icon: '\u25CF', color: '#ef4444' },
  review_code_failed: { icon: '\u25CF', color: '#ef4444' },
  pr_created: { icon: '\u25CF', color: '#22c55e' },
  task_created: { icon: '\u25CF', color: '#9ca3af' },
  subtasks_created: { icon: '\u25CF', color: '#9ca3af' },
  task_error: { icon: '\u25B2', color: '#ef4444' },
  answer_provided: { icon: '\u25CF', color: '#8b5cf6' },
};

function getEventStyle(type: string, payload: Record<string, unknown>): { icon: string; color: string } {
  if (type === 'status_changed' && payload.to === 'blocked') {
    return { icon: '\u25CF', color: '#f59e0b' };
  }
  return EVENT_STYLES[type] ?? { icon: '\u25CF', color: '#9ca3af' };
}

function summarizeEvent(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'status_changed':
      return `Status changed: ${payload.from} \u2192 ${payload.to}${payload.reason ? ` (${payload.reason})` : ''}`;
    case 'implementation_failed':
      return `Implementation failed (attempt ${payload.attempt})`;
    case 'checks_failed':
      return `Checks failed (attempt ${payload.attempt})`;
    case 'review_spec_failed':
      return `Spec review failed (cycle ${payload.reviewCycle})`;
    case 'review_code_failed':
      return `Code review failed (cycle ${payload.reviewCycle})`;
    case 'pr_created':
      return `PR #${payload.prNumber} created`;
    case 'pr_creation_failed':
      return `PR creation failed: ${payload.error}`;
    case 'task_created':
      return 'Task created';
    case 'subtasks_created':
      return `${payload.count} subtasks created`;
    case 'task_error':
      return `Error: ${(payload.error as string)?.slice(0, 100)}`;
    case 'answer_provided':
      return 'Human provided answers';
    default:
      return type.replace(/_/g, ' ');
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      style={{
        float: 'right',
        background: '#313244',
        color: '#cdd6f4',
        border: '1px solid #45475a',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export const EventsTimeline: React.FC<Props> = ({ taskId, events: initialEvents }) => {
  const [events, setEvents] = useState<EventRecord[]>(initialEvents);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const socket = useSocket();

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  useEffect(() => {
    if (!socket) return;
    const onEvent = (event: EventRecord) => {
      if (event.taskId === taskId) {
        setEvents((prev) =>
          prev.some((e) => e.id === event.id) ? prev : [...prev, event]
        );
      }
    };
    socket.on('task:event', onEvent);
    return () => { socket.off('task:event', onEvent); };
  }, [socket, taskId]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (events.length === 0) {
    return <div style={{ color: '#9ca3af', padding: 20, textAlign: 'center' }}>No events yet</div>;
  }

  return (
    <div style={{ position: 'relative', paddingLeft: 28 }}>
      {/* Vertical line */}
      <div
        style={{
          position: 'absolute',
          left: 8,
          top: 4,
          bottom: 4,
          width: 2,
          background: '#e5e7eb',
        }}
      />

      {events.map((event) => {
        const payload = (() => { try { return JSON.parse(event.payload); } catch { return {}; } })();
        const style = getEventStyle(event.type, payload);
        const isExpanded = expanded.has(event.id);

        return (
          <div
            key={event.id}
            style={{ position: 'relative', marginBottom: 16, cursor: 'pointer' }}
            onClick={() => toggleExpand(event.id)}
          >
            {/* Icon */}
            <div
              style={{
                position: 'absolute',
                left: -24,
                top: 2,
                fontSize: 14,
                color: style.color,
                lineHeight: 1,
              }}
            >
              {style.icon}
            </div>

            {/* Content */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', minWidth: 70 }}>
                {new Date(event.createdAt).toLocaleTimeString()}
              </span>
              <span style={{ fontSize: 13, color: '#374151' }}>
                {summarizeEvent(event.type, payload)}
              </span>
            </div>

            {/* Expanded payload */}
            {isExpanded && (
              <pre
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: '#1e293b',
                  color: '#e2e8f0',
                  borderRadius: 6,
                  position: 'relative',
                  fontSize: 12,
                  overflow: 'auto',
                  maxHeight: 300,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                <CopyButton text={JSON.stringify(payload, null, 2)} />
                {JSON.stringify(payload, null, 2)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
};
