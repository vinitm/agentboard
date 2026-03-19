import React from 'react';
import { timeAgo } from '../lib/time';
import type { Task } from '../types';

interface Props {
  task: Task;
  onClick: () => void;
  selected?: boolean;
}

const riskDotColor: Record<string, string> = {
  low: 'bg-accent-green',
  medium: 'bg-accent-amber',
  high: 'bg-accent-red',
};

function leftBorderClass(task: Task): string {
  if (task.status === 'blocked') return 'border-l-accent-amber';
  if (task.status === 'failed') return 'border-l-accent-red';
  if (task.status === 'needs_human_review') return 'border-l-accent-pink';
  if (task.status === 'needs_plan_review') return 'border-l-accent-amber';
  if (task.claimedBy) return 'border-l-accent-purple';
  return 'border-l-transparent';
}

// Pipeline stages in order
const PIPELINE_STAGES = ['spec_review', 'planning', 'needs_plan_review', 'implementing', 'checks', 'code_quality', 'final_review', 'pr_creation'] as const;
const STAGE_LABELS: Record<string, string> = {
  spec_review: 'S', planning: 'P', needs_plan_review: 'R', implementing: 'I', checks: 'C', code_quality: 'Q', final_review: 'F', pr_creation: 'PR',
};

function getStageIndex(status: string): number {
  const idx = PIPELINE_STAGES.indexOf(status as typeof PIPELINE_STAGES[number]);
  return idx >= 0 ? idx : -1;
}

const PipelineIndicator: React.FC<{ status: string }> = ({ status }) => {
  const currentIdx = getStageIndex(status);
  const isDone = status === 'done' || status === 'needs_human_review';
  const isFailed = status === 'failed';

  // Only show for tasks that are in or past the pipeline
  if (currentIdx < 0 && !isDone && !isFailed) return null;

  return (
    <div className="flex items-center gap-0.5 mt-2">
      {PIPELINE_STAGES.map((stage, i) => {
        let dotClass = 'bg-bg-elevated'; // future
        if (isDone || (currentIdx >= 0 && i < currentIdx)) {
          dotClass = 'bg-accent-green'; // completed
        } else if (isFailed && currentIdx >= 0 && i === currentIdx) {
          dotClass = 'bg-accent-red'; // failed at this stage
        } else if (i === currentIdx) {
          dotClass = stage === 'needs_plan_review'
            ? 'bg-accent-amber animate-pulse-dot' // human checkpoint
            : 'bg-accent-purple animate-pulse-dot'; // current
        }
        const isCompleted = isDone || (currentIdx >= 0 && i < currentIdx);
        const isCurrent = i === currentIdx && !isDone && !isFailed;
        const isFailedStage = isFailed && currentIdx >= 0 && i === currentIdx;
        return (
          <div key={stage} className="flex items-center gap-0.5">
            <div
              className={`w-1.5 h-1.5 transition-colors ${isFailedStage ? 'bg-accent-red rotate-45' : isCompleted ? 'rounded-full bg-accent-green' : isCurrent ? 'rounded-full ring-1 ring-current ' + dotClass : 'rounded-full ' + dotClass}`}
              title={stage.replace('_', ' ')}
              aria-label={isCompleted ? 'completed' : isCurrent ? 'current' : isFailedStage ? 'failed' : 'pending'}
            />
            {i < PIPELINE_STAGES.length - 1 && (
              <div className={`w-2 h-px ${
                isDone || (currentIdx >= 0 && i < currentIdx) ? 'bg-accent-green' : 'bg-bg-elevated'
              } transition-colors`} />
            )}
          </div>
        );
      })}
      <span className="text-[9px] text-text-tertiary ml-1.5 uppercase tracking-wide">
        {isDone ? 'done' : isFailed ? 'failed' : PIPELINE_STAGES[currentIdx]?.replace('_', ' ')}
      </span>
    </div>
  );
};

export const TaskCard: React.FC<Props> = ({ task, onClick, selected }) => {
  const isRunning = !!task.claimedBy;

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      tabIndex={0}
      role="button"
      aria-label={`Task #${task.id}: ${task.title}, ${task.riskLevel} risk, ${task.status.replace(/_/g, ' ')}`}
      className={`bg-bg-secondary rounded-lg p-3 mb-2 border border-border-default border-l-[3px] ${leftBorderClass(task)} transition-all duration-150 animate-fade-in shadow-sm hover:bg-bg-tertiary hover:border-border-hover hover:shadow-md ${selected ? 'ring-2 ring-accent-blue' : ''} ${isRunning ? 'card-running' : ''}`}
    >
      {/* Title */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs text-gray-400 font-mono">#{task.id}</span>
        <span className="text-sm font-medium text-text-primary line-clamp-2">{task.title}</span>
      </div>

      {/* Description preview */}
      {task.description && (
        <div className="text-[11px] text-text-tertiary line-clamp-1 mb-1.5">{task.description}</div>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className={`w-2 h-2 rounded-full ${riskDotColor[task.riskLevel] || 'bg-text-tertiary'}`} aria-hidden="true" />
        <span className="text-text-tertiary">{task.riskLevel} risk</span>
        {task.priority > 0 && (
          <span className="text-text-tertiary bg-bg-tertiary px-1 py-px rounded text-[10px] font-semibold">
            P{task.priority}
          </span>
        )}
        <span className="text-text-tertiary ml-auto">{timeAgo(task.updatedAt)}</span>
        {isRunning && (
          <span className="flex items-center gap-1 text-accent-purple font-medium" aria-label="Running">
            <svg className="w-3 h-3 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </div>

      {/* Pipeline stage indicator */}
      <PipelineIndicator status={task.status} />
    </div>
  );
};
