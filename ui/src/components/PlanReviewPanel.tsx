import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import type { Task, Run, Artifact, PlanReviewAction, PlanReviewData } from '../types';

interface Props {
  task: Task;
  onReview: (id: number, action: PlanReviewAction) => Promise<Task>;
}

const inputClasses = 'w-full rounded-md bg-bg-tertiary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent resize-y';
const btnClasses = 'px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-150 cursor-pointer';

export const PlanReviewPanel: React.FC<Props> = ({ task, onReview }) => {
  const [plan, setPlan] = useState<PlanReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Editable state
  const [editingSummary, setEditingSummary] = useState(false);
  const [editedSummary, setEditedSummary] = useState('');
  const [editedSubtasks, setEditedSubtasks] = useState<Array<{ title: string; description: string }>>([]);
  const [editingSubtaskIdx, setEditingSubtaskIdx] = useState<number | null>(null);

  // Reject state
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');

    api.get<Run[]>(`/api/runs?taskId=${task.id}`)
      .then(async (runs) => {
        const planningRun = [...runs].reverse().find((r) => r.stage === 'planning' && r.status === 'success');
        if (!planningRun) {
          setError('No plan available yet. The task may still be planning.');
          return;
        }

        // Try parsing from run output first
        let planData: PlanReviewData | null = null;
        if (planningRun.output) {
          try {
            const parsed = JSON.parse(planningRun.output) as Record<string, unknown>;
            planData = {
              planSummary: (parsed.planSummary as string) || '',
              steps: Array.isArray(parsed.steps) ? parsed.steps as Array<{ title: string; description: string }> : Array.isArray(parsed.subtasks) ? parsed.subtasks as Array<{ title: string; description: string }> : [],
              assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions as string[] : [],
              fileHints: Array.isArray(parsed.fileHints) ? parsed.fileHints as string[] : [],
              riskAssessment: (parsed.riskAssessment as string) || undefined,
            };
          } catch { /* fall through to artifacts */ }
        }

        // Also check artifacts
        if (!planData) {
          const artifacts = await api.get<Artifact[]>(`/api/artifacts?runId=${planningRun.id}`);
          const planArtifact = artifacts.find((a) => a.name === 'plan_summary');
          if (planArtifact) {
            planData = {
              planSummary: planArtifact.content,
              steps: [],
              assumptions: [],
              fileHints: [],
            };
          }
        }

        if (planData) {
          setPlan(planData);
          setEditedSummary(planData.planSummary);
          setEditedSubtasks(planData.steps.map((s) => ({ ...s })));
        } else {
          setError('Could not parse plan data from planning run.');
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load plan'))
      .finally(() => setLoading(false));
  }, [task.id]);

  const hasEdits = (): boolean => {
    if (!plan) return false;
    if (editedSummary !== plan.planSummary) return true;
    if (editedSubtasks.length !== plan.steps.length) return true;
    return editedSubtasks.some((s, i) =>
      s.title !== plan.steps[i]?.title || s.description !== plan.steps[i]?.description
    );
  };

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const action: PlanReviewAction = { action: 'approve' };
      if (hasEdits()) {
        action.edits = {
          planSummary: editedSummary,
          steps: editedSubtasks,
        };
      }
      await onReview(task.id, action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve plan');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setSubmitting(true);
    try {
      await onReview(task.id, { action: 'reject', reason: rejectReason.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject plan');
    } finally {
      setSubmitting(false);
    }
  };

  const addSubtask = () => {
    setEditedSubtasks([...editedSubtasks, { title: '', description: '' }]);
    setEditingSubtaskIdx(editedSubtasks.length);
  };

  const removeSubtask = (idx: number) => {
    setEditedSubtasks(editedSubtasks.filter((_, i) => i !== idx));
    if (editingSubtaskIdx === idx) setEditingSubtaskIdx(null);
  };

  const updateSubtask = (idx: number, field: 'title' | 'description', value: string) => {
    setEditedSubtasks(editedSubtasks.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  if (loading) {
    return (
      <div className="mb-4 pb-4 border-b border-border-default">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-accent-amber mb-2">Plan Review</h4>
        <div className="space-y-2">
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
          <div className="skeleton h-20 w-full rounded-md" />
        </div>
      </div>
    );
  }

  if (error && !plan) {
    return (
      <div className="mb-4 pb-4 border-b border-border-default">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-accent-amber mb-2">Plan Review</h4>
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-md p-3 text-sm text-accent-red">
          {error}
        </div>
      </div>
    );
  }

  if (!plan) return null;

  return (
    <div className="mb-4 pb-4 border-b border-border-default">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-accent-amber mb-3">Plan Review</h4>

      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-md p-2 text-[11px] text-accent-red mb-3">
          {error}
        </div>
      )}

      {/* Approach Summary */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Approach</span>
          <button
            type="button"
            onClick={() => setEditingSummary(!editingSummary)}
            className="text-[10px] text-accent-blue hover:underline cursor-pointer"
          >
            {editingSummary ? 'Done' : 'Edit'}
          </button>
        </div>
        {editingSummary ? (
          <textarea
            value={editedSummary}
            onChange={(e) => setEditedSummary(e.target.value)}
            className={`${inputClasses} min-h-[80px]`}
          />
        ) : (
          <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed bg-bg-tertiary rounded-md p-3 border border-border-default">
            {editedSummary || plan.planSummary}
          </p>
        )}
      </div>

      {/* Subtasks */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
            Steps ({editedSubtasks.length})
          </span>
          <button
            type="button"
            onClick={addSubtask}
            className="text-[10px] text-accent-blue hover:underline cursor-pointer"
          >
            + Add
          </button>
        </div>
        {editedSubtasks.length === 0 ? (
          <p className="text-[11px] text-text-tertiary italic">No steps — task will be implemented directly.</p>
        ) : (
          <div className="space-y-2">
            {editedSubtasks.map((sub, i) => (
              <div key={i} className="bg-bg-tertiary rounded-md border border-border-default p-2.5 group">
                {editingSubtaskIdx === i ? (
                  <div className="space-y-1.5">
                    <input
                      value={sub.title}
                      onChange={(e) => updateSubtask(i, 'title', e.target.value)}
                      className={`${inputClasses} !min-h-0 py-1.5`}
                      placeholder="Step title"
                    />
                    <textarea
                      value={sub.description}
                      onChange={(e) => updateSubtask(i, 'description', e.target.value)}
                      className={`${inputClasses} min-h-[50px]`}
                      placeholder="Description"
                    />
                    <button
                      type="button"
                      onClick={() => setEditingSubtaskIdx(null)}
                      className="text-[10px] text-accent-blue hover:underline cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-text-tertiary font-mono">{i + 1}.</span>
                        <span className="text-sm font-medium text-text-primary">{sub.title || 'Untitled'}</span>
                      </div>
                      {sub.description && (
                        <p className="text-[11px] text-text-secondary mt-0.5 line-clamp-2">{sub.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                      <button
                        type="button"
                        onClick={() => setEditingSubtaskIdx(i)}
                        className="p-1 text-text-tertiary hover:text-accent-blue rounded transition-colors cursor-pointer"
                        title="Edit"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSubtask(i)}
                        className="p-1 text-text-tertiary hover:text-accent-red rounded transition-colors cursor-pointer"
                        title="Remove"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assumptions */}
      {plan.assumptions.length > 0 && (
        <div className="mb-4">
          <span className="text-[11px] font-semibold text-accent-amber uppercase tracking-wide">Assumptions</span>
          <div className="bg-accent-amber/10 border border-accent-amber/30 rounded-md p-2.5 mt-1">
            <ul className="list-disc list-inside text-[11px] text-text-primary space-y-0.5">
              {plan.assumptions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* File Scope */}
      {plan.fileHints.length > 0 && (
        <div className="mb-4">
          <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">File Scope</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {plan.fileHints.map((f, i) => (
              <span key={i} className="text-[10px] font-mono bg-bg-tertiary text-text-secondary px-1.5 py-0.5 rounded border border-border-default">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Risk Assessment */}
      {plan.riskAssessment && (
        <div className="mb-4">
          <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Risk Assessment</span>
          <p className="text-[11px] text-text-secondary mt-0.5">{plan.riskAssessment}</p>
        </div>
      )}

      {/* Actions */}
      {!showReject ? (
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={handleApprove}
            disabled={submitting}
            className={`${btnClasses} bg-accent-green text-white ${submitting ? 'opacity-60' : 'hover:bg-green-600'}`}
          >
            {submitting ? 'Approving...' : hasEdits() ? 'Approve with Changes' : 'Approve Plan'}
          </button>
          <button
            type="button"
            onClick={() => setShowReject(true)}
            className={`${btnClasses} border border-accent-red text-accent-red hover:bg-accent-red hover:text-white`}
          >
            Reject
          </button>
          {hasEdits() && (
            <span className="text-[10px] text-accent-blue ml-2">Changes will be applied</span>
          )}
        </div>
      ) : (
        <div className="pt-2 space-y-2">
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className={`${inputClasses} min-h-[60px]`}
            placeholder="Why is this plan being rejected? What should change? (required)"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReject}
              disabled={submitting || !rejectReason.trim()}
              className={`${btnClasses} bg-accent-red text-white ${submitting || !rejectReason.trim() ? 'opacity-60' : 'hover:bg-red-600'}`}
            >
              {submitting ? 'Rejecting...' : 'Reject & Re-plan'}
            </button>
            <button
              type="button"
              onClick={() => { setShowReject(false); setRejectReason(''); }}
              className={`${btnClasses} text-text-secondary border border-border-default hover:bg-bg-tertiary`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
