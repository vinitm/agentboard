import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api/client';
import { CopyButton } from './CopyButton';
import type { StageLog, StageLogStatus } from '../types';

const STAGE_LABELS: Record<string, string> = {
  spec_review: 'Spec Review',
  planning: 'Planning',
  implementing: 'Implementing',
  checks: 'Checks',
  inline_fix: 'Inline Fix',
  code_quality: 'Code Quality',
  final_review: 'Final Review',
  pr_creation: 'PR Creation',
  learner: 'Learning',
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function formatTokens(tokens: number | null): string {
  if (tokens === null) return '';
  if (tokens < 1000) return `${tokens} tok`;
  return `${(tokens / 1000).toFixed(1)}k tok`;
}

const StatusIcon: React.FC<{ status: StageLogStatus }> = ({ status }) => {
  switch (status) {
    case 'completed':
      return (
        <svg className="w-4 h-4 text-accent-green flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      );
    case 'running':
      return <span className="w-2.5 h-2.5 rounded-full bg-accent-purple animate-pulse-dot flex-shrink-0" />;
    case 'failed':
      return (
        <svg className="w-4 h-4 text-accent-red flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      );
    case 'skipped':
      return <span className="w-4 h-4 text-text-tertiary flex-shrink-0 text-center leading-4">-</span>;
    default:
      return <span className="w-2 h-2 rounded-full bg-text-tertiary flex-shrink-0" />;
  }
};

interface Props {
  stageLog: StageLog;
  taskId: number;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  liveChunks: string[];
}

export const StageRow: React.FC<Props> = ({ stageLog, taskId, isActive, isExpanded, onToggle, liveChunks }) => {
  const [logContent, setLogContent] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch log content when expanded
  useEffect(() => {
    if (!isExpanded || logContent !== null || loadingLogs) return;
    setLoadingLogs(true);
    api.getStageLogContent(taskId, stageLog.id)
      .then(setLogContent)
      .catch(() => setLogContent(''))
      .finally(() => setLoadingLogs(false));
  }, [isExpanded, taskId, stageLog.id, logContent, loadingLogs]);

  // Auto-scroll when new chunks arrive
  useEffect(() => {
    if (isExpanded && !userScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveChunks, isExpanded, userScrolledUp]);

  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setUserScrolledUp(!isAtBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    setUserScrolledUp(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const label = STAGE_LABELS[stageLog.stage] || stageLog.stage;
  const displayContent = [logContent || '', ...liveChunks].join('');

  return (
    <div className={`border rounded-lg transition-colors ${
      isActive ? 'border-accent-purple/40 bg-accent-purple/5' :
      stageLog.status === 'failed' ? 'border-accent-red/30 bg-accent-red/5' :
      stageLog.status === 'completed' ? 'border-border-default bg-bg-secondary' :
      'border-border-default bg-bg-secondary'
    }`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-bg-tertiary/50 rounded-lg transition-colors"
      >
        <svg className={`w-3 h-3 text-text-tertiary flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <StatusIcon status={stageLog.status} />
        <span className="text-sm font-medium text-text-primary flex-1">{label}</span>
        {stageLog.attempt > 1 && (
          <span className="text-[10px] text-accent-amber bg-accent-amber/10 px-1.5 py-0.5 rounded font-medium">
            attempt {stageLog.attempt}
          </span>
        )}
        {stageLog.durationMs !== null && (
          <span className="text-[11px] text-text-tertiary font-mono">{formatDuration(stageLog.durationMs)}</span>
        )}
        {stageLog.tokensUsed !== null && (
          <span className="text-[11px] text-text-tertiary font-mono">{formatTokens(stageLog.tokensUsed)}</span>
        )}
      </button>

      {/* Summary */}
      {stageLog.summary && !isExpanded && (
        <div className="px-3 pb-2 -mt-1">
          <p className="text-[11px] text-text-tertiary truncate pl-[38px]">{stageLog.summary}</p>
        </div>
      )}

      {/* Expanded log content */}
      {isExpanded && (
        <div className="border-t border-border-default">
          {stageLog.summary && (
            <div className="px-3 py-2 border-b border-border-default">
              <p className="text-xs text-text-secondary">{stageLog.summary}</p>
            </div>
          )}
          <div className="relative">
            {displayContent && (
              <div className="absolute top-2 right-2 z-10 flex gap-1.5">
                <CopyButton text={displayContent} />
              </div>
            )}
            <div
              ref={contentRef}
              onScroll={handleScroll}
              className="font-mono text-xs text-text-primary leading-relaxed p-3 max-h-[400px] overflow-y-auto"
            >
              {loadingLogs ? (
                <div className="text-text-tertiary">Loading logs...</div>
              ) : displayContent ? (
                <pre className="whitespace-pre-wrap break-all m-0">{displayContent}</pre>
              ) : (
                <div className="text-text-tertiary">No log content available</div>
              )}
              <div ref={bottomRef} />
            </div>
            {userScrolledUp && isActive && (
              <button
                onClick={scrollToBottom}
                className="absolute bottom-3 right-3 px-2.5 py-1 rounded-md text-[11px] font-medium bg-accent-blue text-white hover:bg-blue-600 transition-colors shadow-lg"
              >
                Follow live ↓
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
