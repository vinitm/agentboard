import React from 'react';

interface Props {
  label: string;
  value: string;
  isNew?: boolean;
}

export const SpecField: React.FC<Props> = ({ label, value, isNew }) => {
  const hasFill = value.trim().length > 0;

  return (
    <div
      className={`mb-3 rounded-md border-l-[3px] px-3 py-2 transition-all duration-300 ${
        hasFill
          ? 'border-l-accent-green bg-accent-green/5'
          : 'border-l-border-default bg-bg-tertiary/50'
      } ${isNew ? 'animate-fade-in' : ''}`}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-0.5">
        {label}
      </div>
      {hasFill ? (
        <p className="text-[12px] text-text-primary whitespace-pre-wrap leading-relaxed">
          {value}
        </p>
      ) : (
        <p className="text-[11px] text-text-tertiary italic">Not yet filled</p>
      )}
    </div>
  );
};
