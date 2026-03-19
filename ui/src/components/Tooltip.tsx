import React, { useState, useRef } from 'react';

interface Props {
  content: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
}

export const Tooltip: React.FC<Props> = ({ content, children, side = 'top' }) => {
  const [show, setShow] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  const enter = () => { timeout.current = setTimeout(() => setShow(true), 400); };
  const leave = () => { clearTimeout(timeout.current); setShow(false); };

  return (
    <span className="relative inline-flex" onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}>
      {children}
      {show && (
        <span
          role="tooltip"
          className={`absolute left-1/2 -translate-x-1/2 px-2 py-1 text-[11px] text-white bg-bg-elevated border border-border-default rounded-md shadow-lg whitespace-nowrap z-50 pointer-events-none animate-fade-in ${
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {content}
        </span>
      )}
    </span>
  );
};
