import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { SubtaskMiniCard } from './SubtaskMiniCard';
import type { Task } from '../types';

interface Props {
  task: Task;
  onClick: () => void;
  selected?: boolean;
  subtasks?: Task[];
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
  if (task.claimedBy) return 'border-l-accent-purple';
  return 'border-l-transparent';
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Pipeline stages in order
const PIPELINE_STAGES = ['spec', 'planning', 'implementing', 'checks', 'review_panel'] as const;
const STAGE_LABELS: Record<string, string> = {
  spec: 'S', planning: 'P', implementing: 'I', checks: 'C', review_panel: 'R',
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
          dotClass = 'bg-accent-purple animate-pulse-dot'; // current
        }
        return (
          <div key={stage} className="flex items-center gap-0.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${dotClass} transition-colors`}
              title={stage.replace('_', ' ')}
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

export const TaskCard: React.FC<Props> = ({ task, onClick, selected, subtasks = [] }) => {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const hasSubtasks = subtasks.length > 0;
  const doneCount = subtasks.filter((s) => s.status === 'done' || s.status === 'needs_human_review').length;
  const failedCount = subtasks.filter((s) => s.status === 'failed').length;
  const subtasksRunning = subtasks.some((s) => s.claimedBy);
  const isRunning = !!task.claimedBy;

  const style: React.CSSProperties = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)${isDragging ? ' rotate(2deg)' : ''}` }
    : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`bg-bg-secondary rounded-lg p-3 mb-2 border border-border-default border-l-[3px] ${leftBorderClass(task)} cursor-grab transition-all duration-150 animate-fade-in ${
        isDragging ? 'shadow-2xl opacity-85 scale-[1.02]' : 'shadow-sm hover:bg-bg-tertiary hover:border-border-hover hover:shadow-md'
      } ${selected ? 'ring-2 ring-accent-blue' : ''} ${isRunning ? 'card-running' : ''}`}
    >
      {/* Title */}
      <div className="text-sm font-medium text-text-primary line-clamp-2 mb-1">{task.title}</div>

      {/* Description preview */}
      {task.description && (
        <div className="text-[11px] text-text-tertiary line-clamp-1 mb-1.5">{task.description}</div>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className={`w-2 h-2 rounded-full ${riskDotColor[task.riskLevel] || 'bg-text-tertiary'}`} />
        <span className="text-text-tertiary">{task.riskLevel}</span>
        {task.priority > 0 && (
          <span className="text-text-tertiary bg-bg-tertiary px-1 py-px rounded text-[10px] font-semibold">
            P{task.priority}
          </span>
        )}
        <span className="text-text-tertiary ml-auto">{timeAgo(task.updatedAt)}</span>
        {isRunning && (
          <span className="flex items-center gap-1 text-accent-purple font-medium">
            <svg className="w-3 h-3 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          </span>
        )}
        {subtasksRunning && !isRunning && (
          <span className="flex items-center gap-1 text-accent-purple">
            <svg className="w-3 h-3 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </div>

      {/* Pipeline stage indicator */}
      <PipelineIndicator status={task.status} />

      {/* Subtask progress */}
      {hasSubtasks && (
        <div className="mt-2 pt-2 border-t border-border-default">
          <div
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setExpanded(!expanded); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-2 cursor-pointer text-xs text-text-tertiary select-none hover:text-text-secondary transition-colors"
          >
            <span className={`text-[10px] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>▶</span>
            {/* Multi-segment progress bar */}
            <div className="flex-1 h-1.5 rounded-full bg-bg-elevated overflow-hidden flex">
              {doneCount > 0 && (
                <div
                  className="h-full bg-accent-green transition-all duration-300"
                  style={{ width: `${(doneCount / subtasks.length) * 100}%` }}
                />
              )}
              {failedCount > 0 && (
                <div
                  className="h-full bg-accent-red transition-all duration-300"
                  style={{ width: `${(failedCount / subtasks.length) * 100}%` }}
                />
              )}
            </div>
            <span className="tabular-nums">{doneCount}/{subtasks.length}</span>
          </div>

          {expanded && (
            <div className="mt-1.5 space-y-1">
              {subtasks
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map((sub) => (
                  <SubtaskMiniCard key={sub.id} task={sub} />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
