import { wsUrl } from '@/api/client';
import { MOCK_ENABLED, mockRequest } from '@/api/mock';
import type { Message } from '@/types';

export interface ChatSocketHandlers {
  onMessage?: (data: { type: 'chat.message'; message: Message }) => void;
  onOpen?: () => void;
  onClose?: (code: number) => void;
  onError?: (message: string) => void;
}

function normalizedFrame(raw: unknown, conversationId: string): { type: 'chat.message'; message: Message } | null {
  if (!raw || typeof raw !== 'object') return null;
  const frame = raw as { type?: unknown; message?: unknown };
  if (frame.type !== 'chat.message' || !frame.message || typeof frame.message !== 'object') return null;
  const message = frame.message as Message;
  if (
    typeof message.id !== 'string' || !message.id || message.conversation !== conversationId ||
    typeof message.sender !== 'string' || !message.sender || typeof message.body !== 'string' ||
    message.body.length > 2000 || typeof message.created_at !== 'string' ||
    !Number.isFinite(Date.parse(message.created_at))
  ) return null;
  return { type: 'chat.message', message };
}

/** No credentials are sent over plaintext except to local development hosts. */
function secureSocketUrl(path: string): string {
  const url = new URL(wsUrl(path));
  const host = url.hostname.toLowerCase();
  const local = ['localhost', '127.0.0.1', '[::1]', '::1', '10.0.2.2', '10.0.3.2'].includes(host) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
  const development = typeof __DEV__ !== 'undefined' && __DEV__;
  if (url.username || url.password || (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && development && local))) {
    throw new Error('Live chat requires a secure connection. You can still send and refresh messages here.');
  }
  return url.toString();
}

/** Reconnect transient failures only; permission/auth failures need a newly verified session. */
export function createChatSocket(conversationId: string, token: string, handlers: ChatSocketHandlers) {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const close = () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const previous = ws;
    ws = null;
    previous?.close();
  };

  // No synthetic messages: mock history and sends obey the same REST access rules.
  if (MOCK_ENABLED) {
    void mockRequest('GET', `/api/v1/conversations/${encodeURIComponent(conversationId)}/`).then(({ status, data }) => {
      if (closed) return;
      if (status >= 400 || (data as { can_send?: boolean })?.can_send !== true) {
        closed = true;
        handlers.onClose?.(status === 401 ? 4401 : 4403);
      } else handlers.onOpen?.();
    }).catch(() => {
      if (!closed) handlers.onError?.('Live chat is unavailable. You can still send and refresh messages here.');
    });
    return { close };
  }

  let endpoint: string;
  try {
    if (!token) throw new Error('Sign in again to reconnect to chat.');
    endpoint = secureSocketUrl(`/ws/chat/${encodeURIComponent(conversationId)}/`);
    const url = new URL(endpoint);
    url.searchParams.set('token', token);
    endpoint = url.toString();
  } catch {
    // Never expose a URL or token through logs or an error message.
    reconnectTimer = setTimeout(() => {
      if (!closed) handlers.onError?.('Live chat requires a secure connection. You can still send and refresh messages here.');
    }, 0);
    return { close };
  }

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = Math.min(15000, 1000 * 2 ** attempt++);
    reconnectTimer = setTimeout(connect, delay);
  };
  const connect = () => {
    reconnectTimer = null;
    if (closed) return;
    let connection: WebSocket;
    try {
      connection = new WebSocket(endpoint);
      ws = connection;
    } catch {
      handlers.onError?.('Live chat is unavailable. You can still send and refresh messages here.');
      scheduleReconnect();
      return;
    }
    const current = () => !closed && ws === connection;
    connection.onopen = () => {
      if (!current()) return;
      attempt = 0;
      handlers.onOpen?.();
    };
    connection.onmessage = (event) => {
      if (!current()) return;
      let frame;
      try {
        frame = normalizedFrame(JSON.parse(String(event.data)), conversationId);
      } catch { return; }
      if (frame) handlers.onMessage?.(frame);
    };
    connection.onerror = () => {
      if (current()) handlers.onError?.('Live chat disconnected. You can still send and refresh messages here.');
    };
    connection.onclose = (event) => {
      if (!current()) return;
      ws = null;
      if ([4401, 4403, 1008].includes(event.code)) closed = true;
      handlers.onClose?.(event.code);
      scheduleReconnect();
    };
  };
  connect();
  return { close };
}
