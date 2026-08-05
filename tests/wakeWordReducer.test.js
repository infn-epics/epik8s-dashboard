import { describe, it, expect } from 'vitest';
import {
  wakeWordReducer,
  deriveWakeWordAction,
  initialWakeWordState,
  WAKE_STATES,
  WAKE_ACTIONS,
} from '../src/voice/wakeWord.js';

function step(state, type, ts, options) {
  const next = wakeWordReducer(state, { type, ts }, options);
  const action = deriveWakeWordAction(state.phase, next.phase);
  return { next, action };
}

describe('wakeWordReducer', () => {
  it('starts disabled', () => {
    expect(initialWakeWordState().phase).toBe(WAKE_STATES.DISABLED);
  });

  it('ENABLE arms from disabled, is a no-op once already armed/active', () => {
    let s = initialWakeWordState();
    s = wakeWordReducer(s, { type: 'ENABLE', ts: 0 });
    expect(s.phase).toBe(WAKE_STATES.ARMED);

    const armed = s;
    s = wakeWordReducer(s, { type: 'ENABLE', ts: 1 });
    expect(s).toBe(armed); // same reference - true no-op, not just same value
  });

  it('WAKE_DETECTED only fires from armed, moves to active', () => {
    const disabled = initialWakeWordState();
    expect(wakeWordReducer(disabled, { type: 'WAKE_DETECTED', ts: 0 })).toBe(disabled);

    const armed = wakeWordReducer(disabled, { type: 'ENABLE', ts: 0 });
    const active = wakeWordReducer(armed, { type: 'WAKE_DETECTED', ts: 100 });
    expect(active.phase).toBe(WAKE_STATES.ACTIVE);
    expect(active.hasSpokenYet).toBe(false);
    expect(active.activeSince).toBe(100);
  });

  it('DISABLE resets to disabled from any phase', () => {
    let s = initialWakeWordState();
    s = wakeWordReducer(s, { type: 'ENABLE', ts: 0 });
    s = wakeWordReducer(s, { type: 'WAKE_DETECTED', ts: 0 });
    expect(s.phase).toBe(WAKE_STATES.ACTIVE);
    s = wakeWordReducer(s, { type: 'DISABLE', ts: 0 });
    expect(s).toEqual(initialWakeWordState());
  });

  it('SILENCE_TICK is ignored until speech has actually been heard post-wake', () => {
    let s = initialWakeWordState();
    s = wakeWordReducer(s, { type: 'ENABLE', ts: 0 });
    s = wakeWordReducer(s, { type: 'WAKE_DETECTED', ts: 0 });
    // A long gap with no SPEECH_DETECTED yet must not trigger a stop - the
    // operator may just be pausing before they start their command.
    const stillActive = wakeWordReducer(s, { type: 'SILENCE_TICK', ts: 100000 });
    expect(stillActive.phase).toBe(WAKE_STATES.ACTIVE);
  });

  it('SILENCE_TICK stops only after enough quiet time following real speech', () => {
    let s = initialWakeWordState();
    s = wakeWordReducer(s, { type: 'ENABLE', ts: 0 });
    s = wakeWordReducer(s, { type: 'WAKE_DETECTED', ts: 0 });
    s = wakeWordReducer(s, { type: 'SPEECH_DETECTED', ts: 500 });

    const tooSoon = wakeWordReducer(s, { type: 'SILENCE_TICK', ts: 600 }, { silenceMs: 1500 });
    expect(tooSoon.phase).toBe(WAKE_STATES.ACTIVE);

    const { next, action } = step(s, 'SILENCE_TICK', 2100, { silenceMs: 1500 });
    expect(next.phase).toBe(WAKE_STATES.ARMED);
    expect(action).toBe(WAKE_ACTIONS.STOP_TALK);
  });

  it('a fresh SPEECH_DETECTED resets the silence clock', () => {
    let s = initialWakeWordState();
    s = wakeWordReducer(s, { type: 'ENABLE', ts: 0 });
    s = wakeWordReducer(s, { type: 'WAKE_DETECTED', ts: 0 });
    s = wakeWordReducer(s, { type: 'SPEECH_DETECTED', ts: 500 });
    s = wakeWordReducer(s, { type: 'SILENCE_TICK', ts: 1000 }, { silenceMs: 1500 }); // not yet silent long enough
    s = wakeWordReducer(s, { type: 'SPEECH_DETECTED', ts: 1600 }); // operator kept talking
    const stillActive = wakeWordReducer(s, { type: 'SILENCE_TICK', ts: 2200 }, { silenceMs: 1500 });
    expect(stillActive.phase).toBe(WAKE_STATES.ACTIVE);
  });

  it('MAX_DURATION_TICK is a hard backstop independent of speech/silence state', () => {
    let s = initialWakeWordState();
    s = wakeWordReducer(s, { type: 'ENABLE', ts: 0 });
    s = wakeWordReducer(s, { type: 'WAKE_DETECTED', ts: 0 });
    // No SPEECH_DETECTED at all - silence timer would never fire on its
    // own, but the max-duration backstop still must.
    const { next, action } = step(s, 'MAX_DURATION_TICK', 15000, { maxDurationMs: 15000 });
    expect(next.phase).toBe(WAKE_STATES.ARMED);
    expect(action).toBe(WAKE_ACTIONS.STOP_TALK);
  });

  it('unknown event types are a no-op (same reference)', () => {
    const s = initialWakeWordState();
    expect(wakeWordReducer(s, { type: 'BOGUS', ts: 0 })).toBe(s);
  });
});

describe('deriveWakeWordAction', () => {
  it('emits START_TALK only when entering active', () => {
    expect(deriveWakeWordAction(WAKE_STATES.ARMED, WAKE_STATES.ACTIVE)).toBe(WAKE_ACTIONS.START_TALK);
    expect(deriveWakeWordAction(WAKE_STATES.DISABLED, WAKE_STATES.ACTIVE)).toBe(WAKE_ACTIONS.START_TALK);
  });

  it('emits STOP_TALK only when leaving active', () => {
    expect(deriveWakeWordAction(WAKE_STATES.ACTIVE, WAKE_STATES.ARMED)).toBe(WAKE_ACTIONS.STOP_TALK);
    expect(deriveWakeWordAction(WAKE_STATES.ACTIVE, WAKE_STATES.DISABLED)).toBe(WAKE_ACTIONS.STOP_TALK);
  });

  it('is null for transitions that do not cross the active boundary', () => {
    expect(deriveWakeWordAction(WAKE_STATES.DISABLED, WAKE_STATES.ARMED)).toBeNull();
    expect(deriveWakeWordAction(WAKE_STATES.ARMED, WAKE_STATES.DISABLED)).toBeNull();
    expect(deriveWakeWordAction(WAKE_STATES.ACTIVE, WAKE_STATES.ACTIVE)).toBeNull();
  });
});
