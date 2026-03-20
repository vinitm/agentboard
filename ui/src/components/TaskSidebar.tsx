import React, { useEffect, useState } from 'react';
import { GlassCard } from './GlassCard';
import { CopyButton } from './CopyButton';
import { api } from '../api/client';
import { timeAgo, formatDuration } from '../lib/time';
import type { Task } from '../types';

interface GitRef {
  id: string;
  taskId: number;
  branch: string;
  worktreePath: string | null;
  status: string;
  createdAt: string;
}

interface CostRollup {
  totalTokens: number;
  totalDurationMs: number;
  estimatedCost: number;
  stageCount: number;
  stages: Array<{
    stage: string;
    tokens: number;
    durationMs: number;
    attempts: number;
    estimatedCost: number;
  }>;
}

interface EventRecord {
  id: string;
  taskId: number;
  type: string;
  payload: string;
  createdAt: string;
}

// ── Label + Value row ────────────────────────────────────────────────

const Field: React.FC<{ label: string; children: React.ReactNode; mono?: boolean }> = ({ label, children, mono }) => (
  <div className="flex items-baseline justify-between gap-2 py-1">
    <span className="text-[10px] uppercase tracking-wider text-text-quaternary font-medium shrink-0">{label}</span>
    <span className={`text-xs text-text-primary text-right ${mono ? 'font-mono' : ''}`}>{children}</span>
  </div>
);

// ── Section heading ──────────────────────────────────────────────────

const SectionLabel: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = 'text-text-tertiary' }) => (
  <h3 className={`text-[10px] font-bold uppercase tracking-widest ${color} mb-2`}>{children}</h3>
);

// ── Agent Card ───────────────────────────────────────────────────────

const AgentCard: React.FC<{ task: Task }> = ({ task }) => {
  const isActive = !!task.claimedBy;
  const claimedDuration = task.claimedAt
    ? formatDuration(Date.now() - new Date(task.claimedAt).getTime())
    : null;

  return (
    <GlassCard padding="sm" variant={isActive ? 'highlighted' : 'default'}>
      <SectionLabel color={isActive ? 'text-accent-blue' : 'text-text-tertiary'}>
        <span className="flex items-center gap-1.5">
          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse-dot" />}
          Agent
        </span>
      </SectionLabel>
      <div className="space-y-0">
        <Field label="Claimed by">{task.claimedBy || <span className="text-text-tertiary">—</span>}</Field>
        {claimedDuration && <Field label="Active for">{claimedDuration}</Field>}
        <Field label="Blocked at">
          {task.blockedAtStage
            ? <span className="text-accent-amber">{task.blockedAtStage.replace(/_/g, ' ')}</span>
            : <span className="text-text-tertiary">—</span>}
        </Field>
      </div>
    </GlassCard>
  );
};

// ── Git Card ─────────────────────────────────────────────────────────

const GitCard: React.FC<{ taskId: number; events: EventRecord[] }> = ({ taskId, events }) => {
  const [gitRefs, setGitRefs] = useState<GitRef[]>([]);

  useEffect(() => {
    api.get<GitRef[]>(`/api/tasks/${taskId}/git-refs`).then(setGitRefs).catch(() => {});
  }, [taskId]);

  const prEvent = events.find(e => e.type === 'pr_created');
  let prUrl: string | null = null;
  let prNumber: string | null = null;
  if (prEvent) {
    try {
      const payload = JSON.parse(prEvent.payload) as { prUrl?: string; prNumber?: number; url?: string };
      prUrl = payload.prUrl || payload.url || null;
      prNumber = payload.prNumber ? `#${payload.prNumber}` : null;
    } catch {}
  }

  const ref = gitRefs[0];
  if (!ref && !prUrl) return null;

  const statusColor: Record<string, string> = {
    local: 'bg-text-tertiary/15 text-text-tertiary',
    pushed: 'bg-accent-blue/15 text-accent-blue',
    pr_open: 'bg-accent-green/15 text-accent-green',
  };

  return (
    <GlassCard padding="sm">
      <SectionLabel>Git</SectionLabel>
      <div className="space-y-0">
        {ref && (
          <>
            <div className="flex items-center gap-1.5 py-1">
              <span className="text-[10px] uppercase tracking-wider text-text-quaternary font-medium shrink-0">Branch</span>
              <span className="flex-1 text-right flex items-center justify-end gap-1">
                <code className="text-[11px] text-accent-blue font-mono truncate max-w-[160px]">{ref.branch}</code>
                <CopyButton text={ref.branch} />
              </span>
            </div>
            <Field label="Status">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusColor[ref.status] || statusColor.local}`}>
                {ref.status.replace(/_/g, ' ')}
              </span>
            </Field>
          </>
        )}
        {prUrl && (
          <Field label="PR">
            <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline text-xs">
              {prNumber || 'View PR'} <span className="text-[10px]">↗</span>
            </a>
          </Field>
        )}
      </div>
    </GlassCard>
  );
};

// ── Cost Card ────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  spec_review: 'bg-accent-blue',
  planning: 'bg-accent-purple',
  implementing: 'bg-accent-pink',
  checks: 'bg-accent-green',
  code_quality: 'bg-accent-amber',
  final_review: 'bg-accent-blue',
  pr_creation: 'bg-accent-green',
  inline_fix: 'bg-accent-red',
  learner: 'bg-text-tertiary',
};

const CostCard: React.FC<{ taskId: number }> = ({ taskId }) => {
  const [cost, setCost] = useState<CostRollup | null>(null);

  useEffect(() => {
    api.get<CostRollup>(`/api/tasks/${taskId}/costs`)
      .then(data => { if (data && typeof data.totalTokens === 'number') setCost(data); })
      .catch(() => {});
  }, [taskId]);

  if (!cost || !cost.stages || cost.totalTokens === 0) return null;

  const maxTokens = Math.max(...cost.stages.map(s => s.tokens), 1);

  return (
    <GlassCard padding="sm">
      <SectionLabel>Cost</SectionLabel>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-semibold text-text-primary">
          {cost.totalTokens.toLocaleString()} <span className="text-[10px] text-text-tertiary font-normal">tokens</span>
        </span>
        <span className="text-sm font-semibold text-accent-green">${cost.estimatedCost.toFixed(2)}</span>
      </div>
      <div className="text-[11px] text-text-tertiary mb-3">
        Duration: {formatDuration(cost.totalDurationMs)}
      </div>

      {/* Stacked bar */}
      <div className="flex h-2 rounded-full overflow-hidden mb-3 bg-bg-tertiary">
        {cost.stages.map(s => {
          const pct = cost.totalTokens > 0 ? (s.tokens / cost.totalTokens) * 100 : 0;
          if (pct < 1) return null;
          return (
            <div
              key={s.stage}
              className={`${STAGE_COLORS[s.stage] || 'bg-text-tertiary'} opacity-70`}
              style={{ width: `${pct}%` }}
              title={`${s.stage}: ${s.tokens.toLocaleString()} tokens`}
            />
          );
        })}
      </div>

      {/* Per-stage breakdown */}
      <div className="space-y-1">
        {cost.stages.map(s => (
          <div key={s.stage} className="flex items-center gap-2 text-[11px]">
            <span className={`w-2 h-2 rounded-sm shrink-0 ${STAGE_COLORS[s.stage] || 'bg-text-tertiary'} opacity-70`} />
            <span className="text-text-secondary flex-1 truncate">{s.stage.replace(/_/g, ' ')}</span>
            <span className="text-text-tertiary font-mono tabular-nums">{(s.tokens / 1000).toFixed(1)}k</span>
            <span className="text-text-tertiary font-mono tabular-nums w-10 text-right">{formatDuration(s.durationMs)}</span>
            {s.attempts > 1 && (
              <span className="text-accent-amber text-[10px]">×{s.attempts}</span>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
};

// ── Timestamps Card ──────────────────────────────────────────────────

const TimestampsCard: React.FC<{ task: Task; events: EventRecord[] }> = ({ task, events }) => {
  const createdDate = new Date(task.createdAt);
  const updatedDate = new Date(task.updatedAt);
  const elapsed = Date.now() - createdDate.getTime();

  // Find when task entered current status
  const statusEvents = events
    .filter(e => e.type === 'status_changed')
    .map(e => {
      try { return { ...e, payload: JSON.parse(e.payload) as { to?: string } }; } catch { return null; }
    })
    .filter(Boolean) as Array<{ createdAt: string; payload: { to?: string } }>;

  const lastStatusChange = [...statusEvents].reverse().find(e => e.payload.to === task.status);
  const inStatusMs = lastStatusChange
    ? Date.now() - new Date(lastStatusChange.createdAt).getTime()
    : elapsed;

  const fmt = (d: Date) => d.toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <GlassCard padding="sm">
      <SectionLabel>Timestamps</SectionLabel>
      <div className="space-y-0">
        <Field label="Created">{fmt(createdDate)}</Field>
        <Field label="Updated">{timeAgo(task.updatedAt)}</Field>
        <Field label="In status">{formatDuration(inStatusMs)}</Field>
        <Field label="Total elapsed">{formatDuration(elapsed)}</Field>
      </div>
    </GlassCard>
  );
};

// ── Export combined sidebar ──────────────────────────────────────────

interface TaskSidebarProps {
  task: Task;
  events: EventRecord[];
}

export const TaskSidebar: React.FC<TaskSidebarProps> = ({ task, events }) => (
  <div className="space-y-3 w-[280px] shrink-0">
    <AgentCard task={task} />
    <GitCard taskId={task.id} events={events} />
    <CostCard taskId={task.id} />
    <TimestampsCard task={task} events={events} />
  </div>
);
