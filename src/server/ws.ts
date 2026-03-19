import type { Server } from 'socket.io';
import type { StageTransitionEvent } from '../types/index.js';

/**
 * Broadcast an event to all connected WebSocket clients.
 */
export function broadcast(io: Server, event: string, data: unknown): void {
  io.emit(event, data);
}

/**
 * Broadcast a run:log event for real-time log streaming.
 */
export function broadcastLog(
  io: Server,
  data: {
    taskId: number;
    runId: string;
    stage?: string;
    chunk: string;
    timestamp: string;
  }
): void {
  io.emit('run:log', data);
}

/**
 * Broadcast a stage:transition event when a pipeline stage changes.
 */
export function broadcastStageTransition(
  io: Server,
  data: StageTransitionEvent
): void {
  io.emit('stage:transition', data);
}

/**
 * Set up WebSocket connection handling.
 */
export function setupWebSocket(io: Server): void {
  io.on('connection', (socket) => {
    console.log(`[ws] client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[ws] client disconnected: ${socket.id}`);
    });
  });
}
