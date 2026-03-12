import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Task, TaskStatus } from '../types';

interface EventRecord {
  id: string;
  taskId: string;
  type: string;
  payload: string;
  createdAt: string;
}

interface Props {
  task: Task;
  onMove: (id: string, column: TaskStatus) => Promise<unknown>;
}

export const PRPanel: React.FC<Props> = ({ task, onMove }) => {
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    // Find the PR URL from task events
    api
      .get<EventRecord[]>(`/api/events?taskId=${task.id}`)
      .then((events) => {
        const prEvent = events.find((e) => e.type === 'pr_created');
        if (prEvent) {
          try {
            const payload = JSON.parse(prEvent.payload) as { prUrl?: string };
            if (payload.prUrl) {
              setPrUrl(payload.prUrl);
            }
          } catch {
            // ignore parse error
          }
        }
      })
      .catch(console.error);
  }, [task.id]);

  const handleMarkDone = async () => {
    setMarking(true);
    try {
      await onMove(task.id, 'done');
    } catch (err) {
      console.error('Failed to mark as done:', err);
    } finally {
      setMarking(false);
    }
  };

  return (
    <div style={containerStyle}>
      <h4 style={titleStyle}>Pull Request</h4>
      {prUrl ? (
        <div style={{ marginBottom: 12 }}>
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#2563eb', fontSize: 14, fontWeight: 600 }}
          >
            {prUrl}
          </a>
        </div>
      ) : (
        <p style={{ margin: '0 0 12px', fontSize: 14, color: '#6b7280' }}>
          PR URL not available. The PR may have failed to create — check the run history.
        </p>
      )}
      <button onClick={handleMarkDone} disabled={marking} style={doneBtnStyle}>
        {marking ? 'Marking...' : 'Mark as Done'}
      </button>
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  background: '#ecfdf5',
  border: '1px solid #22c55e',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 14,
  fontWeight: 700,
  color: '#15803d',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const doneBtnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: '8px 16px',
  background: '#22c55e',
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};
