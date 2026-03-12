import React, { useState } from 'react';
import type { Task, RiskLevel, SpecTemplate } from '../types';

interface Props {
  initial?: Task | null;
  onSubmit: (data: {
    title: string;
    description: string;
    spec: string;
    riskLevel: RiskLevel;
    priority: number;
  }) => Promise<void>;
  onCancel: () => void;
}

function parseSpec(spec: string | null): SpecTemplate {
  const empty: SpecTemplate = {
    context: '',
    acceptanceCriteria: '',
    constraints: '',
    verification: '',
    riskLevel: 'low',
    infrastructureAllowed: '',
  };
  if (!spec) return empty;
  try {
    return { ...empty, ...(JSON.parse(spec) as Partial<SpecTemplate>) };
  } catch {
    return empty;
  }
}

export const TaskForm: React.FC<Props> = ({ initial, onSubmit, onCancel }) => {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [riskLevel, setRiskLevel] = useState<RiskLevel>(initial?.riskLevel ?? 'low');
  const [priority, setPriority] = useState(initial?.priority ?? 0);
  const [spec, setSpec] = useState<SpecTemplate>(() => parseSpec(initial?.spec ?? null));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        spec: JSON.stringify({ ...spec, riskLevel }),
        riskLevel,
        priority,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: 60,
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          maxWidth: 600,
          width: '90%',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 16px' }}>{initial ? 'Edit Task' : 'New Task'}</h2>

        {error && (
          <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 14 }}>{error}</div>
        )}

        <Field label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
            placeholder="Task title"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...inputStyle, minHeight: 60 }}
            placeholder="Brief description"
          />
        </Field>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <Field label="Risk Level" flex>
            <select
              value={riskLevel}
              onChange={(e) => setRiskLevel(e.target.value as RiskLevel)}
              style={inputStyle}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Priority" flex>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
              style={inputStyle}
              min={0}
            />
          </Field>
        </div>

        <h3 style={{ fontSize: 14, color: '#6b7280', margin: '16px 0 8px', textTransform: 'uppercase' }}>
          Spec Template
        </h3>

        <Field label="Context">
          <textarea
            value={spec.context}
            onChange={(e) => setSpec({ ...spec, context: e.target.value })}
            style={{ ...inputStyle, minHeight: 60 }}
            placeholder="What is the context of this task?"
          />
        </Field>

        <Field label="Acceptance Criteria">
          <textarea
            value={spec.acceptanceCriteria}
            onChange={(e) => setSpec({ ...spec, acceptanceCriteria: e.target.value })}
            style={{ ...inputStyle, minHeight: 60 }}
            placeholder="When is this task considered done?"
          />
        </Field>

        <Field label="Constraints">
          <textarea
            value={spec.constraints}
            onChange={(e) => setSpec({ ...spec, constraints: e.target.value })}
            style={{ ...inputStyle, minHeight: 60 }}
            placeholder="Technical constraints or limitations"
          />
        </Field>

        <Field label="Verification">
          <textarea
            value={spec.verification}
            onChange={(e) => setSpec({ ...spec, verification: e.target.value })}
            style={{ ...inputStyle, minHeight: 60 }}
            placeholder="How to verify this task is correct"
          />
        </Field>

        <Field label="Infrastructure Allowed">
          <textarea
            value={spec.infrastructureAllowed}
            onChange={(e) => setSpec({ ...spec, infrastructureAllowed: e.target.value })}
            style={{ ...inputStyle, minHeight: 40 }}
            placeholder="What infrastructure changes are allowed?"
          />
        </Field>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            type="submit"
            disabled={submitting}
            style={{
              ...btnStyle,
              background: '#3b82f6',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Saving...' : initial ? 'Update' : 'Create'}
          </button>
          <button type="button" onClick={onCancel} style={{ ...btnStyle, background: '#6b7280' }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

// -- Helpers --

const Field: React.FC<{ label: string; flex?: boolean; children: React.ReactNode }> = ({
  label,
  flex,
  children,
}) => (
  <div style={{ marginBottom: 12, flex: flex ? 1 : undefined }}>
    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>
      {label}
    </label>
    {children}
  </div>
);

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  padding: '8px 10px',
  fontSize: 14,
  boxSizing: 'border-box',
  resize: 'vertical',
};

const btnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: '8px 20px',
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
