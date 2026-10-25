import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import type { Ack } from '../../shared/protocol';

let pendingRoomSocket: Socket | null = null;

export function connectSocket(): Socket {
  return io({
    path: '/socket.io',
    withCredentials: true,
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 12,
    reconnectionDelay: 700,
    reconnectionDelayMax: 5_000,
    timeout: 12_000,
    transports: ['websocket', 'polling'],
  });
}

export function setPendingRoomSocket(socket: Socket | null): void {
  pendingRoomSocket = socket;
}

export function takePendingRoomSocket(): Socket | null {
  const socket = pendingRoomSocket;
  pendingRoomSocket = null;
  return socket;
}

export function emitWithAck<T = unknown>(
  socket: Socket,
  event: string,
  payload: unknown = {},
  timeoutMs = 8_000,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: { code: 'TIMEOUT', message: 'The server did not respond in time.' } });
    }, timeoutMs);

    socket.emit(event, payload, (response: Ack<T>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(response ?? { ok: false, error: { code: 'EMPTY_ACK', message: 'The server returned no response.' } });
    });
  });
}
