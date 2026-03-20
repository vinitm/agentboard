import React from 'react';
import type { Stage, StageLogStatus } from '../types';

interface ProgressStepperProps {
  stages: Stage[];
  currentStage?: Stage;
  stageStatuses: Partial<Record<Stage, StageLogStatus>>;
  blockedAtStage?: string;
  compact?: boolean;
}

function getStageVisual(
  stage: Stage,
  status: StageLogStatus | undefined,
  isCurrent: boolean,
  isBlocked: boolean,
): { dot: string; status: string } {
  if (isBlocked) return { dot: 'bg-accent-red glow-error', status: 'blocked' };
  if (status === 'completed') return { dot: 'bg-accent-green', status: 'completed' };
  if (status === 'failed') return { dot: 'bg-accent-red', status: 'failed' };
  if (isCurrent || status === 'running') return { dot: 'bg-accent-blue animate-pulse-dot glow-primary', status: 'running' };
  return { dot: 'bg-border-default', status: 'pending' };
}

export const ProgressStepper: React.FC<ProgressStepperProps> = ({
  stages,
  currentStage,
  stageStatuses,
  blockedAtStage,
  compact = false,
}) => {
  const dotSize = compact ? 'w-1.5 h-1.5' : 'w-2 h-2';

  return (
    <div className="flex items-center gap-0.5">
      {stages.map((stage, i) => {
        const visual = getStageVisual(
          stage,
          stageStatuses[stage],
          stage === currentStage,
          stage === blockedAtStage,
        );
        return (
          <React.Fragment key={stage}>
            {i > 0 && (
              <div className={`flex-1 min-w-1 h-0.5 ${
                stageStatuses[stages[i - 1]] === 'completed' ? 'bg-accent-green' : 'bg-border-default'
              }`} />
            )}
            <div
              data-stage={stage}
              data-status={visual.status}
              className={`rounded-full ${dotSize} ${visual.dot}`}
              title={`${stage.replace(/_/g, ' ')} — ${visual.status}`}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
};
