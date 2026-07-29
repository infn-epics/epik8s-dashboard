import { createContext, useContext, useEffect, useState } from 'react';
import { useVoice } from './VoiceContext.jsx';
import { isPhaseEvent, reducePhaseEvent } from '../voice/events.js';

const VoicePhaseContext = createContext(null);

/**
 * VoicePhaseProvider — tracks fine-grained STT/LLM/TTS phase-transition
 * events (data channel `phase` events) for the Jarvis-like animation and
 * debug latency panel. Must be nested inside VoiceProvider.
 *
 * Deliberately separate from both VoiceContext (low-churn, connection
 * status only) and VoiceHighlightContext (a different concern): phase
 * events fire ~6-8 times per turn, still far below per-syllable partial-
 * transcript churn, but there's no reason to force re-renders of anything
 * that only cares about highlights or connection status.
 */
export function VoicePhaseProvider({ children }) {
  const { client } = useVoice();
  const [turns, setTurns] = useState([]); // [{ turnId, phases: { stt, llm, tts } }]

  useEffect(() => {
    const unsub = client.onData((msg) => {
      if (!isPhaseEvent(msg)) return;
      setTurns((prev) => reducePhaseEvent(prev, msg));
    });
    return unsub;
  }, [client]);

  const currentTurn = turns.length ? turns[turns.length - 1] : null;

  const value = { turns, currentTurn };

  return <VoicePhaseContext.Provider value={value}>{children}</VoicePhaseContext.Provider>;
}

export function useVoicePhaseContext() {
  const ctx = useContext(VoicePhaseContext);
  if (!ctx) throw new Error('useVoicePhaseContext must be used within VoicePhaseProvider');
  return ctx;
}
