import { useState, useEffect, useCallback } from 'react';
import { useVoice } from '../context/VoiceContext.jsx';
import {
  EVENT_TYPES,
  isTranscriptEvent,
  isConfirmRequestEvent,
} from '../voice/events.js';

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
  const [transcriptHistory, setTranscriptHistory] = useState([]); // [{ role, text }]
  const [pendingConfirm, setPendingConfirm] = useState(null); // confirm_request payload

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
          setTranscriptHistory((prev) => [...prev, { role: msg.role, text: msg.text }]);
        }
        if (msg.role === 'assistant') setState(msg.final ? 'idle' : 'speaking');
        return;
      }
      if (isConfirmRequestEvent(msg)) {
        setPendingConfirm(msg);
      }
    });
    return unsub;
  }, [client]);

  const startTalk = useCallback(async () => {
    if (connectionStatus !== 'connected') return;
    setState('listening');
    await client.startTalking();
  }, [client, connectionStatus]);

  const stopTalk = useCallback(async () => {
    await client.stopTalking();
    setState((s) => (s === 'listening' ? 'thinking' : s));
  }, [client]);

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
