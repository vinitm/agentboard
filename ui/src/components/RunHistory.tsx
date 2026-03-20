import React, { useState } from 'react';
import { CopyButton } from './CopyButton';
import { Markdown } from './Markdown';
import type { Run } from '../types';

interface Props { runs: Run[] }

const statusColor: Record<string, string> = {
  running: 'text-accent-blue', success: 'text-accent-green', failed: 'text-accent-red', cancelled: 'text-text-tertiary',
};

export const RunHistory: React.FC<Props> = ({ runs }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (runs.length === 0) return <div className="text-sm text-text-secondary p-1">No runs yet.</div>;

  return (
    <div className="space-y-1.5">
      {runs.map((run) => {
        const isExpanded = expandedId === run.id;
        const duration = run.finishedAt && run.startedAt
          ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
          : null;
        return (
          <div key={run.id} className="bg-bg-secondary rounded-md overflow-hidden border border-border-default">
            <div className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-bg-tertiary transition-colors" role="button" tabIndex={0} onClick={() => setExpandedId(isExpanded ? null : run.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isExpanded ? null : run.id); } }}>
              <div className="flex items-center gap-2 flex-wrap text-[13px]">
                <span className="font-semibold text-text-primary">{run.stage}</span>
                <span className={`font-semibold ${statusColor[run.status] || 'text-text-tertiary'}`}>{run.status}</span>
                <span className="text-text-tertiary text-xs">attempt #{run.attempt}</span>
                {run.modelUsed && <span className="text-text-tertiary text-xs">{run.modelUsed}</span>}
                {run.tokensUsed != null && <span className="text-text-tertiary text-xs">{run.tokensUsed.toLocaleString()} tokens</span>}
                {duration != null && <span className="text-text-tertiary text-xs">{duration}s</span>}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                {new Date(run.startedAt).toLocaleString()}
                <svg className={`w-4 h-4 text-text-tertiary transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            {isExpanded && run.output && (
              <div className="relative bg-bg-primary text-xs text-text-primary p-3 max-h-[300px] overflow-y-auto border-t border-border-default">
                <div className="absolute top-2 right-2 z-10">
                  <CopyButton text={run.output} />
                </div>
                {run.output.trimStart().startsWith('{') || run.output.trimStart().startsWith('[')
                  ? <pre className="whitespace-pre-wrap break-all m-0 font-mono">{run.output}</pre>
                  : <Markdown>{run.output}</Markdown>
                }
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
