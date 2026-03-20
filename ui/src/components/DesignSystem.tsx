import React, { useState } from 'react';
import { GlassCard } from './GlassCard';
import { StatusBadge } from './StatusBadge';
import { MetricCard } from './MetricCard';
import { TabbedPanel } from './TabbedPanel';
import { ProgressStepper } from './ProgressStepper';
import { TerminalPanel } from './TerminalPanel';
import { ActionBar } from './ActionBar';
import { StageColumn } from './StageColumn';
import { Button } from './Button';
import type { TaskStatus, Stage, StageLogStatus } from '../types';

const SECTIONS = ['colors', 'typography', 'spacing', 'effects', 'components'] as const;

const COLOR_GROUPS = [
  { name: 'Primary', colors: [
    { token: 'aeth-primary', hex: '#d3ffed' },
    { token: 'aeth-primary-container', hex: '#64f0c8' },
    { token: 'aeth-primary-fixed', hex: '#6ffad1' },
    { token: 'aeth-primary-fixed-dim', hex: '#4eddb6' },
    { token: 'aeth-on-primary', hex: '#00382b' },
  ]},
  { name: 'Secondary', colors: [
    { token: 'aeth-secondary', hex: '#6ad3ff' },
    { token: 'aeth-secondary-container', hex: '#02b0e2' },
    { token: 'aeth-secondary-fixed', hex: '#bee9ff' },
    { token: 'aeth-on-secondary', hex: '#003546' },
  ]},
  { name: 'Tertiary', colors: [
    { token: 'aeth-tertiary', hex: '#fff3f2' },
    { token: 'aeth-tertiary-container', hex: '#ffcdcb' },
    { token: 'aeth-tertiary-fixed-dim', hex: '#ffb3b1' },
  ]},
  { name: 'Error & Warning', colors: [
    { token: 'aeth-error', hex: '#ffb4ab' },
    { token: 'aeth-error-container', hex: '#93000a' },
    { token: 'aeth-warning', hex: '#f5a623' },
  ]},
  { name: 'Surfaces', colors: [
    { token: 'aeth-surface-lowest', hex: '#0b0e14' },
    { token: 'aeth-surface', hex: '#101419' },
    { token: 'aeth-surface-container-low', hex: '#181c22' },
    { token: 'aeth-surface-container', hex: '#1c2026' },
    { token: 'aeth-surface-container-high', hex: '#262a31' },
    { token: 'aeth-surface-container-highest', hex: '#31353c' },
    { token: 'aeth-surface-bright', hex: '#363940' },
  ]},
  { name: 'Semantic', colors: [
    { token: 'accent-blue', hex: '#4eddb6', alias: 'Primary action' },
    { token: 'accent-green', hex: '#64f0c8', alias: 'Success' },
    { token: 'accent-amber', hex: '#f5a623', alias: 'Warning' },
    { token: 'accent-red', hex: '#ffb4ab', alias: 'Error' },
    { token: 'accent-purple', hex: '#6ad3ff', alias: 'Running/active' },
    { token: 'accent-pink', hex: '#ffcdcb', alias: 'Needs review' },
  ]},
];

const ALL_STATUSES: TaskStatus[] = ['backlog','ready','spec_review','planning','needs_plan_review','implementing','checks','code_quality','final_review','pr_creation','needs_human_review','done','blocked','failed','cancelled'];
const PIPELINE_STAGES: Stage[] = ['spec_review','planning','implementing','checks','code_quality','final_review','pr_creation'];

const SAMPLE_LOGS = [
  { level: 'info' as const, timestamp: '12:01:03', message: 'Starting spec review...' },
  { level: 'info' as const, timestamp: '12:01:05', message: 'Analyzing task requirements' },
  { level: 'warn' as const, timestamp: '12:01:08', message: 'Missing acceptance criteria' },
  { level: 'error' as const, timestamp: '12:01:10', message: 'Spec validation failed' },
  { level: 'debug' as const, timestamp: '12:01:10', message: 'Error details: criteria array is empty' },
];

function ColorSwatch({ token, hex, alias }: { token: string; hex: string; alias?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="w-16 h-16 rounded-md border border-border-default" style={{ background: hex }} />
      <span className="text-[10px] font-mono text-text-secondary truncate max-w-16">{token}</span>
      <span className="text-[10px] font-mono text-text-tertiary">{hex}</span>
      {alias && <span className="text-[10px] text-text-tertiary">{alias}</span>}
    </div>
  );
}

export const DesignSystem: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string>('colors');
  const [demoTab, setDemoTab] = useState('tab1');

  return (
    <div className="flex h-full">
      {/* Section nav */}
      <nav className="w-48 shrink-0 border-r border-border-default p-4 sticky top-0 h-screen overflow-auto">
        <div className="text-xs font-heading font-medium text-text-tertiary uppercase tracking-wide mb-4">Sections</div>
        {SECTIONS.map((s) => (
          <a
            key={s}
            href={`#${s}`}
            onClick={() => setActiveSection(s)}
            className={`block px-3 py-1.5 text-sm rounded-md mb-1 transition-colors ${
              activeSection === s ? 'text-accent-blue border-l-2 border-accent-blue bg-bg-tertiary' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </a>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-auto p-8 space-y-12">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-heading font-bold text-text-primary">Aetherium Design System</h1>
          <p className="text-text-secondary mt-1">Living style guide — synced with Stitch</p>
        </div>

        {/* Colors */}
        <section id="colors">
          <h2 className="text-xl font-heading font-bold text-text-primary mb-6">Color Palette</h2>
          {COLOR_GROUPS.map((group) => (
            <div key={group.name} className="mb-6">
              <h3 className="text-sm font-heading font-medium text-text-secondary mb-3">{group.name}</h3>
              <div className="flex flex-wrap gap-4">
                {group.colors.map((c) => (
                  <ColorSwatch key={c.token} {...c} />
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Typography */}
        <section id="typography">
          <h2 className="text-xl font-heading font-bold text-text-primary mb-6">Typography</h2>
          <GlassCard padding="lg">
            <div className="space-y-4">
              <div><span className="text-xs text-text-tertiary font-mono">font-heading / 2xl bold</span><div className="text-2xl font-heading font-bold text-text-primary">Heading Level 1</div></div>
              <div><span className="text-xs text-text-tertiary font-mono">font-heading / xl bold</span><div className="text-xl font-heading font-bold text-text-primary">Heading Level 2</div></div>
              <div><span className="text-xs text-text-tertiary font-mono">font-heading / lg semibold</span><div className="text-lg font-heading font-semibold text-text-primary">Heading Level 3</div></div>
              <div><span className="text-xs text-text-tertiary font-mono">font-heading / base semibold</span><div className="text-base font-heading font-semibold text-text-primary">Heading Level 4</div></div>
              <hr className="border-border-default" />
              <div><span className="text-xs text-text-tertiary font-mono">font-sans / base</span><div className="text-base text-text-primary">Body text — Manrope regular for readable body content across the interface.</div></div>
              <div><span className="text-xs text-text-tertiary font-mono">font-sans / sm</span><div className="text-sm text-text-secondary">Small body text — used for descriptions, secondary information.</div></div>
              <div><span className="text-xs text-text-tertiary font-mono">font-sans / xs</span><div className="text-xs text-text-tertiary">Caption text — metadata, timestamps, labels.</div></div>
              <hr className="border-border-default" />
              <div><span className="text-xs text-text-tertiary font-mono">font-mono / sm</span><div className="text-sm font-mono text-text-primary">const result = await pipeline.execute(task);</div></div>
              <div><span className="text-xs text-text-tertiary font-mono">font-mono / xs</span><div className="text-xs font-mono text-text-secondary">[worker] Stage implementing completed in 4.2s</div></div>
            </div>
          </GlassCard>
        </section>

        {/* Spacing & Radius */}
        <section id="spacing">
          <h2 className="text-xl font-heading font-bold text-text-primary mb-6">Spacing & Radius</h2>
          <div className="flex gap-6 items-end">
            {[{ label: 'sm (0.25rem)', cls: 'rounded-sm' }, { label: 'md (0.5rem)', cls: 'rounded-md' }, { label: 'lg (0.75rem)', cls: 'rounded-lg' }, { label: 'full', cls: 'rounded-full' }].map((r) => (
              <div key={r.label} className="text-center">
                <div className={`w-16 h-16 bg-accent-blue/20 border border-accent-blue ${r.cls}`} />
                <span className="text-[10px] text-text-tertiary mt-2 block">{r.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Effects */}
        <section id="effects">
          <h2 className="text-xl font-heading font-bold text-text-primary mb-6">Effects</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="glass-surface border border-glass-border rounded-lg p-4"><div className="text-sm text-text-primary">Glass Surface</div><div className="text-xs text-text-tertiary mt-1">backdrop-filter: blur(20px)</div></div>
            <div className="glass-surface border border-accent-blue rounded-lg p-4 glow-primary"><div className="text-sm text-text-primary">Primary Glow</div><div className="text-xs text-text-tertiary mt-1">box-shadow: mint glow</div></div>
            <div className="glass-surface border border-accent-red rounded-lg p-4 glow-error"><div className="text-sm text-text-primary">Error Glow</div><div className="text-xs text-text-tertiary mt-1">box-shadow: red glow</div></div>
            <div className="skeleton h-12 w-full" /><div className="skeleton h-12 w-full" /><div className="border border-border-default rounded-lg p-4 animate-gradient-border"><div className="text-sm text-text-primary">Gradient Border</div></div>
          </div>
        </section>

        {/* Components */}
        <section id="components">
          <h2 className="text-xl font-heading font-bold text-text-primary mb-6">Components</h2>

          {/* Buttons */}
          <h3 className="text-sm font-heading font-medium text-text-secondary mb-3">Button</h3>
          <div className="flex flex-wrap gap-3 mb-8">
            {(['primary','secondary','danger','warning','ghost'] as const).map((v) => (
              <Button key={v} variant={v}>{v}</Button>
            ))}
            <Button size="sm">Small</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </div>

          {/* GlassCard */}
          <h3 className="text-sm font-heading font-medium text-text-secondary mb-3">GlassCard</h3>
          <div className="grid grid-cols-3 gap-4 mb-8">
            <GlassCard>Default card</GlassCard>
            <GlassCard variant="highlighted">Highlighted</GlassCard>
            <GlassCard variant="error">Error</GlassCard>
            <GlassCard glow>With glow</GlassCard>
            <GlassCard variant="highlighted" glow>Highlighted + glow</GlassCard>
            <GlassCard variant="error" glow>Error + glow</GlassCard>
          </div>

          {/* StatusBadge */}
          <h3 className="text-sm font-heading font-medium text-text-secondary mb-3">StatusBadge</h3>
          <div className="flex flex-wrap gap-2 mb-8">
            {ALL_STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>

          {/* MetricCard */}
          <h3 className="text-sm font-heading font-medium text-text-secondary mb-3">MetricCard</h3>
          <div className="grid grid-cols-4 gap-4 mb-8">
            <MetricCard label="Tasks Completed" value={847} trend="up" />
            <MetricCard label="Failed" value={12} trend="down" />
            <MetricCard label="Success Rate" value="98.6%" trend="flat" />
            <MetricCard label="Avg Duration" value="4.2m" />
          </div>

          {/* TabbedPanel */}
          <h3 className="text-sm font-heading font-medium text-text-secondary mb-3">TabbedPanel</h3>
          <GlassCard className="mb-8">
            <TabbedPanel tabs={[{id:'tab1',label:'Overview'},{id:'tab2',label:'Logs',count:3},{id:'tab3',label:'Spec'}]} activeTab={demoTab} onTabChange={setDemoTab}>
              <div className="text-sm text-text-secondary p-2">Content for {demoTab}</div>
            </TabbedPanel>
          </GlassCard>

          {/* ProgressStepper */}
          <h3 className="text-sm font-heading font-medium text-text-secondary mb-3">ProgressStepper</h3>
          <div className="space-y-4 mb-8">
            <div className="flex items-center gap-3"><span className="text-xs text-text-tertiary w-20">Early</span><div className="flex-1"><ProgressStepper stages={PIPELINE_STAGES} currentStage="planning" stageStatuses={{ spec_review: 'completed' }} /></div></div>
            <div className="flex items-center gap-3"><span className="text-xs text-text-tertiary w-20">Mid</span><div className="flex-1"><ProgressStepper stages={PIPELINE_STAGES} currentStage="checks" stageStatuses={{ spec_review: 'completed', planning: 'completed', implementing: 'completed' }} /></div></div>
            <div className="flex items-center gap-3"><span className="text-xs text-text-tertiary w-20">Complete</span><div className="flex-1"><ProgressStepper stages={PIPELINE_STAGES} stageStatuses={{ spec_review: 'completed', planning: 'completed', implementing: 'completed', checks: 'completed', code_quality: 'completed', final_review: 'completed', pr_creation: 'completed' }} /></div></div>
            <div className="flex items-center gap-3"><span className="text-xs text-text-tertiary w-20">Failed</span><div className="flex-1"><ProgressStepper stages={PIPELINE_STAGES} stageStatuses={{ spec_review: 'completed', planning: 'completed', implementing: 'failed' }} /></div></div>
            <div className="flex items-center gap-3"><span className="text-xs text-text-tertiary w-20">Compact</span><div className="flex-1"><ProgressStepper stages={PIPELINE_STAGES} currentStage="implementing" stageStatuses={{ spec_review: 'completed', planning: 'completed' }} compact /></div></div>
          </div>

          {/* TerminalPanel */}
          <h3 className="text-sm font-heading font-medium text-text-secondary mb-3">TerminalPanel</h3>
          <div className="mb-8">
            <TerminalPanel title="Build Output" content={SAMPLE_LOGS} maxHeight="200px" />
          </div>

          {/* ActionBar */}
          <h3 className="text-sm font-heading font-medium text-text-secondary mb-3">ActionBar</h3>
          <div className="space-y-4 mb-8">
            <GlassCard><ActionBar actions={[{label:'Approve',variant:'primary',onClick:()=>{}},{label:'Abort',variant:'danger',onClick:()=>{}}]} align="split" /></GlassCard>
            <GlassCard><ActionBar actions={[{label:'Save',variant:'primary',onClick:()=>{}},{label:'Cancel',variant:'ghost',onClick:()=>{}}]} align="right" /></GlassCard>
          </div>

          {/* StageColumn */}
          <h3 className="text-sm font-heading font-medium text-text-secondary mb-3">StageColumn</h3>
          <div className="flex gap-4 mb-8 overflow-x-auto">
            <StageColumn title="Implementing" count={3} status="implementing">
              <div className="text-xs text-text-tertiary p-2">Task card A</div>
              <div className="text-xs text-text-tertiary p-2">Task card B</div>
              <div className="text-xs text-text-tertiary p-2">Task card C</div>
            </StageColumn>
            <StageColumn title="Checks" count={1} status="checks">
              <div className="text-xs text-text-tertiary p-2">Task card D</div>
            </StageColumn>
          </div>
        </section>
      </div>
    </div>
  );
};
