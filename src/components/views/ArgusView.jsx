import { useApp } from '../../context/AppContext.jsx';
import { useVoice } from '../../context/VoiceContext.jsx';
import { useVoiceAssistant } from '../../hooks/useVoiceAssistant.js';
import { useVoicePhase } from '../../hooks/useVoicePhase.js';
import { VoiceOrb, TranscriptPanel, ConfirmationBanner, DebugPhasePanel, visualPhaseToLabel } from '../consoles/voiceConsoleUI.jsx';

/**
 * ArgusView — full-page voice interaction with ARGUS, the accelerator
 * control system's voice assistant (Controls → Argus). Reuses the same
 * useVoiceAssistant()/useVoice() hooks and presentational pieces as the
 * floating VoiceConsole FAB (src/components/consoles/) rather than
 * duplicating the push-to-talk/transcript/confirmation logic — this is
 * just a larger, page-level presentation of the same live session.
 */
export default function ArgusView() {
  const { voiceConfig } = useApp();
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
  const { visualPhase, liveDurationMs, recentTurns } = useVoicePhase(state);

  const connected = connectionStatus === 'connected';

  if (!voiceConfig?.enabled) {
    return (
      <div className="argus-view argus-view--disabled">
        <div className="argus-disabled-card">
          <span className="argus-disabled-icon">🎙</span>
          <h2>Argus non abilitato</h2>
          <p>
            L'assistente vocale è disattivato per questo beamline. Abilitalo impostando
            <code> config.epicsConfiguration.services.voiceAssistant.enabled</code> in{' '}
            <code>values.yaml</code>, oppure con <code>?voice=1</code> per test locali.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="argus-view">
      <div className="argus-header">
        <div className="argus-title">
          <span className="argus-title-icon">🎙</span>
          <h1>Argus</h1>
          <span className={`console-conn ${connected ? 'on' : 'off'}`} title={connectionStatus} />
        </div>
        {connectionStatus === 'error' && (
          <button className="argus-reconnect-btn" onClick={connect}>↻ Riconnetti</button>
        )}
      </div>

      {pendingConfirm && (
        <ConfirmationBanner
          action={pendingConfirm}
          onConfirm={(actionId) => respondConfirm(actionId, true)}
          onCancel={(actionId) => respondConfirm(actionId, false)}
        />
      )}

      <div className="argus-body">
        <div className="argus-transcript-panel">
          <TranscriptPanel history={transcriptHistory} partial={partialTranscript} />
          {voiceConfig?.debug && (
            <DebugPhasePanel recentTurns={recentTurns} liveDurationMs={liveDurationMs} visualPhase={visualPhase} />
          )}
        </div>

        <div className="argus-mic-panel">
          <VoiceOrb
            visualPhase={visualPhase}
            connected={connected}
            onPressStart={startTalk}
            onPressEnd={stopTalk}
          />
          <span className="argus-state-label">{visualPhaseToLabel(visualPhase)}</span>
          <span className="argus-mic-hint">Tieni premuto per parlare</span>
        </div>
      </div>
    </div>
  );
}
