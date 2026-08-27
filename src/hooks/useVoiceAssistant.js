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
// STT normally completes in a few seconds. Silence, a failed/empty capture,
// or a lost STT event must not leave the UI showing "Trascrizione…" for the
// full whole-turn timeout.
export const VOICE_STT_TIMEOUT_MS = 15000;

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
  // Pointer-up is delivered both by the button and the window safety-net.
  // Treat press/release as one transaction so duplicate release events cannot
  // race each other and cancel/re-arm the wrong turn.
  const talkActiveRef = useRef(false);
  const releaseInFlightRef = useRef(false);

  const clearCompletionTimer = useCallback(() => {
    if (completionTimerRef.current !== null) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
  }, []);

  const armCompletionTimer = useCallback((timeoutMs = VOICE_COMPLETION_TIMEOUT_MS) => {
    clearCompletionTimer();
    completionTimerRef.current = setTimeout(() => {
      completionTimerRef.current = null;
      talkActiveRef.current = false;
      releaseInFlightRef.current = false;
      setState((current) => (
        current === 'thinking' || current === 'speaking' ? 'idle' : current
      ));
    }, timeoutMs);
  }, [clearCompletionTimer]);

  useEffect(() => {
    if (connectionStatus === 'error') {
      clearCompletionTimer();
      talkActiveRef.current = false;
      releaseInFlightRef.current = false;
      setState('error');
    } else if (connectionStatus !== 'connected') {
      clearCompletionTimer();
      talkActiveRef.current = false;
      releaseInFlightRef.current = false;
      setState('idle');
    } else {
      setState((current) => (current === 'error' ? 'idle' : current));
    }
  }, [connectionStatus, clearCompletionTimer]);

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
        } else if (msg.final) {
          // Recognition succeeded, but the LLM has not started yet. Keep the
          // short transition deadline until an explicit llm:start arrives.
          armCompletionTimer(VOICE_STT_TIMEOUT_MS);
        }
        return;
      }
      if (isPhaseEvent(msg)) {
        if (msg.phase === 'stt') {
          // Re-arm on both edges: after STT completes, allow a bounded grace
          // period for the LLM to start. Empty/no-speech turns then recover.
          armCompletionTimer(VOICE_STT_TIMEOUT_MS);
        } else if (msg.phase === 'llm') {
          // The model call itself may legitimately be long. Once it ends,
          // require TTS to start promptly instead of showing
          // "Elaborazione…" for the full whole-turn watchdog.
          armCompletionTimer(
            msg.edge === 'start' ? VOICE_COMPLETION_TIMEOUT_MS : VOICE_STT_TIMEOUT_MS,
          );
        } else if (msg.phase === 'tts' && msg.edge === 'start') {
          armCompletionTimer();
          setState((current) => (current === 'thinking' ? 'speaking' : current));
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
    if (connectionStatus !== 'connected' || talkActiveRef.current) return false;
    talkActiveRef.current = true;
    releaseInFlightRef.current = false;
    clearCompletionTimer();
    setState('listening');
    const published = await client.startTalking();
    if (!published && talkActiveRef.current) {
      talkActiveRef.current = false;
      setState((current) => (current === 'listening' ? 'idle' : current));
    }
    return published;
  }, [client, connectionStatus, clearCompletionTimer]);

  const stopTalk = useCallback(async () => {
    if (!talkActiveRef.current || releaseInFlightRef.current) return false;
    releaseInFlightRef.current = true;
    const published = await client.stopTalking();
    talkActiveRef.current = false;
    releaseInFlightRef.current = false;

    if (!published) {
      setState((current) => (current === 'listening' ? 'idle' : current));
      return false;
    }

    armCompletionTimer(VOICE_STT_TIMEOUT_MS);
    setState((current) => (current === 'listening' ? 'thinking' : current));
    return true;
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

  const sendText = useCallback((rawText) => {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    // One active turn at a time avoids interleaving a typed request with a
    // pressed microphone turn or a response already being spoken.
    if (!text || text.length > 4000 || connectionStatus !== 'connected'
      || talkActiveRef.current || state !== 'idle') return false;

    clearCompletionTimer();
    client.sendData({ type: EVENT_TYPES.TEXT_INPUT, text, ts: Date.now() });
    armCompletionTimer();
    setState('thinking');
    return true;
  }, [client, connectionStatus, state, armCompletionTimer, clearCompletionTimer]);

  return {
    state,
    connectionStatus,
    partialTranscript,
    transcriptHistory,
    pendingConfirm,
    startTalk,
    stopTalk,
    sendText,
    respondConfirm,
    isTalking: client.isTalking,
  };
}
