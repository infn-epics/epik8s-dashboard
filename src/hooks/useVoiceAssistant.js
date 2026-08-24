import { useState, useEffect, useCallback, useRef } from 'react';
import { useVoice } from '../context/VoiceContext.jsx';
import {
  EVENT_TYPES,
  isTranscriptEvent,
  isConfirmRequestEvent,
  isPhaseEvent,
} from '../voice/events.js';

// A lost data-channel completion event must not leave the control stuck in
// "Risposta…" forever. Normal turns finish on tts:end much sooner; this is
// only a bounded last-resort recovery for a dropped event or broken agent.
export const VOICE_COMPLETION_TIMEOUT_MS = 120000;

/**
 * useVoiceAssistant — single-consumer hook (VoiceConsole.jsx) layering the
 * push-to-talk state machine and transcript/confirmation bookkeeping on top
 * of the shared VoiceRoomClient from useVoice().
 *
 * States: idle | listening | thinking | speaking | error.
 *   idle      — connected, mic not active
 *   listening — push-to-talk held, mic publishing
 *   thinking  — talk released, waiting for the agent's reply
 *   speaking  — agent's audio/transcript is streaming back
 *   error     — room connection error (see connectionStatus from useVoice())
 */
export function useVoiceAssistant() {
  const { client, connectionStatus } = useVoice();
  const [state, setState] = useState('idle');
  const [partialTranscript, setPartialTranscript] = useState(null); // { role, text }
  const [transcriptHistory, setTranscriptHistory] = useState([]); // [{ role, text, ts }]
  const [pendingConfirm, setPendingConfirm] = useState(null); // confirm_request payload
  const completionTimerRef = useRef(null);

  const clearCompletionTimer = useCallback(() => {
    if (completionTimerRef.current !== null) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
  }, []);

  const armCompletionTimer = useCallback(() => {
    clearCompletionTimer();
    completionTimerRef.current = setTimeout(() => {
      completionTimerRef.current = null;
      setState((current) => (
        current === 'thinking' || current === 'speaking' ? 'idle' : current
      ));
    }, VOICE_COMPLETION_TIMEOUT_MS);
  }, [clearCompletionTimer]);

  useEffect(() => {
    if (connectionStatus === 'error') setState('error');
    else if (connectionStatus !== 'connected' && state === 'error') setState('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus]);

  useEffect(() => {
    const unsub = client.onData((msg) => {
      if (isTranscriptEvent(msg)) {
        if (!msg.final) {
          setPartialTranscript({ role: msg.role, text: msg.text });
        } else {
          setPartialTranscript(null);
          // ts (already sent by the backend on every transcript event, see
          // events.py's send_transcript) is threaded through so buildChatFeed
          // (src/voice/events.js) can interleave content blocks chronologically
          // - it was previously silently dropped here, unused until now.
          setTranscriptHistory((prev) => [...prev, { role: msg.role, text: msg.text, ts: msg.ts }]);
        }
        if (msg.role === 'assistant') {
          if (msg.final) {
            clearCompletionTimer();
            setState('idle');
          } else {
            armCompletionTimer();
            setState('speaking');
          }
        }
        return;
      }
      if (isPhaseEvent(msg)) {
        if (msg.phase === 'tts' && msg.edge === 'start') {
          armCompletionTimer();
        } else if (msg.phase === 'tts' && msg.edge === 'end') {
          // TTS completion is authoritative for the visual state and is
          // independent of the optional transcript mirror event.
          clearCompletionTimer();
          setState((current) => (
            current === 'thinking' || current === 'speaking' ? 'idle' : current
          ));
        }
        return;
      }
      if (isConfirmRequestEvent(msg)) {
        setPendingConfirm(msg);
      }
    });
    return () => {
      unsub();
      clearCompletionTimer();
    };
  }, [client, armCompletionTimer, clearCompletionTimer]);

  const startTalk = useCallback(async () => {
    if (connectionStatus !== 'connected') return;
    clearCompletionTimer();
    setState('listening');
    await client.startTalking();
  }, [client, connectionStatus, clearCompletionTimer]);

  const stopTalk = useCallback(async () => {
    await client.stopTalking();
    armCompletionTimer();
    setState((s) => (s === 'listening' ? 'thinking' : s));
  }, [client, armCompletionTimer]);

  const respondConfirm = useCallback((actionId, confirmed) => {
    client.sendData({
      type: EVENT_TYPES.CONFIRM_ACTION,
      action_id: actionId,
      confirmed,
      ts: Date.now(),
    });
    setPendingConfirm((prev) => (prev?.action_id === actionId ? null : prev));
  }, [client]);

  return {
    state,
    connectionStatus,
    partialTranscript,
    transcriptHistory,
    pendingConfirm,
    startTalk,
    stopTalk,
    respondConfirm,
    isTalking: client.isTalking,
  };
}
