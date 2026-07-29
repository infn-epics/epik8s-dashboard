import { useEffect } from 'react';
import { useDraggable } from '../../hooks/useDraggable.js';
import { useVoice } from '../../context/VoiceContext.jsx';
import { useVoiceAssistant } from '../../hooks/useVoiceAssistant.js';
import { VoiceFabButton, TranscriptPanel, ConfirmationBanner, voiceStateToLabel } from './voiceConsoleUI.jsx';

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
  const { connectionStatus, connect } = useVoice();
  const {
    state,
    partialTranscript,
    transcriptHistory,
    pendingConfirm,
    startTalk,
    stopTalk,
    respondConfirm,
  } = useVoiceAssistant();
  const { panelRef, onHeaderMouseDown } = useDraggable(detached);

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

  const connected = connectionStatus === 'connected';

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
        <TranscriptPanel history={transcriptHistory} partial={partialTranscript} />
      </div>

      <div className="voice-console-footer">
        <span className="voice-state-label">{voiceStateToLabel(state)}</span>
        <VoiceFabButton
          state={state}
          connected={connected}
          onPressStart={startTalk}
          onPressEnd={stopTalk}
        />
      </div>
    </div>
  );
}
