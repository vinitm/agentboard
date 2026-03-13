import React, { useState } from 'react';

interface Props {
  text: string;
  className?: string;
}

export const CopyButton: React.FC<Props> = ({ text, className = '' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className={`px-2 py-0.5 rounded text-[11px] bg-bg-elevated border border-border-default text-text-tertiary hover:text-text-primary transition-colors ${className}`}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
};
