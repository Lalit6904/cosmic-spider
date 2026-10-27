import { io } from "socket.io-client";
let pendingRoomSocket = null;
function connectSocket() {
  return io({
    path: "/socket.io",
    withCredentials: true,
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 12,
    reconnectionDelay: 700,
    reconnectionDelayMax: 5e3,
    timeout: 12e3,
    transports: ["websocket", "polling"]
  });
}
function setPendingRoomSocket(socket) {
  pendingRoomSocket = socket;
}
function takePendingRoomSocket() {
  const socket = pendingRoomSocket;
  pendingRoomSocket = null;
  return socket;
}
function emitWithAck(socket, event, payload = {}, timeoutMs = 8e3) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: { code: "TIMEOUT", message: "The server did not respond in time." } });
    }, timeoutMs);
    socket.emit(event, payload, (response) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(response ?? { ok: false, error: { code: "EMPTY_ACK", message: "The server returned no response." } });
    });
  });
}
export {
  connectSocket,
  emitWithAck,
  setPendingRoomSocket,
  takePendingRoomSocket
};
