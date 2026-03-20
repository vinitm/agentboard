import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

interface StageCost {
  stage: string;
  totalTokens: number;
  totalDurationMs: number;
  taskCount: number;
  avgTokensPerTask: number;
  avgDurationPerTask: number;
  estimatedCost: number;
  percentage: number;
}

interface BreakdownResponse {
  projectId: string;
  costPerMillion: number;
  totalTokens: number;
  estimatedTotalCost: number;
  stages: StageCost[];
}

interface TrendPoint {
  date: string;
  totalTokens: number;
  totalDurationMs: number;
  taskCount: number;
  estimatedCost: number;
}

interface TrendResponse {
  projectId: string;
  days: number;
  costPerMillion: number;
  points: TrendPoint[];
}

interface Props {
  projectId: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatCost(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

const STAGE_COLORS: Record<string, string> = {
  spec_review: 'bg-accent-blue',
  planning: 'bg-accent-purple',
  implementing: 'bg-green-500',
  checks: 'bg-yellow-500',
  inline_fix: 'bg-orange-500',
  code_quality: 'bg-cyan-500',
  final_review: 'bg-pink-500',
  pr_creation: 'bg-indigo-500',
  learner: 'bg-gray-500',
};

const StatCard: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="bg-bg-secondary border border-border-default rounded-lg p-4">
    <div className="text-[11px] uppercase tracking-wider text-text-tertiary mb-1">{label}</div>
    <div className="text-2xl font-semibold text-text-primary">{value}</div>
    {sub && <div className="text-xs text-text-secondary mt-0.5">{sub}</div>}
  </div>
);

const BarSegment: React.FC<{ stage: StageCost; maxTokens: number }> = ({ stage, maxTokens }) => {
  const width = maxTokens > 0 ? Math.max((stage.totalTokens / maxTokens) * 100, 2) : 0;
  const colorClass = STAGE_COLORS[stage.stage] ?? 'bg-gray-400';

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-28 text-xs text-text-secondary truncate font-mono">{stage.stage.replace(/_/g, ' ')}</div>
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 bg-bg-tertiary rounded-full h-5 overflow-hidden">
          <div
            className={`h-full rounded-full ${colorClass} transition-all duration-500`}
            style={{ width: `${width}%` }}
          />
        </div>
        <div className="w-16 text-xs text-text-secondary text-right">{formatTokens(stage.totalTokens)}</div>
        <div className="w-14 text-xs text-text-tertiary text-right">{stage.percentage}%</div>
        <div className="w-16 text-xs text-accent-green text-right font-mono">{formatCost(stage.estimatedCost)}</div>
      </div>
    </div>
  );
};

const TrendChart: React.FC<{ points: TrendPoint[] }> = ({ points }) => {
  if (points.length === 0) {
    return <div className="text-sm text-text-tertiary py-8 text-center">No data yet</div>;
  }

  const maxCost = Math.max(...points.map(p => p.estimatedCost), 0.01);
  const maxTokens = Math.max(...points.map(p => p.totalTokens), 1);

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-[2px] h-32">
        {points.map((p, i) => {
          const height = Math.max((p.estimatedCost / maxCost) * 100, 3);
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end group relative">
              <div
                className="w-full bg-accent-blue rounded-t transition-all duration-300 hover:bg-accent-blue/80 min-w-[4px]"
                style={{ height: `${height}%` }}
              />
              <div className="absolute bottom-full mb-2 hidden group-hover:block bg-bg-elevated border border-border-default rounded-md px-2 py-1 text-[11px] whitespace-nowrap z-10 shadow-lg">
                <div className="text-text-primary font-medium">{p.date}</div>
                <div className="text-text-secondary">{formatTokens(p.totalTokens)} tokens</div>
                <div className="text-accent-green">{formatCost(p.estimatedCost)}</div>
                <div className="text-text-tertiary">{p.taskCount} task{p.taskCount !== 1 ? 's' : ''}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-text-tertiary px-1">
        <span>{points[0].date}</span>
        <span>{points[points.length - 1].date}</span>
      </div>
    </div>
  );
};

export const CostDashboard: React.FC<Props> = ({ projectId }) => {
  const [breakdown, setBreakdown] = useState<BreakdownResponse | null>(null);
  const [trend, setTrend] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);

    Promise.all([
      api.get<BreakdownResponse>(`/api/projects/${projectId}/costs/breakdown`),
      api.get<TrendResponse>(`/api/projects/${projectId}/costs/trend?days=${days}`),
    ])
      .then(([b, t]) => {
        setBreakdown(b);
        setTrend(t);
      })
      .catch(() => {
        setBreakdown(null);
        setTrend(null);
      })
      .finally(() => setLoading(false));
  }, [projectId, days]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-6 animate-fade-in">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-bg-secondary border border-border-default rounded-lg p-4">
              <div className="skeleton h-3 w-20 mb-2" />
              <div className="skeleton h-7 w-16" />
            </div>
          ))}
        </div>
        <div className="bg-bg-secondary border border-border-default rounded-lg p-5">
          <div className="skeleton h-4 w-32 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="skeleton h-3 w-24" />
                <div className="flex-1 skeleton h-5 rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="bg-bg-secondary border border-border-default rounded-lg p-5">
          <div className="skeleton h-4 w-32 mb-4" />
          <div className="skeleton h-32 w-full rounded" />
        </div>
      </div>
    );
  }

  const totalCost = breakdown?.estimatedTotalCost ?? 0;
  const totalTokens = breakdown?.totalTokens ?? 0;
  const stageCount = breakdown?.stages.length ?? 0;
  const totalTasks = breakdown?.stages.reduce((max, s) => Math.max(max, s.taskCount), 0) ?? 0;
  const maxTokens = breakdown?.stages.length
    ? Math.max(...breakdown.stages.map(s => s.totalTokens))
    : 0;

  const trendTotal = trend?.points.reduce((sum, p) => sum + p.estimatedCost, 0) ?? 0;
  const trendTasks = trend?.points.reduce((sum, p) => sum + p.taskCount, 0) ?? 0;
  const avgCostPerTask = trendTasks > 0 ? trendTotal / trendTasks : 0;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6 animate-fade-in">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Spend" value={formatCost(totalCost)} sub={`${formatTokens(totalTokens)} tokens`} />
        <StatCard label="Tasks Processed" value={String(totalTasks)} sub={`across ${stageCount} stages`} />
        <StatCard label="Avg Cost / Task" value={formatCost(avgCostPerTask)} sub={`last ${days} days`} />
        <StatCard
          label="Most Expensive Stage"
          value={(() => {
            if (!breakdown?.stages.length) return '-';
            const most = breakdown.stages.reduce((a, b) => a.estimatedCost > b.estimatedCost ? a : b);
            return most.stage.replace(/_/g, ' ');
          })()}
          sub={(() => {
            if (!breakdown?.stages.length) return undefined;
            const most = breakdown.stages.reduce((a, b) => a.estimatedCost > b.estimatedCost ? a : b);
            return `${most.percentage}% of total`;
          })()}
        />
      </div>

      {/* Stage breakdown */}
      <div className="bg-bg-secondary border border-border-default rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary">Cost by Stage</h2>
          <div className="text-xs text-text-tertiary">
            Blended rate: ${breakdown?.costPerMillion ?? 30}/M tokens
          </div>
        </div>
        {breakdown && breakdown.stages.length > 0 ? (
          <div className="space-y-0">
            {breakdown.stages.map(s => (
              <BarSegment key={s.stage} stage={s} maxTokens={maxTokens} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-text-tertiary py-8 text-center">
            No stage data yet. Run some tasks to see cost breakdown.
          </div>
        )}
      </div>

      {/* Trend chart */}
      <div className="bg-bg-secondary border border-border-default rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary">Daily Cost Trend</h2>
          <div className="flex gap-1">
            {[7, 14, 30, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  days === d
                    ? 'bg-accent-blue text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <TrendChart points={trend?.points ?? []} />
        {trend && trend.points.length > 0 && (
          <div className="flex gap-6 mt-4 pt-3 border-t border-border-default text-xs text-text-secondary">
            <span>Period total: <span className="text-accent-green font-mono">{formatCost(trendTotal)}</span></span>
            <span>Tasks: <span className="text-text-primary">{trendTasks}</span></span>
            <span>Avg/day: <span className="text-text-primary font-mono">{formatCost(trendTotal / Math.max(trend.points.length, 1))}</span></span>
          </div>
        )}
      </div>
    </div>
  );
};
