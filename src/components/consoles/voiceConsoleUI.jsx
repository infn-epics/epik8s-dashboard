/**
 * Presentational-only pieces of the voice console: no hooks, no side
 * effects, state passed entirely via props. Kept separate from
 * VoiceConsole.jsx so they're testable with react-dom/server's
 * renderToStaticMarkup (see tests/voiceConsoleUI.test.jsx), matching the
 * repo's testing convention (no React Testing Library, see
 * tests/cameraWidget.test.jsx).
 */

const STATE_ICON = {
  idle: '🎙',
  listening: '🔴',
  thinking: '⏳',
  speaking: '🔊',
  error: '⚠',
};

const STATE_LABEL = {
  idle: 'Pronto',
  listening: 'In ascolto…',
  thinking: 'Elaborazione…',
  speaking: 'Risposta…',
  error: 'Errore connessione',
};

export function voiceStateToIcon(state) {
  return STATE_ICON[state] || STATE_ICON.idle;
}

export function voiceStateToLabel(state) {
  return STATE_LABEL[state] || STATE_LABEL.idle;
}

/** Press-and-hold mic control. */
export function VoiceFabButton({ state, connected, disabled, onPressStart, onPressEnd }) {
  return (
    <button
      className={`voice-fab-btn voice-fab-btn--${state} ${!connected ? 'voice-fab-btn--offline' : ''}`}
      disabled={disabled || !connected}
      title={connected ? voiceStateToLabel(state) : 'Voice assistant disconnesso'}
      onMouseDown={onPressStart}
      onMouseUp={onPressEnd}
      onMouseLeave={onPressEnd}
      onTouchStart={onPressStart}
      onTouchEnd={onPressEnd}
    >
      <span className="voice-fab-icon">{voiceStateToIcon(state)}</span>
    </button>
  );
}

/** Scrollable, collapsible live transcript panel. */
export function TranscriptPanel({ history, partial }) {
  return (
    <div className="voice-transcript">
      {history.length === 0 && !partial && (
        <div className="console-empty">Nessuna trascrizione</div>
      )}
      {history.map((entry, i) => (
        <div key={i} className={`voice-transcript-line voice-transcript-line--${entry.role}`}>
          <span className="voice-transcript-role">{entry.role === 'user' ? 'Tu' : 'Assistente'}</span>
          <span className="voice-transcript-text">{entry.text}</span>
        </div>
      ))}
      {partial && (
        <div className={`voice-transcript-line voice-transcript-line--${partial.role} voice-transcript-line--partial`}>
          <span className="voice-transcript-role">{partial.role === 'user' ? 'Tu' : 'Assistente'}</span>
          <span className="voice-transcript-text">{partial.text}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Confirmation banner for agent-requested write actions. Never executes
 * anything itself — onConfirm/onCancel are the only side effects, and the
 * caller wires those to sending a confirm_action data-channel event. Real
 * execution stays entirely backend/agent-side.
 */
export function ConfirmationBanner({ action, onConfirm, onCancel }) {
  if (!action) return null;
  return (
    <div className="voice-confirm-banner">
      <span className="voice-confirm-text">{action.label}</span>
      <div className="voice-confirm-actions">
        <button className="voice-confirm-btn voice-confirm-btn--yes" onClick={() => onConfirm(action.action_id)}>
          Conferma
        </button>
        <button className="voice-confirm-btn voice-confirm-btn--no" onClick={() => onCancel(action.action_id)}>
          Annulla
        </button>
      </div>
    </div>
  );
}
