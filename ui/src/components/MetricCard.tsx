import React from 'react';
import { GlassCard } from './GlassCard.js';

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'flat';
  icon?: React.ReactNode;
}

const TREND_COLORS = {
  up: 'text-accent-green',
  down: 'text-accent-red',
  flat: 'text-text-tertiary',
} as const;

const TREND_SYMBOLS = {
  up: '↑',
  down: '↓',
  flat: '→',
} as const;

export const MetricCard: React.FC<MetricCardProps> = ({ label, value, trend, icon }) => (
  <GlassCard padding="lg">
    <div className="flex items-start justify-between">
      <div>
        <div className="text-2xl font-bold font-heading text-text-primary">{value}</div>
        <div className="text-sm text-text-secondary mt-1">{label}</div>
      </div>
      {icon && <div className="text-text-tertiary">{icon}</div>}
    </div>
    {trend && (
      <div className={`mt-2 text-xs font-medium ${TREND_COLORS[trend]}`} data-trend={trend}>
        {TREND_SYMBOLS[trend]} {trend}
      </div>
    )}
  </GlassCard>
);
