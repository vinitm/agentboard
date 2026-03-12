import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

interface Commands {
  test: string | null;
  lint: string | null;
  format: string | null;
  formatFix: string | null;
  typecheck: string | null;
  security: string | null;
}

interface Notifications {
  desktop: boolean;
  terminal: boolean;
}

interface Config {
  port: number;
  host: string;
  maxConcurrentTasks: number;
  maxAttemptsPerTask: number;
  maxReviewCycles: number;
  maxSubcardDepth: number;
  prDraft: boolean;
  securityMode: string;
  branchPrefix: string;
  baseBranch: string;
  githubRemote: string;
  commands: Commands;
  notifications: Notifications;
}

interface Props {
  onClose: () => void;
}

export const Settings: React.FC<Props> = ({ onClose }) => {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api
      .get<Config>('/api/config')
      .then(setConfig)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load config'));
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const updated = await api.put<Config>('/api/config', config);
      setConfig(updated);
      setSuccess('Settings saved.');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
          {error ? (
            <div style={{ color: '#ef4444' }}>{error}</div>
          ) : (
            <div style={{ color: '#9ca3af' }}>Loading settings...</div>
          )}
        </div>
      </div>
    );
  }

  const setCmd = (key: keyof Commands, value: string) => {
    setConfig({
      ...config,
      commands: { ...config.commands, [key]: value || null },
    });
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Settings</h2>
          <button onClick={onClose} style={closeBtnStyle}>&times;</button>
        </div>

        {/* Check Commands */}
        <Section title="Check Commands">
          {(['test', 'lint', 'format', 'formatFix', 'typecheck', 'security'] as const).map((key) => (
            <Field key={key} label={key}>
              <input
                type="text"
                value={config.commands[key] ?? ''}
                onChange={(e) => setCmd(key, e.target.value)}
                placeholder={`${key} command (leave empty to disable)`}
                style={inputStyle}
              />
            </Field>
          ))}
        </Section>

        {/* Security Mode */}
        <Section title="Security">
          <Field label="securityMode">
            <select
              value={config.securityMode}
              onChange={(e) => setConfig({ ...config, securityMode: e.target.value })}
              style={inputStyle}
            >
              <option value="lightweight">lightweight</option>
              <option value="strict">strict</option>
              <option value="off">off</option>
            </select>
          </Field>
        </Section>

        {/* Budgets */}
        <Section title="Budgets">
          <Field label="maxConcurrentTasks">
            <input
              type="number"
              min={1}
              max={10}
              value={config.maxConcurrentTasks}
              onChange={(e) => setConfig({ ...config, maxConcurrentTasks: parseInt(e.target.value, 10) || 1 })}
              style={inputStyle}
            />
          </Field>
          <Field label="maxAttemptsPerTask">
            <input
              type="number"
              min={1}
              max={50}
              value={config.maxAttemptsPerTask}
              onChange={(e) => setConfig({ ...config, maxAttemptsPerTask: parseInt(e.target.value, 10) || 1 })}
              style={inputStyle}
            />
          </Field>
          <Field label="maxReviewCycles">
            <input
              type="number"
              min={1}
              max={20}
              value={config.maxReviewCycles}
              onChange={(e) => setConfig({ ...config, maxReviewCycles: parseInt(e.target.value, 10) || 1 })}
              style={inputStyle}
            />
          </Field>
          <Field label="maxSubcardDepth">
            <input
              type="number"
              min={0}
              max={10}
              value={config.maxSubcardDepth}
              onChange={(e) => setConfig({ ...config, maxSubcardDepth: parseInt(e.target.value, 10) || 0 })}
              style={inputStyle}
            />
          </Field>
        </Section>

        {/* Branch Rules */}
        <Section title="Branch Rules">
          <Field label="branchPrefix">
            <input
              type="text"
              value={config.branchPrefix}
              onChange={(e) => setConfig({ ...config, branchPrefix: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="baseBranch">
            <input
              type="text"
              value={config.baseBranch}
              onChange={(e) => setConfig({ ...config, baseBranch: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="githubRemote">
            <input
              type="text"
              value={config.githubRemote}
              onChange={(e) => setConfig({ ...config, githubRemote: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </Section>

        {/* PR Draft */}
        <Section title="Pull Requests">
          <Field label="prDraft">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={config.prDraft}
                onChange={(e) => setConfig({ ...config, prDraft: e.target.checked })}
              />
              Create PRs as drafts
            </label>
          </Field>
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <Field label="desktop">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={config.notifications.desktop}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    notifications: { ...config.notifications, desktop: e.target.checked },
                  })
                }
              />
              Desktop notifications
            </label>
          </Field>
          <Field label="terminal">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={config.notifications.terminal}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    notifications: { ...config.notifications, terminal: e.target.checked },
                  })
                }
              />
              Terminal notifications
            </label>
          </Field>
        </Section>

        {/* Save */}
        <div style={{ marginTop: 20, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={save} disabled={saving} style={saveBtnStyle}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {error && <span style={{ color: '#ef4444', fontSize: 13 }}>{error}</span>}
          {success && <span style={{ color: '#22c55e', fontSize: 13 }}>{success}</span>}
        </div>
      </div>
    </div>
  );
};

// -- Sub-components --

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 20 }}>
    <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {title}
    </h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <label style={{ minWidth: 160, fontSize: 13, color: '#6b7280', fontWeight: 600 }}>{label}</label>
    <div style={{ flex: 1 }}>{children}</div>
  </div>
);

// -- Styles --

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  paddingTop: 40,
  zIndex: 1000,
};

const panelStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  maxWidth: 640,
  width: '90%',
  maxHeight: '85vh',
  overflowY: 'auto',
  boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
};

const closeBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  fontSize: 24,
  cursor: 'pointer',
  color: '#9ca3af',
  lineHeight: 1,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  padding: '6px 10px',
  fontSize: 14,
  boxSizing: 'border-box',
};

const saveBtnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: '8px 20px',
  background: '#3b82f6',
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
