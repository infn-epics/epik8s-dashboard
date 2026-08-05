/**
 * Pure, framework-free state machine for hands-free "wake word" mode
 * (src/hooks/useWakeWord.js). Mirrors this module's own reducePhaseEvent
 * convention (see events.js): no React, no Picovoice SDK - directly
 * unit-testable, `useReducer`-compatible ((state, event) => nextState).
 *
 * States:
 *   disabled - feature off (toggle not enabled, or engines not yet ready)
 *   armed    - idle, Porcupine listening locally for the wake word (no
 *              LiveKit track published - see this beamline's current
 *              single-concurrent-RTC-session constraint, which is why
 *              wake-word listening must never publish while idle)
 *   active   - wake word fired, mic published (via the caller's onWake),
 *              Cobra VAD watching for end-of-utterance before onSilence
 *
 * The silence timer only starts counting once real speech has been heard
 * post-wake (hasSpokenYet) - a brief pause before the operator starts
 * talking must not immediately cut them off. maxDurationMs is a hard
 * safety backstop independent of the silence timer: if it fires, worst
 * case the mic stays open a bit too long - the backend's own Silero VAD
 * (agent.py's stt_node) still correctly ends the STT turn once a track is
 * published, so this can never cause a broken/garbled turn, only an
 * annoying one.
 */

export const WAKE_STATES = {
  DISABLED: 'disabled',
  ARMED: 'armed',
  ACTIVE: 'active',
};

export const WAKE_ACTIONS = {
  START_TALK: 'START_TALK',
  STOP_TALK: 'STOP_TALK',
};

export const DEFAULT_SILENCE_MS = 1500;
export const DEFAULT_MAX_DURATION_MS = 15000;

export function initialWakeWordState() {
  return {
    phase: WAKE_STATES.DISABLED,
    hasSpokenYet: false,
    activeSince: null,
    lastSpeechAt: null,
  };
}

function armedState() {
  return { phase: WAKE_STATES.ARMED, hasSpokenYet: false, activeSince: null, lastSpeechAt: null };
}

/**
 * `useReducer`-compatible: returns only the next state, never a tuple.
 * Pair with deriveWakeWordAction() below to know when to actually call
 * onWake()/onSilence() - kept separate so each half is independently
 * testable and neither needs to know about the other's existence.
 *
 * @param {ReturnType<typeof initialWakeWordState>} state
 * @param {{type: 'ENABLE'|'DISABLE'|'WAKE_DETECTED'|'SPEECH_DETECTED'|'SILENCE_TICK'|'MAX_DURATION_TICK', ts?: number}} event
 * @param {{silenceMs?: number, maxDurationMs?: number}} [options]
 */
export function wakeWordReducer(state, event, options = {}) {
  const now = event.ts ?? Date.now();
  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

  switch (event.type) {
    case 'DISABLE':
      return initialWakeWordState();

    case 'ENABLE':
      return state.phase === WAKE_STATES.DISABLED ? armedState() : state;

    case 'WAKE_DETECTED':
      if (state.phase !== WAKE_STATES.ARMED) return state;
      return { phase: WAKE_STATES.ACTIVE, hasSpokenYet: false, activeSince: now, lastSpeechAt: null };

    case 'SPEECH_DETECTED':
      if (state.phase !== WAKE_STATES.ACTIVE) return state;
      return { ...state, hasSpokenYet: true, lastSpeechAt: now };

    case 'SILENCE_TICK':
      if (state.phase !== WAKE_STATES.ACTIVE || !state.hasSpokenYet) return state;
      return now - state.lastSpeechAt >= silenceMs ? armedState() : state;

    case 'MAX_DURATION_TICK':
      if (state.phase !== WAKE_STATES.ACTIVE) return state;
      return now - state.activeSince >= maxDurationMs ? armedState() : state;

    default:
      return state;
  }
}

/**
 * Pure function of a phase transition -> the side effect the hook should
 * perform, if any. Called with (prevState.phase, nextState.phase) after
 * every dispatch - entering 'active' means "publish the mic now"
 * (onWake), leaving it means "stop publishing" (onSilence). Every other
 * transition (including disabled<->armed) has no side effect here.
 */
export function deriveWakeWordAction(prevPhase, nextPhase) {
  if (prevPhase !== WAKE_STATES.ACTIVE && nextPhase === WAKE_STATES.ACTIVE) return WAKE_ACTIONS.START_TALK;
  if (prevPhase === WAKE_STATES.ACTIVE && nextPhase !== WAKE_STATES.ACTIVE) return WAKE_ACTIONS.STOP_TALK;
  return null;
}
