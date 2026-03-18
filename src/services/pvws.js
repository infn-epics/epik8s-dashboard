/**
 * PVWS (PV Web Socket) client for EPICS PV access.
 *
 * Protocol messages:
 *   Subscribe:   { "type": "subscribe", "pvs": ["PV:NAME"] }
 *   Unsubscribe: { "type": "clear", "pvs": ["PV:NAME"] }
 *   Write:       { "type": "write", "pv": "PV:NAME", "value": <val> }
 *   Update msg:  { "type": "update", "pv": "PV:NAME", "value": <val>, "severity": "...", ... }
 */

const RECONNECT_DELAY_MS = 3000;

export default class PvwsClient {
  constructor(url) {
    this.url = url;
    this._ws = null;
    this._listeners = new Map();       // pv -> Set<callback>
    this._statusListeners = new Set();
    this._connected = false;
    this._shouldReconnect = true;
    this._pendingSubscriptions = new Set();
    this._reconnectTimer = null;
  }

  /* ---- connection status ---- */

  get connected() {
    return this._connected;
  }

  onStatusChange(cb) {
    this._statusListeners.add(cb);
    return () => this._statusListeners.delete(cb);
  }

  _emitStatus() {
    for (const cb of this._statusListeners) cb(this._connected);
  }

  /* ---- connect / disconnect ---- */

  connect() {
    if (this._ws) return;
    this._shouldReconnect = true;
    this._open();
  }

  disconnect() {
    this._shouldReconnect = false;
    clearTimeout(this._reconnectTimer);
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  _open() {
    try {
      this._ws = new WebSocket(this.url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this._ws.onopen = () => {
      this._connected = true;
      this._emitStatus();
      // re-subscribe any PVs that were registered while disconnected
      for (const pv of this._pendingSubscriptions) {
        this._sendSubscribe(pv);
      }
      this._pendingSubscriptions.clear();
      // also resubscribe all currently monitored PVs
      for (const pv of this._listeners.keys()) {
        this._sendSubscribe(pv);
      }
    };

    this._ws.onclose = () => {
      this._connected = false;
      this._ws = null;
      this._emitStatus();
      this._scheduleReconnect();
    };

    this._ws.onerror = () => {
      // onclose will fire after this
    };

    this._ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.type === 'update' && msg.pv) {
        const cbs = this._listeners.get(msg.pv);
        if (cbs) {
          for (const cb of cbs) cb(msg);
        }
      }
    };
  }

  _scheduleReconnect() {
    if (!this._shouldReconnect) return;
    this._reconnectTimer = setTimeout(() => this._open(), RECONNECT_DELAY_MS);
  }

  /* ---- subscribe / unsubscribe ---- */

  subscribe(pv, callback) {
    if (!this._listeners.has(pv)) {
      this._listeners.set(pv, new Set());
    }
    this._listeners.get(pv).add(callback);

    if (this._connected) {
      this._sendSubscribe(pv);
    } else {
      this._pendingSubscriptions.add(pv);
    }

    // return unsubscribe function
    return () => {
      const cbs = this._listeners.get(pv);
      if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) {
          this._listeners.delete(pv);
          this._sendClear(pv);
        }
      }
    };
  }

  /* ---- write ---- */

  put(pv, value) {
    console.log(`[PVWS] Sending write: ${pv} = ${JSON.stringify(value)}`);
    this._send({ type: 'write', pv, value });
  }

  /* ---- internal send helpers ---- */

  _sendSubscribe(pv) {
    this._send({ type: 'subscribe', pvs: [pv] });
  }

  _sendClear(pv) {
    this._send({ type: 'clear', pvs: [pv] });
  }

  _send(msg) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }
}
