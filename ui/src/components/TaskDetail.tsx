import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../api/client';
import { LogViewer } from './LogViewer';
import { BlockedPanel } from './BlockedPanel';
import { PRPanel } from './PRPanel';
import { RunHistory } from './RunHistory';
import type { Task, TaskStatus, Run, SpecTemplate } from '../types';

interface Props {
  task: Task;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<Task>) => Promise<Task>;
  onAnswer: (id: string, answers: string) => Promise<Task>;
  onRetry: (id: string) => Promise<Task>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (task: Task) => void;
  onMove: (id: string, column: TaskStatus) => Promise<Task>;
}

const AssumptionsPanel: React.FC<{ runs: Run[] }> = ({ runs }) => {
  const [assumptions, setAssumptions] = useState<string[]>([]);

  useEffect(() => {
    const planningRun = runs.find((r) => r.stage === 'planning' && r.status === 'success');
    if (!planningRun) {
      setAssumptions([]);
      return;
    }
    api.get<Array<{ type: string; content: string }>>(`/api/artifacts?runId=${planningRun.id}`)
      .then((artifacts) => {
        const found = artifacts.find((a) => a.type === 'assumptions');
        if (found) {
          try {
            setAssumptions(JSON.parse(found.content) as string[]);
          } catch {
            setAssumptions([]);
          }
        } else {
          setAssumptions([]);
        }
      })
      .catch(console.error);
  }, [runs]);

  if (assumptions.length === 0) return null;

  return (
    <div className="mb-4 pb-4 border-b border-border-default">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-accent-amber mb-1.5">Assumptions</h4>
      <div className="bg-accent-amber/10 border border-accent-amber/30 rounded-md p-3">
        <p className="text-[11px] text-accent-amber mb-2">These decisions were made autonomously. Verify during PR review.</p>
        <ul className="list-disc list-inside text-sm text-text-primary space-y-1">
          {assumptions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      </div>
    </div>
  );
};

const statusBadgeColor: Record<string, string> = {
  backlog: 'text-text-tertiary', ready: 'text-accent-blue', planning: 'text-accent-purple',
  implementing: 'text-accent-purple', checks: 'text-accent-purple', review_spec: 'text-accent-purple',
  review_code: 'text-accent-purple', needs_human_review: 'text-accent-pink', done: 'text-accent-green',
  blocked: 'text-accent-amber', failed: 'text-accent-red', cancelled: 'text-text-tertiary',
};

const riskTextColor: Record<string, string> = {
  high: 'text-accent-red', medium: 'text-accent-amber', low: 'text-accent-green',
};

export const TaskDetail: React.FC<Props> = ({ task, onClose, onUpdate, onAnswer, onRetry, onDelete, onEdit, onMove }) => {
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    api.get<Run[]>(`/api/runs?taskId=${task.id}`).then(setRuns).catch(console.error);
  }, [task.id]);

  let spec: Partial<SpecTemplate> | null = null;
  if (task.spec) {
    try { spec = JSON.parse(task.spec) as Partial<SpecTemplate>; } catch {}
  }

  const isAgentActive = ['planning', 'implementing', 'checks', 'review_spec', 'review_code'].includes(task.status);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[1000]" />
        <Dialog.Content className="fixed top-[10vh] left-1/2 -translate-x-1/2 bg-bg-elevated rounded-xl p-6 w-[90%] max-w-[720px] max-h-[80vh] overflow-y-auto z-[1001] shadow-2xl border border-border-default">
          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-white">{task.title}</Dialog.Title>
              <div className="flex items-center gap-2 mt-1 text-xs">
                <span className={statusBadgeColor[task.status] || 'text-text-tertiary'}>{task.status.replace(/_/g, ' ')}</span>
                <span className="text-text-tertiary">·</span>
                <span className={riskTextColor[task.riskLevel] || 'text-text-tertiary'}>{task.riskLevel} risk</span>
                <span className="text-text-tertiary">·</span>
                <span className="text-text-tertiary">P{task.priority}</span>
              </div>
              <Link to={`/tasks/${task.id}`} onClick={onClose} className="text-xs text-accent-blue hover:underline mt-1 inline-block">
                View Details →
              </Link>
            </div>
            <Dialog.Close className="text-text-tertiary hover:text-text-primary text-2xl leading-none">×</Dialog.Close>
          </div>

          {/* Description */}
          {task.description && (
            <div className="mb-4 pb-4 border-b border-border-default">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Description</h4>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Spec */}
          {spec && (
            <div className="mb-4 pb-4 border-b border-border-default">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Spec</h4>
              {Object.entries(spec).map(([key, val]) =>
                val ? (
                  <div key={key} className="mb-2">
                    <div className="text-[11px] font-semibold text-text-tertiary capitalize">{key.replace(/([A-Z])/g, ' $1')}</div>
                    <p className="text-sm text-text-primary whitespace-pre-wrap mt-0.5">{val}</p>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* Assumptions */}
          <AssumptionsPanel runs={runs} />

          {/* Status-specific panels */}
          {task.status === 'blocked' && task.blockedReason && (
            <BlockedPanel taskId={task.id} blockedReason={task.blockedReason} onAnswer={onAnswer} />
          )}
          {task.status === 'needs_human_review' && <PRPanel task={task} onMove={onMove} />}
          {task.status === 'failed' && (
            <div className="mb-4">
              <button onClick={() => onRetry(task.id)} className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-red text-white hover:bg-red-600 transition-colors">
                Retry Task
              </button>
            </div>
          )}

          {/* Live logs */}
          {isAgentActive && (
            <div className="mb-4 pb-4 border-b border-border-default">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Live Logs</h4>
              <LogViewer taskId={task.id} />
            </div>
          )}

          {/* Run history */}
          <div className="mb-4 pb-4 border-b border-border-default">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Runs ({runs.length})</h4>
            <RunHistory runs={runs} />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button onClick={() => onEdit(task)} className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-blue text-white hover:bg-blue-600 transition-colors">Edit</button>
            <button
              onClick={async () => { if (confirm('Delete this task?')) { await onDelete(task.id); onClose(); } }}
              className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-red text-white hover:bg-red-600 transition-colors"
            >Delete</button>
            <Link to={`/tasks/${task.id}`} onClick={onClose} className="ml-auto text-sm text-accent-blue hover:underline">
              View Details →
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
