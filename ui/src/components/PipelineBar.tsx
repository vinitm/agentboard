import React from 'react';
import type { TaskStatus } from '../types';

const STAGES = [
  'spec_review', 'planning', 'implementing', 'checks',
  'code_quality', 'final_review', 'pr_creation',
] as const;

const STAGE_LABELS: Record<string, string> = {
  spec_review: 'Spec', planning: 'Plan', implementing: 'Impl',
  checks: 'Checks', code_quality: 'Quality', final_review: 'Final', pr_creation: 'PR',
};

function getStageIndex(status: TaskStatus): number {
  if (status === 'needs_plan_review') return 1; // maps to planning
  if (status === 'needs_human_review' || status === 'done') return STAGES.length;
  return STAGES.indexOf(status as typeof STAGES[number]);
}

interface Props {
  status: TaskStatus;
  showLabels?: boolean;
}

export const PipelineBar: React.FC<Props> = ({ status, showLabels = false }) => {
  const currentIdx = getStageIndex(status);
  const isDone = currentIdx >= STAGES.length;
  const isFailed = status === 'failed';
  const isHumanPause = status === 'needs_plan_review' || status === 'needs_human_review';
  const completedCount = isDone ? STAGES.length : Math.max(0, currentIdx);

  if (currentIdx < 0 && !isFailed) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-0.5">
        {STAGES.map((stage, i) => {
          const isCompleted = isDone || i < currentIdx;
          const isCurrent = i === currentIdx && !isDone;
          const isFailedStage = isFailed && i === currentIdx;

          let bgClass = 'bg-bg-elevated';
          if (isCompleted) bgClass = 'bg-accent-green';
          else if (isFailedStage) bgClass = 'bg-accent-red';
          else if (isCurrent && isHumanPause) bgClass = 'bg-accent-amber animate-pulse-dot';
          else if (isCurrent) bgClass = 'bg-accent-purple animate-pulse-dot';

          return (
            <div
              key={stage}
              data-segment
              data-stage={stage}
              data-completed={isCompleted ? 'true' : 'false'}
              data-current={isCurrent ? 'true' : 'false'}
              className={`flex-1 h-1.5 rounded-sm ${bgClass} transition-colors`}
              title={STAGE_LABELS[stage]}
            />
          );
        })}
        <span className="text-[10px] text-text-tertiary ml-1.5 tabular-nums whitespace-nowrap">
          {completedCount}/{STAGES.length}
        </span>
      </div>
      {showLabels && (
        <div className="flex items-center gap-0.5">
          {STAGES.map((stage, i) => {
            const isCurrent = i === currentIdx && !isDone;
            return (
              <span
                key={stage}
                className={`flex-1 text-[9px] text-center truncate ${
                  isCurrent ? 'text-text-primary font-medium' : 'text-text-tertiary'
                }`}
              >
                {STAGE_LABELS[stage]}
              </span>
            );
          })}
          <span className="w-8" />
        </div>
      )}
    </div>
  );
};
