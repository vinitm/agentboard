import React from 'react';

interface GlassCardProps {
  variant?: 'default' | 'highlighted' | 'error';
  padding?: 'sm' | 'md' | 'lg';
  glow?: boolean;
  className?: string;
  children: React.ReactNode;
}

const VARIANT_CLASSES = {
  default: 'border-border-default',
  highlighted: 'border-accent-blue',
  error: 'border-accent-red',
} as const;

const GLOW_CLASSES = {
  default: 'glow-primary',
  highlighted: 'glow-secondary',
  error: 'glow-error',
} as const;

const PADDING_CLASSES = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
} as const;

export const GlassCard: React.FC<GlassCardProps> = ({
  variant = 'default',
  padding = 'md',
  glow = false,
  className = '',
  children,
}) => (
  <div
    className={`glass-surface border rounded-lg ${VARIANT_CLASSES[variant]} ${PADDING_CLASSES[padding]} ${glow ? GLOW_CLASSES[variant] : ''} ${className}`}
  >
    {children}
  </div>
);
