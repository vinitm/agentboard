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
    try {
      await onAnswer(taskId, answerText);
      setAnswerText('');
    } catch (err) {
      console.error('Failed to submit answer:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={containerStyle}>
      <h4 style={titleStyle}>Blocked</h4>
      <p style={{ margin: '0 0 12px', fontSize: 14, whiteSpace: 'pre-wrap' }}>{blockedReason}</p>
      <textarea
        value={answerText}
        onChange={(e) => setAnswerText(e.target.value)}
        placeholder="Provide your answer..."
        rows={4}
        style={textareaStyle}
      />
      <button onClick={handleSubmit} disabled={submitting || !answerText.trim()} style={submitBtnStyle}>
        {submitting ? 'Submitting...' : 'Submit Answer'}
      </button>
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  background: '#fffbeb',
  border: '1px solid #f59e0b',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 14,
  fontWeight: 700,
  color: '#b45309',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  padding: 8,
  fontSize: 14,
  resize: 'vertical',
  boxSizing: 'border-box',
  marginBottom: 8,
};

const submitBtnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: '8px 16px',
  background: '#f59e0b',
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};
