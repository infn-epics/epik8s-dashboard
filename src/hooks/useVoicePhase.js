import { useVoicePhaseContext } from '../context/VoicePhaseContext.jsx';
import { computeTurnDurations } from '../voice/events.js';

const RECENT_TURN_LIMIT = 8;

// Most-recently-started phase wins (stt -> llm -> tts pipeline order), so
// once tts starts we keep showing 'tts' even briefly after it ends, rather
// than flickering back to an earlier phase.
function derivePhaseFromTurn(turn) {
  if (!turn) return null;
  const { stt, llm, tts } = turn.phases;
  if (tts?.start !== undefined) return 'tts';
  if (llm?.start !== undefined) return 'llm';
  if (stt?.start !== undefined) return 'stt';
  return null;
}

/**
 * useVoicePhase — derives a finer-grained visualPhase
 * (idle|listening|stt|llm|tts|error) from useVoiceAssistant()'s coarse
 * 5-state machine plus VoicePhaseContext's per-turn phase timestamps, for
 * the Jarvis-like animation and debug latency panel.
 *
 * Deliberately takes the caller's already-computed assistantState as a
 * parameter rather than calling useVoiceAssistant() itself — useVoice
 * Assistant is not modified by this feature, and this avoids a second,
 * redundant subscription to the same data-channel transcript events.
 */
export function useVoicePhase(assistantState) {
  const { turns, currentTurn } = useVoicePhaseContext();

  let visualPhase;
  if (assistantState === 'error') visualPhase = 'error';
  else if (assistantState === 'idle') visualPhase = 'idle';
  else if (assistantState === 'listening') visualPhase = 'listening';
  else {
    // 'thinking' or 'speaking': derive the finer sub-phase from the
    // current turn's phase timestamps, falling back to a sensible
    // default for the brief window before the new turn's first phase
    // event has arrived yet.
    visualPhase = derivePhaseFromTurn(currentTurn) || (assistantState === 'speaking' ? 'tts' : 'stt');
  }

  const currentPhaseTimes = currentTurn?.phases?.[visualPhase];
  const liveDurationMs = currentPhaseTimes?.start !== undefined && currentPhaseTimes?.end === undefined
    ? Date.now() - currentPhaseTimes.start
    : null;

  const recentTurns = turns
    .slice(-RECENT_TURN_LIMIT)
    .reverse()
    .map((turn) => ({ turnId: turn.turnId, ...computeTurnDurations(turn) }));

  return { visualPhase, liveDurationMs, recentTurns };
}
