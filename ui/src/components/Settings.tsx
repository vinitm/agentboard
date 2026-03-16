import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

interface Commands { test: string | null; lint: string | null; format: string | null; formatFix: string | null; typecheck: string | null; security: string | null }
interface Notifications { desktop: boolean; terminal: boolean }
interface ModelDefaults { planning: string; implementation: string; review: string; security: string }
interface Config {
  port: number; host: string; maxConcurrentTasks: number; maxAttemptsPerTask: number; maxReviewCycles: number; maxSubcardDepth: number;
  prDraft: boolean; autoMerge: boolean; prMethod: string; securityMode: string; branchPrefix: string; baseBranch: string; githubRemote: string;
  commitPolicy: string; formatPolicy: string; commands: Commands; notifications: Notifications; modelDefaults: ModelDefaults;
}

type Section = 'commands' | 'security' | 'budgets' | 'branch' | 'policies' | 'models' | 'notifications';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'commands', label: 'Commands' }, { key: 'security', label: 'Security' }, { key: 'budgets', label: 'Budgets' },
  { key: 'branch', label: 'Branch & PR' }, { key: 'policies', label: 'Policies' }, { key: 'models', label: 'Models' },
  { key: 'notifications', label: 'Notifications' },
];

const inputClasses = 'w-full rounded-md bg-bg-tertiary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-blue';

export const Settings: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [activeSection, setActiveSection] = useState<Section>('commands');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get<Config>('/api/config').then(setConfig).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load config'));
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true); setError(''); setSuccess('');
    try { const updated = await api.put<Config>('/api/config', config); setConfig(updated); setSuccess('Settings saved.'); setTimeout(() => setSuccess(''), 2000); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  };

  if (!config) {
    return <div className="flex items-center justify-center h-64">{error ? <span className="text-accent-red">{error}</span> : <span className="text-text-secondary">Loading settings...</span>}</div>;
  }

  const setCmd = (key: keyof Commands, value: string) => setConfig({ ...config, commands: { ...config.commands, [key]: value || null } });

  return (
    <div className="flex h-full">
      {/* Section nav */}
      <nav className="w-48 flex-shrink-0 border-r border-border-default p-4">
        {SECTIONS.map(({ key, label }) => (
          <button key={key} onClick={() => setActiveSection(key)}
            className={`block w-full text-left px-3 py-1.5 rounded-md text-[13px] mb-0.5 transition-colors ${activeSection === key ? 'bg-bg-elevated text-white font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'}`}>
            {label}
          </button>
        ))}
      </nav>

      {/* Form content */}
      <div className="flex-1 p-6 overflow-y-auto">
        {activeSection === 'commands' && (
          <FormSection title="Check Commands">
            {(['test', 'lint', 'format', 'formatFix', 'typecheck', 'security'] as const).map((key) => (
              <Field key={key} label={key}><input type="text" value={config.commands[key] ?? ''} onChange={(e) => setCmd(key, e.target.value)} placeholder={`${key} command (leave empty to disable)`} className={inputClasses} /></Field>
            ))}
          </FormSection>
        )}
        {activeSection === 'security' && (
          <FormSection title="Security">
            <Field label="Security Mode">
              <select value={config.securityMode} onChange={(e) => setConfig({ ...config, securityMode: e.target.value })} className={inputClasses}>
                <option value="lightweight">lightweight</option><option value="strict">strict</option><option value="off">off</option>
              </select>
            </Field>
          </FormSection>
        )}
        {activeSection === 'budgets' && (
          <FormSection title="Budgets">
            {([['maxConcurrentTasks', 1, 10], ['maxAttemptsPerTask', 1, 50], ['maxReviewCycles', 1, 20], ['maxSubcardDepth', 0, 10]] as const).map(([key, min, max]) => (
              <Field key={key} label={key}><input type="number" min={min} max={max} value={config[key]} onChange={(e) => setConfig({ ...config, [key]: parseInt(e.target.value, 10) || min })} className={inputClasses} /></Field>
            ))}
          </FormSection>
        )}
        {activeSection === 'branch' && (
          <FormSection title="Branch & PR">
            {(['branchPrefix', 'baseBranch', 'githubRemote', 'prMethod'] as const).map((key) => (
              <Field key={key} label={key}><input type="text" value={config[key]} onChange={(e) => setConfig({ ...config, [key]: e.target.value })} className={inputClasses} /></Field>
            ))}
            <Field label="PR Draft"><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={config.prDraft} onChange={(e) => setConfig({ ...config, prDraft: e.target.checked })} className="accent-accent-blue" /> Create PRs as drafts</label></Field>
            <Field label="Auto Merge"><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={config.autoMerge} onChange={(e) => setConfig({ ...config, autoMerge: e.target.checked })} className="accent-accent-blue" /> Auto-merge PRs when checks pass</label></Field>
          </FormSection>
        )}
        {activeSection === 'policies' && (
          <FormSection title="Policies">
            <Field label="Commit Policy"><select value={config.commitPolicy} onChange={(e) => setConfig({ ...config, commitPolicy: e.target.value })} className={inputClasses}><option value="after-checks-pass">after-checks-pass</option></select></Field>
            <Field label="Format Policy"><select value={config.formatPolicy} onChange={(e) => setConfig({ ...config, formatPolicy: e.target.value })} className={inputClasses}><option value="auto-fix-separate-commit">auto-fix-separate-commit</option></select></Field>
          </FormSection>
        )}
        {activeSection === 'models' && (
          <FormSection title="Model Defaults">
            {(['planning', 'implementation', 'review', 'security'] as const).map((key) => (
              <Field key={key} label={key}><input type="text" value={config.modelDefaults[key]} onChange={(e) => setConfig({ ...config, modelDefaults: { ...config.modelDefaults, [key]: e.target.value } })} placeholder={`Model for ${key}`} className={inputClasses} /></Field>
            ))}
          </FormSection>
        )}
        {activeSection === 'notifications' && (
          <FormSection title="Notifications">
            <Field label="Desktop"><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={config.notifications.desktop} onChange={(e) => setConfig({ ...config, notifications: { ...config.notifications, desktop: e.target.checked } })} className="accent-accent-blue" /> Desktop notifications</label></Field>
            <Field label="Terminal"><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={config.notifications.terminal} onChange={(e) => setConfig({ ...config, notifications: { ...config.notifications, terminal: e.target.checked } })} className="accent-accent-blue" /> Terminal notifications</label></Field>
          </FormSection>
        )}

        {/* Save bar */}
        <div className="sticky bottom-0 bg-bg-primary border-t border-border-default py-3 mt-6 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="px-5 py-2 rounded-md text-sm font-semibold bg-accent-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {error && <span className="text-accent-red text-sm">{error}</span>}
          {success && <span className="text-accent-green text-sm">{success}</span>}
        </div>
      </div>
    </div>
  );
};

const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-6">
    <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary mb-3">{title}</h3>
    <div className="space-y-3">{children}</div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-3">
    <label className="w-40 flex-shrink-0 text-[13px] font-semibold text-text-secondary">{label}</label>
    <div className="flex-1">{children}</div>
  </div>
);
