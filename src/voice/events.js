/**
 * Shared, framework-free kernel for the voice assistant module.
 *
 * Event schemas exchanged over the LiveKit room's data channel, plus the
 * pure matching/backoff helpers used by both the connection service
 * (src/services/voiceRoom.js) and the React contexts/hooks. Kept dependency
 * free (no React, no livekit-client) so it can be unit tested in isolation.
 */

export const EVENT_TYPES = {
  HIGHLIGHT: 'highlight',
  TRANSCRIPT: 'transcript',
  CONFIRM_REQUEST: 'confirm_request',
  CONFIRM_ACTION: 'confirm_action',
};

export const DEFAULT_HIGHLIGHT_TTL_MS = 8000;
export const DEFAULT_CONFIRM_TIMEOUT_MS = 15000;

// Common EPICS PV suffixes stripped when reconciling an agent-supplied
// device_id against a widget's pvPrefix (see matchDeviceId below).
const PV_SUFFIXES = [':RBV', ':RB', '.RBV', ':STATE_RB', ':TEMP_RB', ':VAL', '.VAL'];

export function isHighlightEvent(msg) {
  return !!msg && msg.type === EVENT_TYPES.HIGHLIGHT && typeof msg.device_id === 'string' && !!msg.device_id;
}

export function isTranscriptEvent(msg) {
  return !!msg && msg.type === EVENT_TYPES.TRANSCRIPT
    && (msg.role === 'user' || msg.role === 'assistant')
    && typeof msg.text === 'string';
}

export function isConfirmRequestEvent(msg) {
  return !!msg && msg.type === EVENT_TYPES.CONFIRM_REQUEST
    && typeof msg.action_id === 'string' && !!msg.action_id
    && typeof msg.label === 'string';
}

function normalize(id) {
  return (id || '').trim().toLowerCase();
}

function stripKnownSuffix(id) {
  const lower = normalize(id);
  for (const suffix of PV_SUFFIXES) {
    const s = suffix.toLowerCase();
    if (lower.endsWith(s)) return lower.slice(0, -s.length);
  }
  return lower;
}

/**
 * Reconcile a device_id emitted by the voice agent against a widget's
 * config. The agent's exact device_id convention is not yet known, so this
 * tries progressively looser strategies rather than a single exact match —
 * flagged in voice/README.md as the piece most likely to need adjustment
 * once wired to the real backend.
 *
 * @param {string} candidateId - device_id from a `highlight` event
 * @param {{ pvPrefix?: string, deviceId?: string }} widgetRef
 */
export function matchDeviceId(candidateId, widgetRef) {
  if (!candidateId || !widgetRef) return false;
  const candidate = normalize(candidateId);
  const deviceId = normalize(widgetRef.deviceId);
  const pvPrefix = normalize(widgetRef.pvPrefix);
  if (!candidate) return false;

  if (deviceId && candidate === deviceId) return true;
  if (pvPrefix && candidate === pvPrefix) return true;

  if (pvPrefix && (candidate.startsWith(pvPrefix) || pvPrefix.startsWith(candidate))) return true;
  if (deviceId && (candidate.startsWith(deviceId) || deviceId.startsWith(candidate))) return true;

  const strippedCandidate = stripKnownSuffix(candidateId);
  if (pvPrefix && strippedCandidate && (strippedCandidate === pvPrefix || strippedCandidate.startsWith(pvPrefix) || pvPrefix.startsWith(strippedCandidate))) {
    return true;
  }

  return false;
}

/**
 * Pure list-update helpers for VoiceHighlightContext, extracted so the
 * highlight add/expire bookkeeping is unit-testable without mounting React
 * or a live LiveKit connection (see tests/voiceHighlight.test.js).
 */
export function upsertHighlight(list, msg, now = Date.now()) {
  const ttl = Number.isFinite(msg.ttl_ms) ? msg.ttl_ms : DEFAULT_HIGHLIGHT_TTL_MS;
  const entry = { deviceId: msg.device_id, reason: msg.reason || '', expiresAt: now + ttl };
  return [...list.filter((h) => h.deviceId !== entry.deviceId), entry];
}

export function pruneExpired(list, now = Date.now()) {
  return list.filter((h) => h.expiresAt > now);
}

// Capped linear-ish backoff for the LiveKit room connection: WebRTC/SFU
// reconnects benefit from backoff, unlike the flat 3s retry used elsewhere
// in the app (pvws.js, backendWs.js) — isolated to this module on purpose.
const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 15000];
export const MAX_RECONNECT_ATTEMPTS = BACKOFF_STEPS_MS.length;

export function computeBackoffDelay(attempt) {
  const idx = Math.max(0, Math.min(attempt, BACKOFF_STEPS_MS.length - 1));
  return BACKOFF_STEPS_MS[idx];
}
