import { useEffect, useMemo, useState } from 'react';
import { useDraggable } from '../../hooks/useDraggable.js';
import { useApp } from '../../context/AppContext.jsx';
import { useVoice } from '../../context/VoiceContext.jsx';
import { useVoiceAssistant } from '../../hooks/useVoiceAssistant.js';
import { useVoicePhase } from '../../hooks/useVoicePhase.js';
import { useVoiceContent } from '../../hooks/useVoiceContent.js';
import { useWakeWord } from '../../hooks/useWakeWord.js';
import { buildChatFeed } from '../../voice/events.js';
import { VoiceOrb, TextPrompt, ConfirmationBanner, DebugPhasePanel, visualPhaseToLabel } from './voiceConsoleUI.jsx';
import { ChatFeed } from './voiceContentUI.jsx';

// Shared with ArgusView.jsx by design - a preference toggled on one voice
// surface should reflect on the other too, same spirit as this repo's
// other localStorage-persisted overrides (see AppContext.jsx's
// epik8s-voice-overrides).
const HANDS_FREE_LS_KEY = 'epik8s-voice-handsfree';

/**
 * VoiceConsole — floating/dockable panel for the experimental voice
 * assistant, structured like ChatConsole.jsx (console-panel/header,
 * useDraggable for the detached mode).
 *
 * Push-to-talk is press-and-hold: mousedown/touchstart publishes the mic
 * track, mouseup/touchend (also mouseleave, and a window-level listener so
 * releasing outside the button still stops it) unpublishes it. This avoids
 * an accidental "open mic" left on in a control room.
 */
export default function VoiceConsole({ detached, onDetach, onClose }) {
  const { voiceConfig, pvwsClient } = useApp();
  const { connectionStatus, connect } = useVoice();
  const {
    state,
    partialTranscript,
    transcriptHistory,
    pendingConfirm,
    startTalk,
    stopTalk,
    sendText,
    respondConfirm,
  } = useVoiceAssistant();
  const { visualPhase, liveDurationMs, recentTurns } = useVoicePhase(state);
  const { contentBlocks, toggleEmbed } = useVoiceContent();
  const feedEntries = useMemo(() => buildChatFeed(transcriptHistory, contentBlocks), [transcriptHistory, contentBlocks]);
  const { panelRef, onHeaderMouseDown } = useDraggable(detached);
  const connected = connectionStatus === 'connected';

  const [handsFreeOn, setHandsFreeOn] = useState(() => localStorage.getItem(HANDS_FREE_LS_KEY) === '1');
  useEffect(() => {
    localStorage.setItem(HANDS_FREE_LS_KEY, handsFreeOn ? '1' : '0');
  }, [handsFreeOn]);
  const { armed } = useWakeWord({
    enabled: handsFreeOn && connected,
    config: voiceConfig?.wakeWord,
    onWake: startTalk,
    onSilence: stopTalk,
  });

  // B5: a table row (list_beamline_devices, tagged pv_prefix/widget_type
  // server-side - see ContentTableBlock's embeddable check) embeds/
  // un-embeds that device's live widget inline, purely client-side.
  const handleRowClick = (row) => {
    toggleEmbed(row.device_id, row.widget_type, row.pv_prefix, row.cells?.name || row.device_id);
  };

  // Safety net: releasing the mouse outside the FAB must still stop the mic.
  useEffect(() => {
    const onWindowMouseUp = () => stopTalk();
    const onWindowTouchEnd = () => stopTalk();
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('touchend', onWindowTouchEnd);
    return () => {
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('touchend', onWindowTouchEnd);
    };
  }, [stopTalk]);

  return (
    <div ref={panelRef} className={`console-panel voice-console ${detached ? 'console-detached' : ''}`}>
      <div className="console-header" onMouseDown={onHeaderMouseDown}>
        <span className="console-title">
          🎙 Voice Assistant
          <span className={`console-conn ${connected ? 'on' : 'off'}`} />
        </span>
        <div className="console-actions">
          {connectionStatus === 'error' && (
            <button className="console-btn" onClick={connect} title="Riconnetti">↻</button>
          )}
          {voiceConfig?.wakeWord?.accessKey && (
            <button
              className={`console-btn ${handsFreeOn ? 'console-btn--on' : ''}`}
              onClick={() => setHandsFreeOn((v) => !v)}
              title="Ascolto continuo (wake word)"
            >
              🎧
            </button>
          )}
          {!detached && (
            <button className="console-btn" onClick={onDetach} title="Pop out">⧉</button>
          )}
          <button className="console-btn" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      {pendingConfirm && (
        <ConfirmationBanner
          action={pendingConfirm}
          onConfirm={(actionId) => respondConfirm(actionId, true)}
          onCancel={(actionId) => respondConfirm(actionId, false)}
        />
      )}

      <div className="console-body voice-console-body">
        <ChatFeed entries={feedEntries} partial={partialTranscript} client={pvwsClient} onRowClick={handleRowClick} />
      </div>

      {voiceConfig?.debug && (
        <DebugPhasePanel recentTurns={recentTurns} liveDurationMs={liveDurationMs} visualPhase={visualPhase} />
      )}

      <div className="voice-console-footer">
        <span className="voice-state-label">{visualPhaseToLabel(visualPhase)}</span>
        <TextPrompt connected={connected} busy={['listening', 'thinking', 'speaking'].includes(state)} onSubmit={sendText} />
        <VoiceOrb
          visualPhase={visualPhase}
          connected={connected}
          armed={armed}
          onPressStart={startTalk}
          onPressEnd={stopTalk}
        />
      </div>
    </div>
  );
}
