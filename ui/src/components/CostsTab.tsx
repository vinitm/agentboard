import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatDuration } from '../lib/time';
import type { Run } from '../types';

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

interface Props {
  taskId: number;
  runs: Run[];
}

export const CostsTab: React.FC<Props> = ({ taskId, runs }) => {
  const [cost, setCost] = useState<CostRollup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<CostRollup>(`/api/tasks/${taskId}/costs`)
      .then(setCost)
      .catch(() => setCost(null))
      .finally(() => setLoading(false));
  }, [taskId]);

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="skeleton h-20 w-full rounded-lg" />
        <div className="skeleton h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (!cost || cost.totalTokens === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-secondary animate-fade-in">
        <svg className="w-10 h-10 text-text-tertiary mb-3 opacity-50" viewBox="0 0 20 20" fill="currentColor">
          <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
        </svg>
        <p className="text-sm">No cost data yet</p>
        <p className="text-xs text-text-tertiary mt-1">Token usage and costs appear as the pipeline runs</p>
      </div>
    );
  }

  // Build model usage stats from runs
  const modelCounts: Record<string, number> = {};
  for (const run of runs) {
    if (run.modelUsed) {
      modelCounts[run.modelUsed] = (modelCounts[run.modelUsed] || 0) + 1;
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-bg-secondary border border-border-default rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-text-primary">{cost.totalTokens.toLocaleString()}</div>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary mt-1">Total Tokens</div>
        </div>
        <div className="bg-bg-secondary border border-border-default rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-accent-green">${cost.estimatedCost.toFixed(2)}</div>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary mt-1">Estimated Cost</div>
        </div>
        <div className="bg-bg-secondary border border-border-default rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-text-primary">{formatDuration(cost.totalDurationMs)}</div>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary mt-1">Total Duration</div>
        </div>
      </div>

      {/* Stage breakdown */}
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary mb-3">Per-Stage Breakdown</h3>
        <div className="bg-bg-secondary border border-border-default rounded-lg overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_100px_80px_60px_70px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-text-tertiary font-semibold border-b border-border-default">
            <span>Stage</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Duration</span>
            <span className="text-right">Runs</span>
            <span className="text-right">Cost</span>
          </div>
          {/* Rows */}
          {cost.stages.map((s, i) => {
            const pct = cost.totalTokens > 0 ? (s.tokens / cost.totalTokens) * 100 : 0;
            return (
              <div
                key={s.stage}
                className={`grid grid-cols-[1fr_100px_80px_60px_70px] gap-2 px-4 py-2.5 text-[13px] items-center ${
                  i < cost.stages.length - 1 ? 'border-b border-border-default' : ''
                } hover:bg-bg-tertiary transition-colors`}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-sm ${STAGE_COLORS[s.stage] || 'bg-text-tertiary'} opacity-70`} />
                  <span className="text-text-primary">{s.stage.replace(/_/g, ' ')}</span>
                  {/* Inline bar */}
                  <div className="flex-1 h-1 bg-bg-tertiary rounded-full overflow-hidden ml-1 max-w-[80px]">
                    <div className={`h-full ${STAGE_COLORS[s.stage] || 'bg-text-tertiary'} opacity-50`} style={{ width: `${pct}%` }} />
                  </div>
                </span>
                <span className="text-right text-text-secondary font-mono tabular-nums">{s.tokens.toLocaleString()}</span>
                <span className="text-right text-text-secondary font-mono tabular-nums">{formatDuration(s.durationMs)}</span>
                <span className="text-right text-text-secondary font-mono tabular-nums">
                  {s.attempts}
                  {s.attempts > 1 && <span className="text-accent-amber ml-0.5">!</span>}
                </span>
                <span className="text-right text-accent-green font-mono tabular-nums">${s.estimatedCost.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Models used */}
      {Object.keys(modelCounts).length > 0 && (
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary mb-3">Models Used</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(modelCounts).map(([model, count]) => (
              <span key={model} className="inline-flex items-center gap-1.5 bg-bg-secondary border border-border-default rounded-md px-2.5 py-1.5 text-[12px]">
                <span className="text-text-primary font-medium">{model}</span>
                <span className="text-text-tertiary">×{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
