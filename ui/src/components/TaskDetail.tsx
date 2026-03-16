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

interface EventRecord { id: string; taskId: string; runId: string | null; type: string; payload: string; createdAt: string }

const PIPELINE_STAGES = ['spec', 'planning', 'implementing', 'checks', 'review_panel'] as const;
const STAGE_LABELS: Record<string, string> = {
  spec: 'Spec', planning: 'Planning', implementing: 'Implementing', checks: 'Checks', review_panel: 'Review',
};

function getStageIndex(status: string): number {
  return PIPELINE_STAGES.indexOf(status as typeof PIPELINE_STAGES[number]);
}

const PipelineProgress: React.FC<{ status: string }> = ({ status }) => {
  const currentIdx = getStageIndex(status);
  const isDone = status === 'done' || status === 'needs_human_review';
  const isFailed = status === 'failed';

  return (
    <div className="flex items-center gap-1 mb-4 pb-4 border-b border-border-default">
      {PIPELINE_STAGES.map((stage, i) => {
        let stateClass = 'bg-bg-tertiary text-text-tertiary'; // future
        if (isDone || (currentIdx >= 0 && i < currentIdx)) {
          stateClass = 'bg-accent-green/15 text-accent-green border-accent-green/30'; // completed
        } else if (isFailed && i === currentIdx) {
          stateClass = 'bg-accent-red/15 text-accent-red border-accent-red/30'; // failed
        } else if (i === currentIdx) {
          stateClass = 'bg-accent-purple/15 text-accent-purple border-accent-purple/30'; // active
        }
        return (
          <React.Fragment key={stage}>
            <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border ${stateClass} transition-colors`}>
              {isDone || (currentIdx >= 0 && i < currentIdx) ? (
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : i === currentIdx ? (
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-dot" />
              ) : null}
              {STAGE_LABELS[stage]}
            </div>
            {i < PIPELINE_STAGES.length - 1 && (
              <div className={`w-4 h-px flex-shrink-0 ${
                isDone || (currentIdx >= 0 && i < currentIdx) ? 'bg-accent-green' : 'bg-border-default'
              }`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

interface ReviewResult { role: string; passed: boolean; feedback?: string }

const ReviewPanelResults: React.FC<{ events: EventRecord[] }> = ({ events }) => {
  const reviewEvents = events.filter((e) => e.type === 'review_panel_completed' || e.type === 'review_panel_failed');
  if (reviewEvents.length === 0) return null;

  const latest = reviewEvents[reviewEvents.length - 1];
  const payload = (() => { try { return JSON.parse(latest.payload); } catch { return {}; } })() as { results?: ReviewResult[]; reviewCycle?: number };
  if (!payload.results) return null;

  return (
    <div className="mb-4 pb-4 border-b border-border-default">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-2">
        Review Panel <span className="text-text-tertiary font-normal">(cycle {payload.reviewCycle})</span>
      </h4>
      <div className="flex gap-2">
        {payload.results.map((r, i) => (
          <div key={i} className={`flex-1 rounded-lg border p-2.5 ${
            r.passed
              ? 'border-accent-green/30 bg-accent-green/5'
              : 'border-accent-red/30 bg-accent-red/5'
          }`}>
            <div className="flex items-center gap-1.5 mb-1">
              {r.passed ? (
                <svg className="w-3.5 h-3.5 text-accent-green" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-accent-red" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              )}
              <span className={`text-xs font-semibold capitalize ${r.passed ? 'text-accent-green' : 'text-accent-red'}`}>
                {r.role}
              </span>
            </div>
            {r.feedback && (
              <p className="text-[11px] text-text-secondary line-clamp-3">{r.feedback}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

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
  backlog: 'text-text-tertiary', ready: 'text-accent-blue', spec: 'text-accent-purple', planning: 'text-accent-purple',
  implementing: 'text-accent-purple', checks: 'text-accent-purple', review_panel: 'text-accent-purple',
  needs_human_review: 'text-accent-pink', done: 'text-accent-green',
  blocked: 'text-accent-amber', failed: 'text-accent-red', cancelled: 'text-text-tertiary',
};

const riskTextColor: Record<string, string> = {
  high: 'text-accent-red', medium: 'text-accent-amber', low: 'text-accent-green',
};

export const TaskDetail: React.FC<Props> = ({ task, onClose, onUpdate, onAnswer, onRetry, onDelete, onEdit, onMove }) => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);

  useEffect(() => {
    api.get<Run[]>(`/api/runs?taskId=${task.id}`).then(setRuns).catch(console.error);
    api.get<EventRecord[]>(`/api/events?taskId=${task.id}`).then(setEvents).catch(console.error);
  }, [task.id]);

  let spec: Partial<SpecTemplate> | null = null;
  if (task.spec) {
    try { spec = JSON.parse(task.spec) as Partial<SpecTemplate>; } catch {}
  }

  const isAgentActive = ['spec', 'planning', 'implementing', 'checks', 'review_panel'].includes(task.status);
  const isSubtask = !!task.parentTaskId;
  const showPipeline = !isSubtask && (isAgentActive || task.status === 'done' || task.status === 'needs_human_review' || task.status === 'failed');

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-[1000]" />
        <Dialog.Content className="fixed top-[8vh] left-1/2 -translate-x-1/2 bg-bg-elevated rounded-xl p-6 w-[90%] max-w-[720px] max-h-[84vh] overflow-y-auto z-[1001] shadow-2xl border border-border-default animate-fade-in">
          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-lg font-semibold text-white">{task.title}</Dialog.Title>
              <div className="flex items-center gap-2 mt-1.5 text-xs flex-wrap">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-tertiary font-medium ${statusBadgeColor[task.status] || 'text-text-tertiary'}`}>
                  {isAgentActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-dot" />
                  )}
                  {task.status.replace(/_/g, ' ')}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full bg-bg-tertiary font-medium ${riskTextColor[task.riskLevel] || 'text-text-tertiary'}`}>
                  {task.riskLevel} risk
                </span>
                {task.priority > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary font-medium">
                    P{task.priority}
                  </span>
                )}
              </div>
              <Link to={`/tasks/${task.id}`} onClick={onClose} className="text-xs text-accent-blue hover:underline mt-2 inline-block">
                View Full Details →
              </Link>
            </div>
            <Dialog.Close className="text-text-tertiary hover:text-text-primary transition-colors ml-4 p-1 rounded-md hover:bg-bg-tertiary">
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </Dialog.Close>
          </div>

          {/* Pipeline progress */}
          {showPipeline && <PipelineProgress status={task.status} />}

          {/* Description */}
          {task.description && (
            <div className="mb-4 pb-4 border-b border-border-default">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Description</h4>
              <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{task.description}</p>
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
                    <p className="text-sm text-text-primary whitespace-pre-wrap mt-0.5 leading-relaxed">{val}</p>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* Assumptions */}
          <AssumptionsPanel runs={runs} />

          {/* Review panel results */}
          <ReviewPanelResults events={events} />

          {/* Status-specific panels */}
          {task.status === 'blocked' && task.blockedReason && (
            <BlockedPanel taskId={task.id} blockedReason={task.blockedReason} onAnswer={onAnswer} />
          )}
          {task.status === 'needs_human_review' && <PRPanel task={task} onMove={onMove} />}
          {task.status === 'failed' && !isSubtask && (
            <div className="mb-4">
              <button onClick={() => onRetry(task.id)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent-red text-white hover:bg-red-600 transition-colors">
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
            <button onClick={() => onEdit(task)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent-blue text-white hover:bg-blue-600 transition-colors">Edit</button>
            <button
              onClick={async () => { if (confirm('Delete this task?')) { await onDelete(task.id); onClose(); } }}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-accent-red text-accent-red hover:bg-accent-red hover:text-white transition-colors"
            >Delete</button>
            <Link to={`/tasks/${task.id}`} onClick={onClose} className="ml-auto text-sm text-accent-blue hover:underline">
              View Full Details →
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
