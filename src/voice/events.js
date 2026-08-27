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
  TEXT_INPUT: 'text_input',
  ERROR: 'voice_error',
  PHASE: 'phase',
  CONTENT: 'content',
};

const CONTENT_KINDS = ['table', 'chart', 'widget'];

const PHASES = ['stt', 'llm', 'tts'];
const EDGES = ['start', 'end'];

// Recent-turns list is capped so a long control-room session doesn't grow
// this unboundedly - only the debug panel's "recent turns" table needs
// history, and it never shows more than a handful anyway.
const MAX_TRACKED_TURNS = 20;

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

// Browser-to-agent input. Keep this deliberately small and explicit: unlike
// transcript events this is an operator request, not a mirrored result.
export function isTextInputEvent(msg) {
  return !!msg && msg.type === EVENT_TYPES.TEXT_INPUT
    && typeof msg.text === 'string' && !!msg.text.trim()
    && msg.text.length <= 4000;
}

export function isVoiceErrorEvent(msg) {
  return !!msg && msg.type === EVENT_TYPES.ERROR
    && typeof msg.code === 'string' && !!msg.code
    && typeof msg.message === 'string' && !!msg.message;
}

export function isPhaseEvent(msg) {
  return !!msg && msg.type === EVENT_TYPES.PHASE
    && typeof msg.turn_id === 'string' && !!msg.turn_id
    && PHASES.includes(msg.phase)
    && EDGES.includes(msg.edge);
}

export function isContentEvent(msg) {
  return !!msg && msg.type === EVENT_TYPES.CONTENT && CONTENT_KINDS.includes(msg.kind);
}

export function isContentChartEvent(msg) {
  return isContentEvent(msg) && msg.kind === 'chart' && Array.isArray(msg.series);
}

export function isContentTableEvent(msg) {
  return isContentEvent(msg) && msg.kind === 'table' && Array.isArray(msg.columns) && Array.isArray(msg.rows);
}

export function isContentWidgetEvent(msg) {
  return isContentEvent(msg) && msg.kind === 'widget' && typeof msg.widget_type === 'string' && !!msg.widget_type;
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

/**
 * Pure reducer for the phase-timing/debug-latency-panel feature. Applies
 * one `phase` event to a capped list of per-turn phase timestamps.
 *
 * Semantics deliberately match the backend's documented caveat (see
 * events.py's send_phase docstring): 'llm' may fire more than one
 * start/end pair for a single turn_id when the model performs a tool
 * call mid-turn. To make that produce one sensible duration rather than
 * garbage: on edge:'start' the timestamp is set only if not already set
 * (idempotent-first-start, so a second start doesn't reset the clock);
 * on edge:'end' the timestamp is always overwritten (idempotent-last-end,
 * so the final duration spans first-start to the *last* end, covering
 * the whole tool-call detour).
 */
export function reducePhaseEvent(turns, msg, now = Date.now()) {
  if (!isPhaseEvent(msg)) return turns;

  const idx = turns.findIndex((t) => t.turnId === msg.turn_id);
  const existing = idx === -1
    ? { turnId: msg.turn_id, phases: { stt: {}, llm: {}, tts: {} } }
    : turns[idx];

  const phaseTimes = { ...existing.phases[msg.phase] };
  if (msg.edge === 'start') {
    if (phaseTimes.start === undefined) phaseTimes.start = msg.ts;
  } else {
    phaseTimes.end = msg.ts;
  }

  const updated = { ...existing, phases: { ...existing.phases, [msg.phase]: phaseTimes } };

  let next;
  if (idx === -1) {
    next = [...turns, updated];
  } else {
    next = [...turns.slice(0, idx), updated, ...turns.slice(idx + 1)];
  }

  if (next.length > MAX_TRACKED_TURNS) {
    next = next.slice(next.length - MAX_TRACKED_TURNS);
  }
  return next;
}

/**
 * Derive {sttMs, llmMs, ttsMs, roundTripMs} from one reducePhaseEvent turn
 * entry. Any phase still missing an `end` (or never started) yields null
 * for that field, not NaN/Infinity - callers render that as "in progress"
 * rather than a bogus number.
 */
export function computeTurnDurations(turn) {
  const durations = {};
  let firstStart;
  let lastEnd;

  for (const phase of PHASES) {
    const { start, end } = turn?.phases?.[phase] || {};
    const key = `${phase}Ms`;
    if (typeof start === 'number' && typeof end === 'number') {
      durations[key] = end - start;
      if (firstStart === undefined || start < firstStart) firstStart = start;
      if (lastEnd === undefined || end > lastEnd) lastEnd = end;
    } else {
      durations[key] = null;
    }
  }

  durations.roundTripMs = firstStart !== undefined && lastEnd !== undefined
    ? lastEnd - firstStart
    : null;

  return durations;
}

/**
 * Merges transcript entries ({role, text, ts}) and rich content blocks
 * ({kind, ts, ...}) into one chronologically-ordered chat feed, each entry
 * tagged with a discriminant `kind`: 'transcript' or 'content'. Pure/
 * dependency-free, matching this module's other reducers - ties broken by
 * stable input order (transcript before content at equal ts) so rendering
 * doesn't jitter between re-renders.
 */
export function buildChatFeed(transcriptHistory, contentBlocks) {
  const transcriptEntries = transcriptHistory.map((entry, i) => ({
    kind: 'transcript', ts: entry.ts ?? 0, role: entry.role, text: entry.text, _order: i,
  }));
  const contentEntries = contentBlocks.map((content, i) => ({
    kind: 'content', ts: content.ts ?? 0, content, _order: transcriptEntries.length + i,
  }));
  return [...transcriptEntries, ...contentEntries]
    .sort((a, b) => (a.ts - b.ts) || (a._order - b._order))
    .map(({ _order, ...rest }) => rest);
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
