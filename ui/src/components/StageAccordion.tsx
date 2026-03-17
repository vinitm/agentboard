import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/client';
import { useSocket } from '../hooks/useSocket';
import { StageRow } from './StageRow';
import { SubtaskStages } from './SubtaskStages';
import type { StageLog, StageTransitionEvent } from '../types';

interface LogChunkEvent {
  taskId: string;
  runId: string;
  chunk: string;
  timestamp: string;
  stage?: string;
  subtaskId?: string;
}

interface Props {
  taskId: string;
  subtasks?: Array<{ id: string; title: string; status: string }>;
}

export const StageAccordion: React.FC<Props> = ({ taskId, subtasks = [] }) => {
  const [stages, setStages] = useState<StageLog[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [followMode, setFollowMode] = useState(true);
  const [liveChunks, setLiveChunks] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const followModeRef = useRef(followMode);
  const socket = useSocket();

  followModeRef.current = followMode;

  // Fetch stages on mount
  useEffect(() => {
    setLoading(true);
    api.getStages(taskId)
      .then(({ stages: s }) => {
        setStages(s);
        // Auto-expand the running stage or the most recent one
        const running = s.find(st => st.status === 'running' && !st.subtaskId);
        const lastCompleted = [...s].filter(st => !st.subtaskId).reverse().find(st => st.status === 'completed' || st.status === 'failed');
        const toExpand = running || lastCompleted;
        if (toExpand) setExpandedId(toExpand.id);
      })
      .catch(() => setStages([]))
      .finally(() => setLoading(false));
  }, [taskId]);

  // Listen to Socket.IO events
  useEffect(() => {
    if (!socket) return;

    const onTransition = (event: StageTransitionEvent) => {
      if (event.taskId !== taskId) return;

      setStages(prev => {
        // Find existing stage matching this event
        const idx = prev.findIndex(s =>
          s.stage === event.stage &&
          s.subtaskId === (event.subtaskId || null) &&
          (s.status === 'running' || event.status === 'running')
        );

        if (idx >= 0) {
          // Update existing stage
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            status: event.status,
            summary: event.summary || updated[idx].summary,
            durationMs: event.durationMs ?? updated[idx].durationMs,
            tokensUsed: event.tokensUsed ?? updated[idx].tokensUsed,
            completedAt: event.status !== 'running' ? new Date().toISOString() : updated[idx].completedAt,
          };
          return updated;
        }

        if (event.status === 'running') {
          // New stage starting — add it
          const newStage: StageLog = {
            id: `live-${event.stage}-${event.subtaskId || 'parent'}-${Date.now()}`,
            taskId,
            runId: null,
            stage: event.stage,
            subtaskId: event.subtaskId || null,
            attempt: 1,
            status: 'running',
            summary: event.summary || null,
            tokensUsed: null,
            durationMs: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
          };
          return [...prev, newStage];
        }

        return prev;
      });

      // Auto-follow: expand new running stage (parent-level only)
      if (event.status === 'running' && !event.subtaskId && followModeRef.current) {
        setStages(prev => {
          const found = prev.find(s => s.stage === event.stage && !s.subtaskId && s.status === 'running');
          if (found) setExpandedId(found.id);
          return prev;
        });
      }
    };

    const onLogChunk = (entry: LogChunkEvent) => {
      if (entry.taskId !== taskId) return;
      const key = entry.subtaskId
        ? `${entry.subtaskId}-${entry.stage || ''}`
        : `parent-${entry.stage || ''}`;

      setLiveChunks(prev => {
        const next = new Map(prev);
        const existing = next.get(key) || [];
        next.set(key, [...existing, entry.chunk]);
        return next;
      });
    };

    socket.on('stage:transition', onTransition);
    socket.on('run:log', onLogChunk);

    return () => {
      socket.off('stage:transition', onTransition);
      socket.off('run:log', onLogChunk);
    };
  }, [socket, taskId]);

  const handleToggle = useCallback((stageId: string) => {
    setExpandedId(prev => {
      if (prev !== stageId) {
        // User manually picked a stage — exit follow mode
        setFollowMode(false);
      }
      return prev === stageId ? null : stageId;
    });
  }, []);

  const reengageFollow = useCallback(() => {
    setFollowMode(true);
    // Find currently running stage and expand it
    const running = stages.find(s => s.status === 'running' && !s.subtaskId);
    if (running) setExpandedId(running.id);
  }, [stages]);

  if (loading) {
    return (
      <div className="space-y-2 animate-fade-in">
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (stages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-secondary animate-fade-in">
        <svg className="w-10 h-10 text-text-tertiary mb-3 opacity-50" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
        </svg>
        <p className="text-sm">No stage data yet</p>
        <p className="text-xs text-text-tertiary mt-1">Stage logs will appear here as the pipeline runs</p>
      </div>
    );
  }

  // Separate parent-level stages and subtask stages
  const parentStages = stages.filter(s => !s.subtaskId);
  const subtaskStages = stages.filter(s => s.subtaskId);
  const hasRunningStage = stages.some(s => s.status === 'running');

  return (
    <div className="space-y-2 animate-fade-in">
      {/* Follow mode indicator */}
      {!followMode && hasRunningStage && (
        <div className="flex justify-end">
          <button
            onClick={reengageFollow}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-accent-blue text-white hover:bg-blue-600 transition-colors"
          >
            Follow live ↓
          </button>
        </div>
      )}

      {parentStages.map(stage => {
        // If this is the "implementing" stage and we have subtask stages, render subtask section after it
        const isImplementing = stage.stage === 'implementing';
        const chunkKey = `parent-${stage.stage}`;

        return (
          <React.Fragment key={stage.id}>
            <StageRow
              stageLog={stage}
              taskId={taskId}
              isActive={stage.status === 'running'}
              isExpanded={expandedId === stage.id}
              onToggle={() => handleToggle(stage.id)}
              liveChunks={liveChunks.get(chunkKey) || []}
            />

            {/* Subtask stages nested under implementing */}
            {isImplementing && subtaskStages.length > 0 && (
              <div className="ml-4 border-l-2 border-border-default pl-3">
                <SubtaskStages
                  stages={subtaskStages}
                  taskId={taskId}
                  subtasks={subtasks}
                  liveChunks={liveChunks}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* If no parent implementing stage but we have subtask stages, show them standalone */}
      {!parentStages.some(s => s.stage === 'implementing') && subtaskStages.length > 0 && (
        <div className="ml-4 border-l-2 border-border-default pl-3">
          <SubtaskStages
            stages={subtaskStages}
            taskId={taskId}
            subtasks={subtasks}
            liveChunks={liveChunks}
          />
        </div>
      )}
    </div>
  );
};
