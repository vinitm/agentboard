import React, { useState } from 'react';
import { StageRow } from './StageRow';
import type { StageLog, StageLogStatus } from '../types';

const STAGE_LABELS: Record<string, string> = {
  implementing: 'Impl',
  checks: 'Checks',
  inline_fix: 'Fix',
  code_quality: 'Quality',
};

const statusColor: Record<StageLogStatus, string> = {
  completed: 'bg-accent-green/15 text-accent-green border-accent-green/30',
  running: 'bg-accent-purple/15 text-accent-purple border-accent-purple/30',
  failed: 'bg-accent-red/15 text-accent-red border-accent-red/30',
  skipped: 'bg-bg-tertiary text-text-tertiary border-border-default',
};

const subtaskStatusIcon: Record<string, string> = {
  done: 'text-accent-green',
  failed: 'text-accent-red',
  running: 'text-accent-purple',
};

interface Props {
  stages: StageLog[];
  taskId: string;
  subtasks: Array<{ id: string; title: string; status: string }>;
  liveChunks: Map<string, string[]>;
}

export const SubtaskStages: React.FC<Props> = ({ stages, taskId, subtasks, liveChunks }) => {
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);

  // Group stages by subtaskId
  const stagesBySubtask = new Map<string, StageLog[]>();
  for (const stage of stages) {
    if (!stage.subtaskId) continue;
    const existing = stagesBySubtask.get(stage.subtaskId) || [];
    stagesBySubtask.set(stage.subtaskId, [...existing, stage]);
  }

  // Build ordered subtask list (use subtasks prop for ordering/names, fall back to stage data)
  const subtaskMap = new Map(subtasks.map(s => [s.id, s]));
  const subtaskIds = subtasks.length > 0
    ? subtasks.map(s => s.id)
    : Array.from(stagesBySubtask.keys());

  if (subtaskIds.length === 0) return null;

  return (
    <div className="space-y-2">
      {subtaskIds.map(subtaskId => {
        const subtaskInfo = subtaskMap.get(subtaskId);
        const subtaskStages = stagesBySubtask.get(subtaskId) || [];
        if (subtaskStages.length === 0 && !subtaskInfo) return null;

        const isRunning = subtaskStages.some(s => s.status === 'running');
        const isDone = subtaskInfo?.status === 'done';
        const isFailed = subtaskInfo?.status === 'failed';
        const displayTitle = subtaskInfo?.title || `Subtask ${subtaskId.slice(0, 8)}`;
        const statusClass = isFailed ? subtaskStatusIcon.failed : isDone ? subtaskStatusIcon.done : isRunning ? subtaskStatusIcon.running : 'text-text-tertiary';

        return (
          <div key={subtaskId} className="border border-border-default rounded-lg bg-bg-secondary">
            {/* Subtask header */}
            <div className="flex items-center gap-2 px-3 py-2">
              {isDone ? (
                <svg className={`w-3.5 h-3.5 ${statusClass}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : isFailed ? (
                <svg className={`w-3.5 h-3.5 ${statusClass}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              ) : isRunning ? (
                <span className={`w-2 h-2 rounded-full bg-accent-purple animate-pulse-dot`} />
              ) : (
                <span className="w-2 h-2 rounded-full bg-text-tertiary" />
              )}
              <span className="text-xs font-medium text-text-primary truncate flex-1">{displayTitle}</span>
              <span className={`text-[10px] font-semibold uppercase ${statusClass}`}>
                {subtaskInfo?.status || (isRunning ? 'running' : 'pending')}
              </span>
            </div>

            {/* Stage pills */}
            {subtaskStages.length > 0 && (
              <div className="px-3 pb-2 flex flex-wrap gap-1">
                {subtaskStages.map(stage => {
                  const isStageExpanded = expandedStageId === stage.id;
                  const label = STAGE_LABELS[stage.stage] || stage.stage;
                  const colorClass = statusColor[stage.status];

                  return (
                    <div key={stage.id} className="flex flex-col">
                      <button
                        onClick={() => setExpandedStageId(isStageExpanded ? null : stage.id)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${colorClass} transition-colors hover:opacity-80`}
                      >
                        {stage.status === 'running' && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse-dot mr-1" />
                        )}
                        {label}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Expanded stage detail */}
            {expandedStageId && subtaskStages.some(s => s.id === expandedStageId) && (
              <div className="px-2 pb-2">
                {subtaskStages.filter(s => s.id === expandedStageId).map(stage => {
                  const chunkKey = `${stage.subtaskId}-${stage.stage}`;
                  return (
                    <StageRow
                      key={stage.id}
                      stageLog={stage}
                      taskId={taskId}
                      isActive={stage.status === 'running'}
                      isExpanded={true}
                      onToggle={() => setExpandedStageId(null)}
                      liveChunks={liveChunks.get(chunkKey) || []}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
