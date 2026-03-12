import React, { useState } from 'react';
import type { Run } from '../types';

interface Props {
  runs: Run[];
}

export const RunHistory: React.FC<Props> = ({ runs }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <div style={{ fontSize: 13, color: '#9ca3af', padding: 4 }}>
        No runs yet.
      </div>
    );
  }

  return (
    <div>
      {runs.map((run) => {
        const isExpanded = expandedId === run.id;
        const duration = run.finishedAt && run.startedAt
          ? Math.round(
              (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
            )
          : null;

        return (
          <div key={run.id} style={runContainerStyle}>
            <div
              style={runHeaderStyle}
              onClick={() => setExpandedId(isExpanded ? null : run.id)}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{run.stage}</span>
                <span style={{ color: statusColor(run.status), fontSize: 12, fontWeight: 600 }}>
                  {run.status}
                </span>
                <span style={{ color: '#9ca3af', fontSize: 12 }}>attempt #{run.attempt}</span>
                {run.modelUsed && (
                  <span style={{ color: '#9ca3af', fontSize: 12 }}>{run.modelUsed}</span>
                )}
                {run.tokensUsed != null && (
                  <span style={{ color: '#9ca3af', fontSize: 12 }}>
                    {run.tokensUsed.toLocaleString()} tokens
                  </span>
                )}
                {duration != null && (
                  <span style={{ color: '#9ca3af', fontSize: 12 }}>{duration}s</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>
                {new Date(run.startedAt).toLocaleString()}
                {isExpanded ? ' [-]' : ' [+]'}
              </div>
            </div>
            {isExpanded && run.output && (
              <div style={outputStyle}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {run.output}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

function statusColor(s: string): string {
  return s === 'running' ? '#3b82f6' : s === 'success' ? '#22c55e' : s === 'failed' ? '#ef4444' : '#6b7280';
}

const runContainerStyle: React.CSSProperties = {
  background: '#f9fafb',
  borderRadius: 6,
  marginBottom: 6,
  overflow: 'hidden',
};

const runHeaderStyle: React.CSSProperties = {
  padding: '8px 10px',
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const outputStyle: React.CSSProperties = {
  background: '#1e1e2e',
  color: '#cdd6f4',
  fontFamily: 'monospace',
  fontSize: 12,
  padding: 10,
  maxHeight: 200,
  overflowY: 'auto',
};
