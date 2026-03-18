import React, { useState, useMemo } from 'react';
import { parseBlockedReason, type Severity, type BlockCategory } from '../lib/parse-blocked-reason.js';

interface Props {
  taskId: number;
  blockedReason: string;
  onAnswer: (id: number, answers: string) => Promise<unknown>;
}

const SEVERITY_STYLES: Record<Severity, { badge: string; dot: string }> = {
  critical: { badge: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/20', dot: 'bg-red-400' },
  high:     { badge: 'bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/20', dot: 'bg-orange-400' },
  medium:   { badge: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20', dot: 'bg-amber-400' },
  low:      { badge: 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/20', dot: 'bg-blue-400' },
  info:     { badge: 'bg-gray-500/15 text-gray-400 ring-1 ring-gray-500/20', dot: 'bg-gray-400' },
};

const CATEGORY_ICONS: Record<BlockCategory, React.ReactNode> = {
  needs_context: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  ),
  checks_failed: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  ),
  quality_failed: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  ),
  spec_issues: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
      <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
    </svg>
  ),
  implementation_blocked: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
    </svg>
  ),
  unknown: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  ),
};

export const BlockedPanel: React.FC<Props> = ({ taskId, blockedReason, onAnswer }) => {
  const [answerText, setAnswerText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const parsed = useMemo(() => parseBlockedReason(blockedReason), [blockedReason]);

  const handleSubmit = async () => {
    if (!answerText.trim()) return;
    setSubmitting(true);
    try { await onAnswer(taskId, answerText); setAnswerText(''); }
    catch (err) { console.error('Failed to submit answer:', err); }
    finally { setSubmitting(false); }
  };

  const hasSeverityTags = parsed.items.some(i => i.severity !== 'info');
  const hasMultipleItems = parsed.items.length > 1;

  return (
    <div className="mb-4 rounded-lg border-t-2 border-t-accent-amber bg-bg-tertiary border border-border-default overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="text-accent-amber">{CATEGORY_ICONS[parsed.category]}</span>
        <h4 className="text-xs font-bold uppercase tracking-wider text-accent-amber">
          {parsed.categoryLabel}
        </h4>
      </div>

      {/* Items */}
      <div className="px-4 pb-3">
        {hasMultipleItems ? (
          <ul className="space-y-1.5">
            {parsed.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                {hasSeverityTags ? (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 mt-0.5 ${SEVERITY_STYLES[item.severity].badge}`}>
                    {item.severity}
                  </span>
                ) : (
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2 ${SEVERITY_STYLES[item.severity].dot}`} />
                )}
                <span className="text-text-primary">
                  {item.field && (
                    <span className="font-medium text-text-secondary">{item.field}: </span>
                  )}
                  {item.message}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-primary">
            {parsed.items[0]?.field && (
              <span className="font-medium text-text-secondary">{parsed.items[0].field}: </span>
            )}
            {parsed.items[0]?.message}
          </p>
        )}
      </div>

      {/* Answer form */}
      <div className="px-4 pb-4 border-t border-border-default pt-3">
        <textarea
          value={answerText} onChange={(e) => setAnswerText(e.target.value)}
          placeholder={parsed.category === 'needs_context' ? 'Provide the missing context...' : 'Describe how to resolve this...'}
          rows={3}
          className="w-full rounded-md bg-bg-secondary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-amber resize-y mb-2"
        />
        <button onClick={handleSubmit} disabled={submitting || !answerText.trim()}
          className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-amber text-white hover:bg-amber-600 transition-colors disabled:opacity-50">
          {submitting ? 'Submitting...' : 'Submit Answer'}
        </button>
      </div>
    </div>
  );
};
