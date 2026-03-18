import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Task, TaskStatus } from '../types';

interface EventRecord { id: string; taskId: number; type: string; payload: string; createdAt: string }

interface Props {
  task: Task;
  onMove: (id: number, column: TaskStatus) => Promise<unknown>;
}

export const PRPanel: React.FC<Props> = ({ task, onMove }) => {
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    api.get<EventRecord[]>(`/api/events?taskId=${task.id}`).then((events) => {
      const prEvent = events.find((e) => e.type === 'pr_created');
      if (prEvent) {
        try { const payload = JSON.parse(prEvent.payload) as { prUrl?: string }; if (payload.prUrl) setPrUrl(payload.prUrl); } catch {}
      }
    }).catch(console.error);
  }, [task.id]);

  const handleMarkDone = async () => {
    setMarking(true);
    try { await onMove(task.id, 'done'); } catch (err) { console.error('Failed to mark as done:', err); } finally { setMarking(false); }
  };

  return (
    <div className="mb-4 p-4 rounded-lg border-t-2 border-t-accent-green bg-bg-tertiary border border-border-default">
      <h4 className="text-xs font-bold uppercase tracking-wider text-accent-green mb-2">Pull Request</h4>
      {prUrl ? (
        <div className="mb-3">
          <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent-blue hover:underline">
            {prUrl}
          </a>
        </div>
      ) : (
        <p className="text-sm text-text-secondary mb-3">PR URL not available. Check the run history.</p>
      )}
      <button onClick={handleMarkDone} disabled={marking}
        className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-green text-white hover:bg-green-600 transition-colors disabled:opacity-50">
        {marking ? 'Marking...' : 'Mark as Done'}
      </button>
    </div>
  );
};
