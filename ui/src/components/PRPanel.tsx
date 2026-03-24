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
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState('');

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
      <div className="flex gap-2 flex-wrap">
        <button onClick={handleMarkDone} disabled={marking}
          className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-green text-white hover:bg-green-600 transition-colors disabled:opacity-50">
          {marking ? 'Marking...' : 'Mark as Done'}
        </button>
        <button onClick={() => setShowReject(!showReject)}
          className="px-4 py-2 rounded-md text-sm font-semibold border border-accent-amber text-accent-amber hover:bg-accent-amber hover:text-white transition-colors">
          Request Changes
        </button>
        <button onClick={async () => { setMarking(true); try { await onMove(task.id, 'failed' as TaskStatus); } catch (err) { console.error('Reject failed:', err); } finally { setMarking(false); } }} disabled={marking}
          className="px-4 py-2 rounded-md text-sm font-semibold border border-accent-red text-accent-red hover:bg-accent-red hover:text-white transition-colors disabled:opacity-50">
          Reject
        </button>
      </div>
      {showReject && (
        <div className="mt-3 flex gap-2">
          <input type="text" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason for changes..."
            className="flex-1 rounded-md px-3 py-2 text-sm bg-bg-secondary border border-border-default text-text-primary placeholder-text-tertiary" />
          <button onClick={async () => {
              setMarking(true);
              setError('');
              try {
                // Set blocked reason first, then move to blocked
                await api.put(`/api/tasks/${task.id}`, { blockedReason: `Changes requested: ${rejectReason.trim()}` });
                await onMove(task.id, 'blocked' as TaskStatus);
                setShowReject(false);
                setRejectReason('');
              } catch (err) {
                console.error('Request changes failed:', err);
                setError(err instanceof Error ? err.message : 'Failed to request changes');
              }
              finally { setMarking(false); }
            }} disabled={!rejectReason.trim() || marking}
            className="px-3 py-2 rounded-md text-sm font-semibold bg-accent-amber text-white hover:bg-amber-600 transition-colors disabled:opacity-50">
            Submit
          </button>
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm text-accent-red">{error}</p>
      )}
    </div>
  );
};
