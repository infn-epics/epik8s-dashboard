import { useEffect, useReducer, useRef } from 'react';
import {
  wakeWordReducer,
  deriveWakeWordAction,
  initialWakeWordState,
  WAKE_STATES,
  WAKE_ACTIONS,
} from '../voice/wakeWord.js';

const TICK_MS = 250;
const SPEECH_PROBABILITY_THRESHOLD = 0.6;

// Module-level singleton guard: at most one real Porcupine+Cobra engine
// pair runs at a time, even if both VoiceConsole.jsx and ArgusView.jsx
// have the toggle enabled and mounted simultaneously - a second instance
// just never arms rather than doubling CPU/WASM-engine instances and
// running two independent mic subscriptions through the same shared
// WebVoiceProcessor. Mirrors the generation-counter guard style already
// used in src/services/voiceRoom.js for the same class of "avoid two
// things racing over one shared resource" problem.
let activeToken = null;

/**
 * useWakeWord — hands-free "wake word" mode for the ARGUS voice assistant.
 * Runs Porcupine (wake-word detection) and Cobra (VAD, end-of-utterance)
 * entirely client-side via @picovoice/web-voice-processor's own mic
 * capture - NEVER touches src/services/voiceRoom.js or publishes to
 * LiveKit while idle (this beamline's RTC path currently supports only
 * one concurrent published session - see src/voice/wakeWord.js's module
 * docstring for why). Only once the wake word fires does it call
 * onWake()/onSilence(), which callers wire to useVoiceAssistant()'s
 * startTalk()/stopTalk() - from the mic-publish side onward this is
 * indistinguishable from the existing press-and-hold flow.
 *
 * The three @picovoice/* packages are dynamically import()'d inside the
 * init effect below, NOT imported statically at module scope - confirmed
 * live that a static import pulls their embedded WASM binaries into the
 * app's main bundle unconditionally (measured: 1.4MB -> 6.5MB, gzip
 * 361KB -> 1.88MB), which every page load would pay even on beamlines
 * that never configure a wake word. A dynamic import here means that cost
 * is only ever paid by a browser that actually enables hands-free mode.
 *
 * Used independently in both VoiceConsole.jsx and ArgusView.jsx, each
 * wired to that call site's own startTalk/stopTalk - matching this
 * codebase's existing pattern of duplicated per-surface hooks rather than
 * lifting state into VoiceContext (see useVoicePhase.js's own doc comment
 * for the same rationale: avoids a second, redundant subscription while
 * keeping VoiceContext deliberately thin).
 *
 * @param {{enabled: boolean, config: {accessKey?: string, keywordUrl?: string, modelUrl?: string}, onWake: () => void, onSilence: () => void}} args
 * @returns {{armed: boolean}}
 */
export function useWakeWord({ enabled, config, onWake, onSilence }) {
  const [state, dispatch] = useReducer(wakeWordReducer, initialWakeWordState());
  const prevPhaseRef = useRef(state.phase);
  const porcupineRef = useRef(null);
  const cobraRef = useRef(null);
  const wvpRef = useRef(null); // the dynamically-loaded WebVoiceProcessor class
  const tickRef = useRef(null);
  const onWakeRef = useRef(onWake);
  const onSilenceRef = useRef(onSilence);
  onWakeRef.current = onWake;
  onSilenceRef.current = onSilence;

  const accessKey = config?.accessKey;
  const keywordUrl = config?.keywordUrl;
  const modelUrl = config?.modelUrl;

  // Init/teardown of the real Picovoice engines, guarded by the
  // module-level singleton above. Keyed on the primitive config fields
  // (not the config object's identity) so a caller re-creating the config
  // object every render doesn't tear down and reinitialize the WASM
  // engines needlessly.
  useEffect(() => {
    if (!enabled || !accessKey || !keywordUrl || !modelUrl) {
      dispatch({ type: 'DISABLE' });
      return undefined;
    }
    if (activeToken !== null) {
      // Another mounted surface already owns the engines - stay disarmed
      // rather than spinning up a redundant, competing pair.
      return undefined;
    }

    const token = {};
    activeToken = token;
    let cancelled = false;

    (async () => {
      let porcupine;
      let cobra;
      try {
        const [{ PorcupineWorker }, { CobraWorker }, { WebVoiceProcessor }] = await Promise.all([
          import('@picovoice/porcupine-web'),
          import('@picovoice/cobra-web'),
          import('@picovoice/web-voice-processor'),
        ]);
        if (cancelled) return;
        wvpRef.current = WebVoiceProcessor;

        porcupine = await PorcupineWorker.create(
          accessKey,
          { publicPath: keywordUrl, label: 'argus' },
          () => { if (!cancelled) dispatch({ type: 'WAKE_DETECTED' }); },
          { publicPath: modelUrl },
        );
        cobra = await CobraWorker.create(
          accessKey,
          (probability) => {
            if (!cancelled && probability > SPEECH_PROBABILITY_THRESHOLD) dispatch({ type: 'SPEECH_DETECTED' });
          },
        );
        if (cancelled) {
          porcupine.release().then(() => porcupine.terminate()).catch(() => {});
          cobra.release().then(() => cobra.terminate()).catch(() => {});
          return;
        }
        porcupineRef.current = porcupine;
        cobraRef.current = cobra;
        await WebVoiceProcessor.subscribe([porcupine]);
        dispatch({ type: 'ENABLE' });
      } catch (err) {
        console.warn('[useWakeWord] failed to initialize Porcupine/Cobra:', err);
        porcupine?.release().then(() => porcupine.terminate()).catch(() => {});
        cobra?.release().then(() => cobra.terminate()).catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
      if (activeToken === token) activeToken = null;
      clearInterval(tickRef.current);
      tickRef.current = null;
      const porcupine = porcupineRef.current;
      const cobra = cobraRef.current;
      const WebVoiceProcessor = wvpRef.current;
      porcupineRef.current = null;
      cobraRef.current = null;
      WebVoiceProcessor?.unsubscribe([porcupine, cobra].filter(Boolean)).catch(() => {});
      porcupine?.release().then(() => porcupine.terminate()).catch(() => {});
      cobra?.release().then(() => cobra.terminate()).catch(() => {});
      dispatch({ type: 'DISABLE' });
    };
  }, [enabled, accessKey, keywordUrl, modelUrl]);

  // React to phase transitions: swap which engine WebVoiceProcessor feeds
  // (Porcupine while armed, Cobra while active - never both at once, so
  // there's exactly one purpose-built engine consuming mic frames at any
  // moment), run the silence/max-duration tick timer only while active,
  // and fire onWake/onSilence exactly at the active-state boundary.
  useEffect(() => {
    const action = deriveWakeWordAction(prevPhaseRef.current, state.phase);
    prevPhaseRef.current = state.phase;
    if (!action) return;

    const porcupine = porcupineRef.current;
    const cobra = cobraRef.current;
    const WebVoiceProcessor = wvpRef.current;

    if (action === WAKE_ACTIONS.START_TALK) {
      if (porcupine && cobra && WebVoiceProcessor) {
        WebVoiceProcessor.unsubscribe([porcupine]).catch(() => {});
        WebVoiceProcessor.subscribe([cobra]).catch(() => {});
      }
      tickRef.current = setInterval(() => {
        dispatch({ type: 'SILENCE_TICK' });
        dispatch({ type: 'MAX_DURATION_TICK' });
      }, TICK_MS);
      onWakeRef.current?.();
    } else if (action === WAKE_ACTIONS.STOP_TALK) {
      clearInterval(tickRef.current);
      tickRef.current = null;
      if (porcupine && cobra && WebVoiceProcessor) {
        WebVoiceProcessor.unsubscribe([cobra]).catch(() => {});
        WebVoiceProcessor.subscribe([porcupine]).catch(() => {});
      }
      onSilenceRef.current?.();
    }
  }, [state.phase]);

  return { armed: state.phase === WAKE_STATES.ARMED };
}
