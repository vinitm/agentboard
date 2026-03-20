import React from 'react';
import { Button } from './Button.js';
import type { ButtonVariant } from './Button.js';

interface Action {
  label: string;
  variant: ButtonVariant;
  onClick: () => void;
  icon?: React.ReactNode;
  loading?: boolean;
}

interface ActionBarProps {
  actions: Action[];
  align?: 'left' | 'right' | 'split';
}

const ALIGN_CLASSES = {
  left: 'justify-start',
  right: 'justify-end',
  split: 'justify-between',
} as const;

const DESTRUCTIVE: Set<ButtonVariant> = new Set(['danger', 'warning']);

export const ActionBar: React.FC<ActionBarProps> = ({
  actions,
  align = 'right',
}) => {
  if (align === 'split') {
    const destructive = actions.filter((a) => DESTRUCTIVE.has(a.variant));
    const safe = actions.filter((a) => !DESTRUCTIVE.has(a.variant));

    return (
      <div className={`flex items-center gap-3 ${ALIGN_CLASSES[align]}`}>
        <div className="flex items-center gap-3">
          {destructive.map((a) => (
            <Button
              key={a.label}
              variant={a.variant}
              onClick={a.onClick}
              loading={a.loading}
            >
              {a.icon}
              {a.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {safe.map((a) => (
            <Button
              key={a.label}
              variant={a.variant}
              onClick={a.onClick}
              loading={a.loading}
            >
              {a.icon}
              {a.label}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 ${ALIGN_CLASSES[align]}`}>
      {actions.map((a) => (
        <Button
          key={a.label}
          variant={a.variant}
          onClick={a.onClick}
          loading={a.loading}
        >
          {a.icon}
          {a.label}
        </Button>
      ))}
    </div>
  );
};
