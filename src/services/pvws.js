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
    this._writeOnlyPvs = new Set();   // pvs auto-subscribed by put() (no callbacks)
    this._knownPvs = new Set();       // pvs PVWS has acknowledged (received >=1 update)
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
      console.log(`[PVWS] Connected to ${this.url}`);
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
      // and re-subscribe PVs we only ever write to (so PVWS allows writes)
      for (const pv of this._writeOnlyPvs) {
        this._sendSubscribe(pv);
      }
    };

    this._ws.onclose = (e) => {
      console.log(`[PVWS] Disconnected (code=${e.code})`);
      this._connected = false;
      this._ws = null;
      this._knownPvs.clear();
      this._emitStatus();
      this._scheduleReconnect();
    };

    this._ws.onerror = (e) => {
      console.warn('[PVWS] WebSocket error', e);
    };

    this._ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.type === 'error') {
        console.warn(`[PVWS] Server error: ${msg.message}`);
        return;
      }
      if (msg.type === 'update' && msg.pv) {
        this._knownPvs.add(msg.pv);
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

  /**
   * Write a value to a PV.
   *
   * PVWS rejects writes to PVs it isn't currently monitoring ("Cannot write
   * unknown PV"). For pure write-only triggers (e.g. motor record `.TWR`,
   * `.TWF`, `.STOP`, `.HOMF`, custom `:POI_GO`) the dashboard never calls
   * subscribe(), so we transparently subscribe here before sending the write.
   *
   * Sending subscribe + write back-to-back races the CA channel connection on
   * the server side, so for newly-subscribed PVs we wait for the first update
   * (= channel is open) before issuing the write. We retry briefly to cover
   * slow CA connections, then give up.
   */
  put(pv, value) {
    console.log(`[PVWS] Sending write: ${pv} = ${JSON.stringify(value)}`);

    const isKnown = this._knownPvs.has(pv);
    const alreadySubscribed = this._listeners.has(pv) || this._writeOnlyPvs.has(pv);

    if (!alreadySubscribed) {
      this._writeOnlyPvs.add(pv);
      if (this._connected) {
        this._sendSubscribe(pv);
      } else {
        this._pendingSubscriptions.add(pv);
      }
    }

    if (isKnown) {
      this._send({ type: 'write', pv, value });
      return;
    }

    // Wait for the channel to be acknowledged by PVWS before writing.
    // Poll up to ~3s; matches PVWS' typical CA connection time.
    const deadline = Date.now() + 3000;
    const trySend = () => {
      if (this._knownPvs.has(pv)) {
        this._send({ type: 'write', pv, value });
      } else if (Date.now() < deadline && this._connected) {
        setTimeout(trySend, 100);
      } else {
        console.warn(`[PVWS] Write to ${pv} dropped: channel never connected`);
      }
    };
    setTimeout(trySend, 100);
  }

  /* ---- internal send helpers ---- */

  _sendSubscribe(pv) {
    this._send({ type: 'subscribe', pvs: [pv] });
  }

  _sendClear(pv) {
    this._send({ type: 'clear', pvs: [pv] });
  }

  _send(msg) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      // Socket not ready: queue subscribe requests so they're re-sent on reconnect.
      if (msg.type === 'subscribe' && Array.isArray(msg.pvs)) {
        for (const pv of msg.pvs) this._pendingSubscriptions.add(pv);
      }
      return;
    }
    try {
      this._ws.send(JSON.stringify(msg));
    } catch (err) {
      // Socket may have transitioned OPEN → CLOSING between the readyState
      // check and send(). Re-queue subscriptions so the next reconnect restores them.
      console.warn('[PVWS] send failed:', err);
      if (msg.type === 'subscribe' && Array.isArray(msg.pvs)) {
        for (const pv of msg.pvs) this._pendingSubscriptions.add(pv);
      }
    }
  }
}
