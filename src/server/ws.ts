import type { Server } from 'socket.io';

/**
 * Broadcast an event to all connected WebSocket clients.
 */
export function broadcast(io: Server, event: string, data: unknown): void {
  io.emit(event, data);
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
