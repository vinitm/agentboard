import React, { useRef, useEffect } from 'react';

export interface LogLine {
  level: 'info' | 'warn' | 'error' | 'debug';
  timestamp?: string;
  message: string;
}

interface TerminalPanelProps {
  content: string | LogLine[];
  maxHeight?: string;
  autoScroll?: boolean;
  title?: string;
}

const LEVEL_COLORS: Record<LogLine['level'], string> = {
  info: 'text-text-primary',
  warn: 'text-accent-amber',
  error: 'text-accent-red',
  debug: 'text-text-tertiary',
};

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  content,
  maxHeight = '400px',
  autoScroll = true,
  title,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, autoScroll]);

  return (
    <div className="bg-bg-secondary rounded-lg overflow-hidden border border-border-default">
      {title && (
        <div className="px-3 py-2 border-b border-border-default text-xs font-semibold text-text-secondary uppercase tracking-wide">
          {title}
        </div>
      )}
      <div
        ref={scrollRef}
        className="p-3 font-mono text-[13px] leading-relaxed overflow-auto"
        style={{ maxHeight, scrollbarWidth: 'thin', scrollbarColor: '#262a31 transparent' }}
      >
        {typeof content === 'string' ? (
          <pre className="whitespace-pre-wrap text-text-primary">{content}</pre>
        ) : (
          content.map((line, i) => (
            <div key={i} className={LEVEL_COLORS[line.level]}>
              {line.timestamp && <span className="text-text-tertiary mr-2">{line.timestamp}</span>}
              <span className="text-text-tertiary mr-1">[{line.level.toUpperCase().padEnd(5)}]</span>
              {line.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
