/**
 * WebSocket client for the EPIK8s backend — chat + system event channels.
 *
 * Derives the WS URL from the HTTP backend URL (same host, ws:// or wss://).
 */
import { getBackendUrl } from './k8sApi.js';
import { getAccessToken } from './oidc.js';

function wsBaseUrl() {
  const http = getBackendUrl();
  if (!http) return null;
  return http.replace(/^http/, 'ws');
}

/**
 * Create a reconnecting WebSocket for a given path (/ws/chat or /ws/system).
 * Returns { send, close, onMessage, onStatus }.
 */
export function createBackendWs(path) {
  let ws = null;
  let listeners = [];
  let statusListeners = [];
  let reconnectTimer = null;
  let closed = false;

  function notifyStatus(connected) {
    statusListeners.forEach(fn => fn(connected));
  }

  function connect() {
    const base = wsBaseUrl();
    if (!base) {
      // Retry later when backend URL becomes available
      reconnectTimer = setTimeout(connect, 3000);
      return;
    }
    try {
      const t = getAccessToken();
      ws = new WebSocket(`${base}${path}${t ? `?access_token=${encodeURIComponent(t)}` : ''}`);
    } catch {
      reconnectTimer = setTimeout(connect, 3000);
      return;
    }

    ws.onopen = () => notifyStatus(true);

    ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      listeners.forEach(fn => fn(data));
    };

    ws.onclose = () => {
      notifyStatus(false);
      if (!closed) reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();

  return {
    send(obj) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    },
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      ws?.close();
    },
    onMessage(fn) {
      listeners.push(fn);
      return () => { listeners = listeners.filter(l => l !== fn); };
    },
    onStatus(fn) {
      statusListeners.push(fn);
      return () => { statusListeners = statusListeners.filter(l => l !== fn); };
    },
  };
}
