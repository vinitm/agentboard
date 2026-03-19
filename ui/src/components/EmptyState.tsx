import React from 'react';

interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<Props> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
    {icon && (
      <div className="w-14 h-14 rounded-2xl bg-bg-tertiary border border-border-default flex items-center justify-center mb-4">
        {icon}
      </div>
    )}
    <h3 className="text-sm font-semibold text-text-primary mb-1">{title}</h3>
    {description && (
      <p className="text-xs text-text-secondary max-w-sm">{description}</p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const PageSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="p-5 max-w-3xl mx-auto animate-fade-in space-y-3">
    <div className="flex gap-3 mb-6">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex-1 bg-bg-secondary border border-border-default rounded-lg p-4">
          <div className="skeleton h-3 w-16 mb-2" />
          <div className="skeleton h-6 w-20" />
        </div>
      ))}
    </div>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton h-12 w-full rounded-lg" />
    ))}
  </div>
);
