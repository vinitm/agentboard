import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

let sharedSocket: Socket | null = null;
let refCount = 0;

function getSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io({ transports: ['websocket', 'polling'] });
  }
  refCount++;
  return sharedSocket;
}

function releaseSocket() {
  refCount--;
  if (refCount <= 0 && sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
    refCount = 0;
  }
}

export function useSocket(): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const s = getSocket();
    setSocket(s);
    return () => {
      releaseSocket();
      setSocket(null);
    };
  }, []);

  return socket;
}

export function useConnectionStatus(): ConnectionStatus {
  const socket = useSocket();
  const [status, setStatus] = useState<ConnectionStatus>(
    socket?.connected ? 'connected' : 'disconnected'
  );

  useEffect(() => {
    if (!socket) {
      setStatus('disconnected');
      return;
    }

    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('disconnected');
    const onReconnectAttempt = () => setStatus('reconnecting');
    const onReconnect = () => setStatus('connected');

    if (socket.connected) setStatus('connected');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect', onReconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect', onReconnect);
    };
  }, [socket]);

  return status;
}
