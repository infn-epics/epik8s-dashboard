import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useVoice } from '../../context/VoiceContext.jsx';
import { useVoiceAssistant } from '../../hooks/useVoiceAssistant.js';
import { useVoicePhase } from '../../hooks/useVoicePhase.js';
import { useVoiceContent } from '../../hooks/useVoiceContent.js';
import { useWakeWord } from '../../hooks/useWakeWord.js';
import { buildChatFeed } from '../../voice/events.js';
import { VoiceOrb, TextPrompt, ConfirmationBanner, DebugPhasePanel, visualPhaseToLabel } from '../consoles/voiceConsoleUI.jsx';
import { ChatFeed } from '../consoles/voiceContentUI.jsx';

// Shared with VoiceConsole.jsx by design - see that file's comment.
const HANDS_FREE_LS_KEY = 'epik8s-voice-handsfree';

/**
 * ArgusView — full-page voice interaction with ARGUS, the accelerator
 * control system's voice assistant (Controls → Argus). Reuses the same
 * useVoiceAssistant()/useVoice() hooks and presentational pieces as the
 * floating VoiceConsole FAB (src/components/consoles/) rather than
 * duplicating the push-to-talk/transcript/confirmation logic — this is
 * just a larger, page-level presentation of the same live session.
 */
export default function ArgusView() {
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
        {voiceConfig?.wakeWord?.accessKey && (
          <button
            className={`console-btn ${handsFreeOn ? 'console-btn--on' : ''}`}
            onClick={() => setHandsFreeOn((v) => !v)}
            title="Ascolto continuo (wake word)"
          >
            🎧
          </button>
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
          <ChatFeed entries={feedEntries} partial={partialTranscript} client={pvwsClient} onRowClick={handleRowClick} />
          {voiceConfig?.debug && (
            <DebugPhasePanel recentTurns={recentTurns} liveDurationMs={liveDurationMs} visualPhase={visualPhase} />
          )}
        </div>

        <div className="argus-mic-panel">
          <VoiceOrb
            visualPhase={visualPhase}
            connected={connected}
            armed={armed}
            onPressStart={startTalk}
            onPressEnd={stopTalk}
          />
          <span className="argus-state-label">{visualPhaseToLabel(visualPhase)}</span>
          <TextPrompt connected={connected} busy={state !== 'idle'} onSubmit={sendText} />
          <span className="argus-mic-hint">
            {armed ? 'Di’ "Argus" per parlare' : 'Tieni premuto per parlare'}
          </span>
        </div>
      </div>
    </div>
  );
}
