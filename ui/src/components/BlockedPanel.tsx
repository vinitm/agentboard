import React, { useState } from 'react';

interface Props {
  taskId: string;
  blockedReason: string;
  onAnswer: (id: string, answers: string) => Promise<unknown>;
}

export const BlockedPanel: React.FC<Props> = ({ taskId, blockedReason, onAnswer }) => {
  const [answerText, setAnswerText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!answerText.trim()) return;
    setSubmitting(true);
    try { await onAnswer(taskId, answerText); setAnswerText(''); }
    catch (err) { console.error('Failed to submit answer:', err); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="mb-4 p-4 rounded-lg border-t-2 border-t-accent-amber bg-bg-tertiary border border-border-default">
      <h4 className="text-xs font-bold uppercase tracking-wider text-accent-amber mb-2">Blocked</h4>
      <p className="text-sm text-text-primary whitespace-pre-wrap mb-3">{blockedReason}</p>
      <textarea
        value={answerText} onChange={(e) => setAnswerText(e.target.value)}
        placeholder="Provide your answer..."
        rows={4}
        className="w-full rounded-md bg-bg-secondary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-amber resize-y mb-2"
      />
      <button onClick={handleSubmit} disabled={submitting || !answerText.trim()}
        className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-amber text-white hover:bg-amber-600 transition-colors disabled:opacity-50">
        {submitting ? 'Submitting...' : 'Submit Answer'}
      </button>
    </div>
  );
};
