import React, { useState } from 'react';
import { CopyButton } from './CopyButton';
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
            <div className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-bg-tertiary transition-colors" onClick={() => setExpandedId(isExpanded ? null : run.id)}>
              <div className="flex items-center gap-2 flex-wrap text-[13px]">
                <span className="font-semibold text-text-primary">{run.stage}</span>
                <span className={`font-semibold ${statusColor[run.status] || 'text-text-tertiary'}`}>{run.status}</span>
                <span className="text-text-tertiary text-xs">attempt #{run.attempt}</span>
                {run.modelUsed && <span className="text-text-tertiary text-xs">{run.modelUsed}</span>}
                {run.tokensUsed != null && <span className="text-text-tertiary text-xs">{run.tokensUsed.toLocaleString()} tokens</span>}
                {duration != null && <span className="text-text-tertiary text-xs">{duration}s</span>}
              </div>
              <div className="text-[11px] text-text-tertiary">
                {new Date(run.startedAt).toLocaleString()} {isExpanded ? '[-]' : '[+]'}
              </div>
            </div>
            {isExpanded && run.output && (
              <div className="relative bg-bg-primary font-mono text-xs text-text-primary p-3 max-h-[200px] overflow-y-auto border-t border-border-default">
                <div className="absolute top-2 right-2">
                  <CopyButton text={run.output} />
                </div>
                <pre className="whitespace-pre-wrap break-all m-0">{run.output}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
