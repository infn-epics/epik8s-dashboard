/**
 * LiveKit room client for the experimental voice assistant.
 *
 * Mirrors the shape of PvwsClient (src/services/pvws.js): explicit
 * connect()/disconnect(), a _shouldReconnect guard, and status pub/sub via
 * onStatusChange(). Two deliberate differences from that convention:
 *
 *   - Reconnects use a capped backoff (computeBackoffDelay) instead of a
 *     flat delay, since WebRTC/SFU reconnects benefit from it. This is
 *     isolated to this class and does not change pvws.js/backendWs.js.
 *   - The microphone is NEVER opened by connect()/_open(). Only
 *     startTalking()/stopTalking() touch getUserMedia/publishTrack, and
 *     stopTalking() always calls track.stop() so the browser's mic
 *     indicator actually turns off (not just muted).
 *
 * Data channel payloads are JSON objects matching the schemas in
 * src/voice/events.js (highlight, transcript, confirm_request). Outbound
 * events (confirm_action) are sent via sendData().
 */
import { Room, RoomEvent, Track, createLocalAudioTrack } from 'livekit-client';
import { computeBackoffDelay, MAX_RECONNECT_ATTEMPTS } from '../voice/events.js';

export default class VoiceRoomClient {
  constructor({ tokenEndpoint, serverUrl, roomName, identityPrefix = 'operator' } = {}) {
    this.tokenEndpoint = tokenEndpoint;
    this.serverUrl = serverUrl;
    this.roomName = roomName;
    this.identityPrefix = identityPrefix;

    this._room = null;
    this._micTrack = null;
    this._micStarting = false;
    this._micGeneration = 0; // invalidates superseded startTalking() attempts, see startTalking()
    this._audioEl = null;

    this._statusListeners = new Set();
    this._dataListeners = new Set();
    this._status = 'idle'; // idle | connecting | connected | error

    this._shouldReconnect = false;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._generation = 0; // invalidates superseded _open() attempts, see _open()
  }

  get status() {
    return this._status;
  }

  get connected() {
    return this._status === 'connected';
  }

  onStatusChange(cb) {
    this._statusListeners.add(cb);
    return () => this._statusListeners.delete(cb);
  }

  onData(cb) {
    this._dataListeners.add(cb);
    return () => this._dataListeners.delete(cb);
  }

  _setStatus(status) {
    this._status = status;
    for (const cb of this._statusListeners) cb(status);
  }

  _emitData(msg) {
    for (const cb of this._dataListeners) cb(msg);
  }

  /* ---- connect / disconnect (room + data channel only, no mic) ---- */

  async connect() {
    if (this._room || !this.tokenEndpoint || !this.serverUrl || !this.roomName) return;
    this._shouldReconnect = true;
    this._reconnectAttempt = 0;
    await this._open();
  }

  disconnect() {
    this._generation += 1; // invalidate any in-flight _open() started before this call
    this._shouldReconnect = false;
    clearTimeout(this._reconnectTimer);
    this.stopTalking();
    if (this._room) {
      this._room.disconnect();
      this._room = null;
    }
    this._detachRemoteAudio();
    this._setStatus('idle');
  }

  /**
   * Opens a room connection. Guarded by a generation counter rather than
   * `this._room` alone: `this._room` is only assigned after the async token
   * fetch resolves, so two overlapping _open() calls (e.g. React 18
   * StrictMode double-invoking the connect effect in dev, or any other
   * connect()/disconnect() race) would otherwise both pass the earlier
   * `if (this._room) return` guard in connect() and end up as two live
   * Room connections both feeding _emitData — duplicating every
   * data-channel event. Each _open() captures its own generation and bails
   * (disconnecting its room if one was created) if a newer call has
   * superseded it by the time an await resolves.
   */
  async _open() {
    const gen = (this._generation += 1);
    this._setStatus('connecting');
    let room;
    try {
      const token = await this._fetchToken();
      if (gen !== this._generation) return;

      room = new Room();

      room.on(RoomEvent.DataReceived, (payload) => {
        let msg;
        try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }
        this._emitData(msg);
      });

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) this._attachRemoteAudio(track);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) this._detachRemoteAudio();
      });

      room.on(RoomEvent.Disconnected, () => {
        if (gen !== this._generation) return; // stale room, already superseded/torn down
        this._setStatus('idle');
        this._room = null;
        this._scheduleReconnect();
      });

      await room.connect(this.serverUrl, token);
      if (gen !== this._generation) { room.disconnect(); return; }

      this._room = room;
      this._reconnectAttempt = 0;
      this._setStatus('connected');
    } catch (err) {
      if (gen !== this._generation) return;
      console.warn('[VoiceRoom] connect failed:', err);
      this._room = null;
      this._setStatus('error');
      this._scheduleReconnect();
    }
  }

  async _fetchToken() {
    const identity = `${this.identityPrefix}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: this.roomName, identity }),
    });
    if (!res.ok) throw new Error(`Token endpoint returned ${res.status}`);
    const body = await res.json();
    if (!body?.token) throw new Error('Token endpoint response missing "token"');
    return body.token;
  }

  _scheduleReconnect() {
    if (!this._shouldReconnect) return;
    if (this._reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this._setStatus('error');
      return;
    }
    const delay = computeBackoffDelay(this._reconnectAttempt);
    this._reconnectAttempt += 1;
    this._reconnectTimer = setTimeout(() => this._open(), delay);
  }

  /** Manual retry after the reconnect budget is exhausted (surfaced by the UI). */
  reconnectNow() {
    clearTimeout(this._reconnectTimer);
    this._reconnectAttempt = 0;
    this._shouldReconnect = true;
    this._open();
  }

  /**
   * ---- push-to-talk: the only methods that touch the microphone ----
   *
   * `createLocalAudioTrack()` can take an arbitrarily long time (it waits
   * on the native mic-permission prompt), so a quick press-release —
   * releasing the FAB before the permission prompt is even answered — can
   * land `stopTalking()`'s `if (!this._micTrack) return` guard *before*
   * `startTalking()` has assigned `this._micTrack`, letting the mic
   * publish proceed in the background with no way to stop it from the UI.
   * `_micGeneration` guards against this: stopTalking() always bumps it
   * immediately (synchronously), and startTalking() checks it at every
   * checkpoint after an await, tearing down whatever it just created
   * (track and/or published track) the moment it finds itself superseded.
   */

  async startTalking() {
    if (this._micTrack) return true;
    if (this._micStarting || !this._room) return false;
    this._micStarting = true;
    const gen = (this._micGeneration += 1);
    let track = null;
    try {
      track = await createLocalAudioTrack();
      if (gen !== this._micGeneration) { track.stop(); return false; } // released before mic was ready

      await this._room.localParticipant.publishTrack(track);
      if (gen !== this._micGeneration) {
        // released while the publish was in flight — tear down immediately
        if (this._room) { try { await this._room.localParticipant.unpublishTrack(track); } catch { /* ignore */ } }
        track.stop();
        return false;
      }
      this._micTrack = track;
      return true;
    } catch (err) {
      console.warn('[VoiceRoom] mic publish failed:', err);
      track?.stop();
      return false;
    } finally {
      this._micStarting = false;
    }
  }

  async stopTalking() {
    this._micGeneration += 1; // invalidate any in-flight startTalking()
    if (!this._micTrack) return false;
    const track = this._micTrack;
    this._micTrack = null;
    try {
      if (this._room) await this._room.localParticipant.unpublishTrack(track);
    } catch { /* room may already be gone */ }
    track.stop(); // releases the OS mic indicator, not just mutes
    return true;
  }

  get isTalking() {
    return !!this._micTrack;
  }

  /* ---- outbound data channel events ---- */

  sendData(obj) {
    if (!this._room) return;
    const payload = new TextEncoder().encode(JSON.stringify(obj));
    this._room.localParticipant.publishData(payload, { reliable: true });
  }

  /* ---- remote agent audio playback ---- */

  _attachRemoteAudio(track) {
    this._detachRemoteAudio();
    const el = track.attach();
    el.autoplay = true;
    el.style.display = 'none';
    document.body.appendChild(el);
    this._audioEl = el;
  }

  _detachRemoteAudio() {
    if (this._audioEl) {
      this._audioEl.remove();
      this._audioEl = null;
    }
  }
}
