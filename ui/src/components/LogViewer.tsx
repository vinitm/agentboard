import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';

interface LogEntry {
  taskId: string;
  runId: string;
  chunk: string;
  timestamp: string;
}

interface Props {
  taskId: string;
}

export const LogViewer: React.FC<Props> = ({ taskId }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;

    const onLog = (entry: LogEntry) => {
      if (entry.taskId === taskId) {
        setLogs((prev) => [...prev, entry]);
      }
    };

    socket.on('run:log', onLog);
    return () => {
      socket.off('run:log', onLog);
    };
  }, [socket, taskId]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div style={{ fontSize: 13, color: '#9ca3af', padding: 8 }}>
        No logs yet. Logs will appear here in real-time as the agent works.
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {logs.map((entry, i) => (
        <div key={i} style={lineStyle}>
          <span style={timestampStyle}>
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
          <span style={chunkStyle}>{entry.chunk}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  background: '#1e1e2e',
  color: '#cdd6f4',
  fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", monospace',
  fontSize: 12,
  lineHeight: 1.6,
  padding: 12,
  borderRadius: 8,
  maxHeight: 300,
  overflowY: 'auto',
};

const lineStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

const timestampStyle: React.CSSProperties = {
  color: '#6c7086',
  flexShrink: 0,
};

const chunkStyle: React.CSSProperties = {
  flex: 1,
};
