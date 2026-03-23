import React, { useMemo } from 'react';
import { parseLogText, groupIntoBlocks, type ParsedLogLine } from '../lib/parse-log-lines.js';
import { Markdown } from './Markdown.js';

interface Props {
  text: string;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

function MetaBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] bg-bg-tertiary text-text-tertiary rounded px-1.5 py-0.5 font-mono">
      <span className="text-text-quaternary">{label}</span>{value}
    </span>
  );
}

const LogLine: React.FC<{ line: ParsedLogLine }> = ({ line }) => {
  switch (line.type) {
    case 'separator':
      return <div className="border-b border-border-default my-2" />;

    case 'header':
      return (
        <div className="font-semibold text-text-primary text-xs py-1">
          {line.content}
        </div>
      );

    case 'stage':
      return (
        <div className="flex items-center gap-2 py-1.5 mt-2 border-b border-accent-purple/20">
          <span className="text-accent-purple font-semibold text-xs">STAGE</span>
          <span className="text-text-primary text-xs font-medium">{line.content.split('(')[0].trim()}</span>
          <div className="flex gap-1.5 ml-auto">
            {line.metadata.run && <MetaBadge label="run " value={line.metadata.run} />}
            {line.metadata.attempt && <MetaBadge label="attempt " value={line.metadata.attempt} />}
          </div>
        </div>
      );

    case 'subtask':
      return (
        <div className="flex items-center gap-2 py-1.5 mt-2 border-b border-accent-blue/20">
          <span className="text-accent-blue font-semibold text-xs">SUBTASK</span>
          <span className="text-text-primary text-xs font-medium">{line.content}</span>
        </div>
      );

    case 'event':
      return (
        <div className="flex items-center gap-2 py-1 mt-1">
          <span className="text-accent-amber font-semibold text-[10px] uppercase tracking-wider">EVENT</span>
          <span className="text-text-secondary text-xs">{line.content.replace(/_/g, ' ')}</span>
        </div>
      );

    case 'start':
      return (
        <div className="flex items-center gap-2 py-0.5 text-text-tertiary">
          {line.timestamp && (
            <span className="text-[10px] font-mono text-text-quaternary w-16 flex-shrink-0">{formatTimestamp(line.timestamp)}</span>
          )}
          <span className="text-[10px] font-medium text-accent-green/70 uppercase">start</span>
          <div className="flex gap-1.5">
            {Object.entries(line.metadata).map(([k, v]) => (
              <MetaBadge key={k} label={`${k} `} value={v} />
            ))}
          </div>
        </div>
      );

    case 'end':
      return (
        <div className="flex items-center gap-2 py-0.5 text-text-tertiary">
          {line.timestamp && (
            <span className="text-[10px] font-mono text-text-quaternary w-16 flex-shrink-0">{formatTimestamp(line.timestamp)}</span>
          )}
          <span className={`text-[10px] font-medium uppercase ${
            line.metadata.status === 'completed' ? 'text-accent-green/70' :
            line.metadata.status === 'failed' ? 'text-accent-red/70' :
            'text-text-tertiary'
          }`}>end</span>
          <div className="flex gap-1.5">
            {Object.entries(line.metadata).map(([k, v]) => (
              <MetaBadge key={k} label={`${k} `} value={v} />
            ))}
          </div>
        </div>
      );

    case 'error':
      return (
        <div className="flex items-start gap-2 py-0.5 bg-red-500/10 rounded px-1.5 -mx-1.5">
          {line.timestamp && (
            <span className="text-[10px] font-mono text-red-400/60 w-16 flex-shrink-0">{formatTimestamp(line.timestamp)}</span>
          )}
          <span className="text-[10px] font-bold text-red-400 flex-shrink-0">ERROR</span>
          <span className="text-xs text-red-300">{line.content}</span>
        </div>
      );

    case 'timestamp':
    case 'content':
      // Should not reach here when using block-based rendering,
      // but kept as fallback for safety
      if (!line.content.trim()) return <div className="h-1" />;
      return (
        <div className="text-xs text-text-primary whitespace-pre-wrap break-words">
          {line.content}
        </div>
      );

    default:
      return <div className="text-xs text-text-primary whitespace-pre-wrap">{line.content}</div>;
  }
};

export const LogRenderer: React.FC<Props> = ({ text }) => {
  const blocks = useMemo(() => {
    const lines = parseLogText(text);
    return groupIntoBlocks(lines);
  }, [text]);

  if (blocks.length === 0) return null;

  return (
    <div className="space-y-0">
      {blocks.map((block, i) =>
        block.kind === 'markdown' ? (
          <div key={i} className="flex items-start gap-2 py-0.5">
            {block.timestamp && (
              <span className="text-[10px] font-mono text-text-quaternary w-16 flex-shrink-0 pt-0.5">
                {formatTimestamp(block.timestamp)}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <Markdown compact>{block.text}</Markdown>
            </div>
          </div>
        ) : (
          <LogLine key={i} line={block.line} />
        )
      )}
    </div>
  );
};
