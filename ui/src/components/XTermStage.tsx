import React from 'react';

interface XTermStageProps {
  taskId: number;
  stage: string;
  stageLogId: string;
  isExpanded: boolean;
  isRunning: boolean;
}

/**
 * Placeholder for xterm.js-based terminal renderer.
 * Will be replaced with a full xterm.js integration when node-pty
 * streaming is wired up via Socket.IO.
 */
export function XTermStage({ stage, isRunning }: XTermStageProps) {
  return (
    <div className="px-3 py-4 font-mono text-xs text-text-secondary bg-bg-tertiary">
      <p>Terminal output for <span className="text-text-primary">{stage}</span></p>
      {isRunning && <p className="mt-1 animate-pulse">Running…</p>}
    </div>
  );
}
