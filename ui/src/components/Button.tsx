import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent-blue text-white hover:bg-blue-600 focus-visible:ring-accent-blue',
  secondary: 'border border-border-hover text-text-secondary hover:text-text-primary hover:bg-bg-tertiary focus-visible:ring-accent-blue',
  danger: 'border border-accent-red text-accent-red hover:bg-accent-red hover:text-white focus-visible:ring-accent-red',
  warning: 'border border-accent-amber text-accent-amber hover:bg-accent-amber hover:text-white focus-visible:ring-accent-amber',
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary focus-visible:ring-accent-blue',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
};

export const Button: React.FC<Props> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}) => (
  <button
    disabled={disabled || loading}
    className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
    {...props}
  >
    {loading && (
      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
      </svg>
    )}
    {children}
  </button>
);
