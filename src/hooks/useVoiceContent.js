import { useState, useEffect, useCallback } from 'react';
import { useVoice } from '../context/VoiceContext.jsx';
import { isContentEvent } from '../voice/events.js';

// Mirrors src/voice/events.js's MAX_TRACKED_TURNS rationale - only recent
// content needs to stay on screen in a live control-room session.
const MAX_TRACKED_CONTENT = 40;

/**
 * useVoiceContent — plain hook (not a Context, unlike VoicePhaseContext):
 * content events don't have Phase A's per-syllable-churn performance
 * rationale that justified a Context there, and this is currently a
 * single-consumer concern (VoiceConsole.jsx/ArgusView.jsx), same shape as
 * useVoiceAssistant() itself.
 *
 * toggleEmbed lets a table row (rendered by ContentTableBlock in
 * voiceContentUI.jsx) render a device's live widget inline purely
 * client-side, with no round-trip to the agent - it pushes a synthetic
 * local `kind:'widget'` content entry, reusing the exact same
 * ContentWidgetBlock rendering path as a server-sent content event.
 */
export function useVoiceContent() {
  const { client } = useVoice();
  const [contentBlocks, setContentBlocks] = useState([]);

  useEffect(() => {
    const unsub = client.onData((msg) => {
      if (!isContentEvent(msg)) return;
      setContentBlocks((prev) => {
        const next = [...prev, msg];
        return next.length > MAX_TRACKED_CONTENT ? next.slice(next.length - MAX_TRACKED_CONTENT) : next;
      });
    });
    return unsub;
  }, [client]);

  const toggleEmbed = useCallback((deviceId, widgetType, pvPrefix, title) => {
    if (!deviceId || !widgetType || !pvPrefix) return;
    setContentBlocks((prev) => {
      // True toggle: clicking the same device/widget_type again removes
      // its locally-embedded block instead of stacking duplicates -
      // `tool === 'local_click'` scopes this to blocks toggleEmbed itself
      // added, never a server-sent widget from a real device lookup (B3).
      const idx = prev.findIndex((b) =>
        b.kind === 'widget' && b.tool === 'local_click'
        && b.device_id === deviceId && b.widget_type === widgetType
      );
      if (idx !== -1) {
        return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
      }
      return [...prev, {
        type: 'content',
        kind: 'widget',
        tool: 'local_click',
        ts: Date.now(),
        title: title || deviceId,
        device_id: deviceId,
        pv_prefix: pvPrefix,
        widget_type: widgetType,
        config: { pvPrefix, viewMode: 'essential' },
      }];
    });
  }, []);

  return { contentBlocks, toggleEmbed };
}
