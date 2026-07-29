import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useVoice } from './VoiceContext.jsx';
import { isHighlightEvent, matchDeviceId, upsertHighlight, pruneExpired, DEFAULT_HIGHLIGHT_TTL_MS } from '../voice/events.js';

const VoiceHighlightContext = createContext(null);

/**
 * VoiceHighlightProvider — tracks devices the voice agent is currently
 * highlighting (data channel `highlight` events), auto-clearing each entry
 * after its TTL. Must be nested inside VoiceProvider.
 *
 * Deliberately separate from VoiceContext/useVoiceAssistant: this value
 * only changes on highlight add/expire (rare, cheap), whereas assistant
 * state changes on every partial-transcript word — combining them would
 * re-render every WidgetFrame in the grid on every spoken syllable.
 */
export function VoiceHighlightProvider({ children }) {
  const { client } = useVoice();
  const [highlights, setHighlights] = useState([]); // [{ deviceId, reason, expiresAt }]
  const timersRef = useRef(new Map());

  useEffect(() => {
    const unsub = client.onData((msg) => {
      if (!isHighlightEvent(msg)) return;
      const now = Date.now();
      setHighlights((prev) => upsertHighlight(prev, msg, now));

      const ttl = Number.isFinite(msg.ttl_ms) ? msg.ttl_ms : DEFAULT_HIGHLIGHT_TTL_MS;
      const prevTimer = timersRef.current.get(msg.device_id);
      if (prevTimer) clearTimeout(prevTimer);
      const timer = setTimeout(() => {
        setHighlights((prev) => pruneExpired(prev, Date.now() + 1));
        timersRef.current.delete(msg.device_id);
      }, ttl);
      timersRef.current.set(msg.device_id, timer);
    });
    return unsub;
  }, [client]);

  useEffect(() => () => {
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
  }, []);

  const isHighlighted = useCallback((pvPrefix, deviceId) => {
    const now = Date.now();
    for (const h of highlights) {
      if (h.expiresAt <= now) continue;
      if (matchDeviceId(h.deviceId, { pvPrefix, deviceId })) return true;
    }
    return false;
  }, [highlights]);

  const value = { highlights, isHighlighted };

  return <VoiceHighlightContext.Provider value={value}>{children}</VoiceHighlightContext.Provider>;
}

export function useVoiceHighlight() {
  const ctx = useContext(VoiceHighlightContext);
  if (!ctx) throw new Error('useVoiceHighlight must be used within VoiceHighlightProvider');
  return ctx;
}
