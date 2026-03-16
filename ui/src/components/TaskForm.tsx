import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../api/client';
import type { Task, RiskLevel, SpecTemplate, DecisionPoint } from '../types';

interface Props {
  initial?: Task | null;
  onSubmit: (data: { title: string; description: string; spec: string; riskLevel: RiskLevel; priority: number }) => Promise<void>;
  onCancel: () => void;
}

function parseSpec(spec: string | null): SpecTemplate {
  const empty: SpecTemplate = { context: '', acceptanceCriteria: '', constraints: '', verification: '', riskLevel: 'low', infrastructureAllowed: '' };
  if (!spec) return empty;
  try { return { ...empty, ...(JSON.parse(spec) as Partial<SpecTemplate>) }; } catch { return empty; }
}

type Phase = 'describe' | 'decisions' | 'preview';

const inputClasses = 'w-full rounded-md bg-bg-tertiary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent resize-y';
const btnClasses = 'px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-150 cursor-pointer';

export const TaskForm: React.FC<Props> = ({ initial, onSubmit, onCancel }) => {
  const isEditing = !!initial;
  const [phase, setPhase] = useState<Phase>(isEditing ? 'preview' : 'describe');
  const [shortDescription, setShortDescription] = useState('');
  const [parsing, setParsing] = useState(false);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [riskLevel, setRiskLevel] = useState<RiskLevel>(initial?.riskLevel ?? 'low');
  const [priority, setPriority] = useState(initial?.priority ?? 0);
  const [spec, setSpec] = useState<SpecTemplate>(() => parseSpec(initial?.spec ?? null));
  const [decisionPoints, setDecisionPoints] = useState<DecisionPoint[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleParse = async () => {
    if (!shortDescription.trim()) { setError('Please describe the task'); return; }
    setError(''); setParsing(true);
    try {
      const parsed = await api.post<{ title: string; description: string; riskLevel: RiskLevel; priority: number; spec: { context: string; acceptanceCriteria: string; constraints: string; verification: string; infrastructureAllowed: string }; decisionPoints?: DecisionPoint[] }>('/api/tasks/parse', { description: shortDescription.trim() });
      setTitle(parsed.title || ''); setDescription(parsed.description || '');
      setRiskLevel(parsed.riskLevel || 'low'); setPriority(parsed.priority || 0);
      if (parsed.spec) setSpec({ context: parsed.spec.context || '', acceptanceCriteria: parsed.spec.acceptanceCriteria || '', constraints: parsed.spec.constraints || '', verification: parsed.spec.verification || '', riskLevel: parsed.riskLevel || 'low', infrastructureAllowed: parsed.spec.infrastructureAllowed || '' });
      if (Array.isArray(parsed.decisionPoints) && parsed.decisionPoints.length > 0) {
        setDecisionPoints(parsed.decisionPoints);
        setSelectedOptions(parsed.decisionPoints.map((dp: { defaultIndex: number }) => dp.defaultIndex));
        setPhase('decisions');
      } else {
        setPhase('preview');
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to parse task'); } finally { setParsing(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    setSubmitting(true);
    try { await onSubmit({ title: title.trim(), description: description.trim(), spec: JSON.stringify({ ...spec, riskLevel }), riskLevel, priority }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[1000]" />
        <Dialog.Content className="fixed top-[10vh] left-1/2 -translate-x-1/2 bg-bg-elevated rounded-xl p-6 w-[90%] max-w-[600px] max-h-[80vh] overflow-y-auto z-[1001] shadow-2xl border border-border-default">
          {phase === 'describe' && (
            <>
              <Dialog.Title className="text-lg font-semibold text-white mb-1">New Task</Dialog.Title>
              <p className="text-xs text-text-secondary mb-3">Describe what you need done. Fields will be auto-filled.</p>
              {error && <div className="text-accent-red text-sm mb-3">{error}</div>}
              <textarea
                value={shortDescription} onChange={(e) => setShortDescription(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleParse(); } }}
                className={`${inputClasses} min-h-[80px]`}
                placeholder='e.g. "Add rate limiting to the /api/upload endpoint, max 10 req/min per user"'
                autoFocus disabled={parsing}
              />
              <div className="flex gap-2 mt-4">
                <button onClick={handleParse} disabled={parsing} className={`${btnClasses} bg-accent-blue text-white ${parsing ? 'opacity-60' : 'hover:bg-blue-600'}`}>
                  {parsing ? 'Parsing...' : 'Auto-fill'}
                </button>
                <button onClick={() => setPhase('preview')} className={`${btnClasses} text-text-secondary border border-border-default hover:bg-bg-tertiary`}>Fill manually</button>
                <button onClick={onCancel} className={`${btnClasses} bg-text-tertiary text-white hover:bg-gray-600`}>Cancel</button>
              </div>
            </>
          )}

          {phase === 'decisions' && (
            <>
              <Dialog.Title className="text-lg font-semibold text-white mb-1">Quick Decisions</Dialog.Title>
              <p className="text-xs text-text-secondary mb-4">These help the AI make better choices. Defaults are pre-selected — just click Continue if they look right.</p>
              {error && <div className="text-accent-red text-sm mb-3">{error}</div>}
              {decisionPoints.map((dp, i) => (
                <div key={i} className="mb-4 pb-3 border-b border-border-default last:border-0">
                  <div className="text-sm font-medium text-text-primary mb-2">{dp.question}</div>
                  <div className="flex flex-col gap-1.5">
                    {dp.options.map((opt, j) => (
                      <label key={j} className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary">
                        <input
                          type="radio"
                          name={`decision-${i}`}
                          checked={selectedOptions[i] === j}
                          onChange={() => {
                            const next = [...selectedOptions];
                            next[i] = j;
                            setSelectedOptions(next);
                          }}
                          className="accent-accent-blue"
                        />
                        {opt}
                        {j === dp.defaultIndex && <span className="text-[10px] text-accent-blue">(recommended)</span>}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    const updatedSpec = { ...spec };
                    for (let i = 0; i < decisionPoints.length; i++) {
                      const dp = decisionPoints[i];
                      const answer = dp.options[selectedOptions[i]];
                      const field = dp.specField as keyof typeof updatedSpec;
                      if (field in updatedSpec && field !== 'riskLevel') {
                        const existing = updatedSpec[field] as string;
                        (updatedSpec as Record<string, string>)[field] = existing
                          ? `${existing}\n- Decision: ${dp.question} → ${answer}`
                          : `- Decision: ${dp.question} → ${answer}`;
                      }
                    }
                    setSpec(updatedSpec);
                    setPhase('preview');
                  }}
                  className={`${btnClasses} bg-accent-blue text-white hover:bg-blue-600`}
                >
                  Continue
                </button>
                <button onClick={() => setPhase('preview')} className={`${btnClasses} text-text-secondary border border-border-default hover:bg-bg-tertiary`}>Skip</button>
                <button onClick={() => setPhase('describe')} className={`${btnClasses} text-text-secondary border border-border-default hover:bg-bg-tertiary`}>← Back</button>
              </div>
            </>
          )}

          {phase === 'preview' && (
            <form onSubmit={handleSubmit}>
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-lg font-semibold text-white">{isEditing ? 'Edit Task' : 'Review & Create'}</Dialog.Title>
                {!isEditing && <button type="button" onClick={() => setPhase('describe')} className="text-xs text-accent-blue hover:underline">← Back</button>}
              </div>
              {error && <div className="text-accent-red text-sm mb-3">{error}</div>}

              <label className="block text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClasses} placeholder="Task title" />

              <label className="block text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1 mt-3">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputClasses} min-h-[60px]`} placeholder="Brief description" />

              <div className="flex gap-3 mt-3">
                <div className="flex-1">
                  <label className="block text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Risk Level</label>
                  <select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value as RiskLevel)} className={inputClasses}>
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Priority</label>
                  <input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value) || 0)} className={inputClasses} min={0} />
                </div>
              </div>

              <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mt-5 mb-2">Spec Template</h3>
              {(['context', 'acceptanceCriteria', 'constraints', 'verification', 'infrastructureAllowed'] as const).map((field) => (
                <div key={field} className="mb-3">
                  <label className="block text-[11px] font-semibold text-text-tertiary capitalize mb-1">{field.replace(/([A-Z])/g, ' $1')}</label>
                  <textarea value={spec[field]} onChange={(e) => setSpec({ ...spec, [field]: e.target.value })} className={`${inputClasses} min-h-[60px]`} />
                </div>
              ))}

              <div className="flex gap-2 mt-4">
                <button type="submit" disabled={submitting} className={`${btnClasses} bg-accent-blue text-white ${submitting ? 'opacity-60' : 'hover:bg-blue-600'}`}>
                  {submitting ? 'Saving...' : isEditing ? 'Update' : 'Create'}
                </button>
                <button type="button" onClick={onCancel} className={`${btnClasses} bg-text-tertiary text-white hover:bg-gray-600`}>Cancel</button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
