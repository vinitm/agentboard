import React, { useEffect, useRef, useState } from 'react';
import { CopyButton } from './CopyButton';
import { useSocket } from '../hooks/useSocket';

interface LogEntry { taskId: number; runId: string; chunk: string; timestamp: string }
interface Props { taskId: number }

export const LogViewer: React.FC<Props> = ({ taskId }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;
    const onLog = (entry: LogEntry) => {
      if (entry.taskId === taskId) setLogs((prev) => [...prev, entry]);
    };
    socket.on('run:log', onLog);
    return () => { socket.off('run:log', onLog); };
  }, [socket, taskId]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, autoScroll]);

  const allText = logs.map((e) => `${new Date(e.timestamp).toLocaleTimeString()} ${e.chunk}`).join('');

  if (logs.length === 0) {
    return <div className="text-sm text-text-secondary p-2">No logs yet. Logs will appear here in real-time as the agent works.</div>;
  }

  return (
    <div className="relative">
      <div className="absolute top-2 right-2 z-10 flex gap-1.5">
        <button onClick={() => setAutoScroll(!autoScroll)}
          className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${autoScroll ? 'bg-accent-blue/20 border-accent-blue text-accent-blue' : 'bg-bg-elevated border-border-default text-text-tertiary'}`}>
          {autoScroll ? 'Auto ↓' : 'Manual'}
        </button>
        <button onClick={() => { if (logs.length < 10 || window.confirm('Clear all log entries?')) setLogs([]); }} className="px-2 py-0.5 rounded text-[11px] bg-bg-elevated border border-border-default text-text-tertiary hover:text-text-primary">
          Clear
        </button>
        <CopyButton text={allText} />
      </div>
      <div className="bg-bg-secondary text-text-primary font-mono text-xs leading-relaxed p-3 rounded-lg max-h-[300px] overflow-y-auto">
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-2 whitespace-pre-wrap break-all">
            <span className="text-text-tertiary flex-shrink-0">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            <span className="flex-1">{entry.chunk}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
