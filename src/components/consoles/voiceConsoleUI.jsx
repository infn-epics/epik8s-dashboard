/**
 * Presentational-only pieces of the voice console: no hooks, no side
 * effects, state passed entirely via props. Kept separate from
 * VoiceConsole.jsx so they're testable with react-dom/server's
 * renderToStaticMarkup (see tests/voiceConsoleUI.test.jsx), matching the
 * repo's testing convention (no React Testing Library, see
 * tests/cameraWidget.test.jsx).
 */

import { useState } from 'react';

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
  error: 'Nessuna risposta',
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

// Jarvis-like animated indicator states: finer-grained than VoiceFabButton's
// 5-state machine (splits "thinking" into stt/llm/tts) so the animation can
// show what's actually happening while masking perceived latency - see
// useVoicePhase.js for how visualPhase is derived.
const PHASE_ICON = {
  idle: '🎙',
  listening: '🔴',
  stt: '👂',
  llm: '🧠',
  tts: '🔊',
  error: '⚠',
};

const PHASE_LABEL = {
  idle: 'Pronto',
  listening: 'In ascolto…',
  stt: 'Trascrizione…',
  llm: 'Elaborazione…',
  tts: 'Risposta…',
  error: 'Nessuna risposta',
};

export function visualPhaseToIcon(visualPhase) {
  return PHASE_ICON[visualPhase] || PHASE_ICON.idle;
}

export function visualPhaseToLabel(visualPhase) {
  return PHASE_LABEL[visualPhase] || PHASE_LABEL.idle;
}

/**
 * Press-and-hold mic control, same prop contract/event wiring as
 * VoiceFabButton plus a visualPhase prop for the finer-grained animation -
 * a drop-in replacement at call sites, see useVoicePhase.js.
 *
 * `armed` (hands-free wake-word mode, see src/hooks/useWakeWord.js) is
 * orthogonal to visualPhase - it only changes anything while idle (once a
 * turn starts, whether triggered by press-and-hold or the wake word,
 * visualPhase's own stt/llm/tts states take over identically either way)
 * - so it's handled here as a presentational override rather than a new
 * visualPhase value.
 */
export function VoiceOrb({ visualPhase, connected, disabled, armed, onPressStart, onPressEnd }) {
  const showArmed = armed && visualPhase === 'idle';
  const icon = showArmed ? '🎧' : visualPhaseToIcon(visualPhase);
  const label = showArmed ? 'In ascolto (wake word)' : visualPhaseToLabel(visualPhase);
  return (
    <button
      className={`voice-orb voice-orb--${visualPhase} ${showArmed ? 'voice-orb--armed' : ''} ${!connected ? 'voice-orb--offline' : ''}`}
      disabled={disabled || !connected}
      title={connected ? label : 'Voice assistant disconnesso'}
      onMouseDown={onPressStart}
      onMouseUp={onPressEnd}
      onMouseLeave={onPressEnd}
      onTouchStart={onPressStart}
      onTouchEnd={onPressEnd}
    >
      <span className="voice-orb-ring" />
      <span className="voice-orb-icon">{icon}</span>
    </button>
  );
}

/** Compact typed-input companion to the push-to-talk control. */
export function TextPrompt({ connected, busy, onSubmit }) {
  const [text, setText] = useState('');
  const disabled = !connected || busy;

  const submit = (event) => {
    event.preventDefault();
    if (onSubmit(text)) setText('');
  };

  return (
    <form className="voice-text-form" onSubmit={submit}>
      <input
        className="voice-text-input"
        value={text}
        maxLength={4000}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        placeholder={connected ? 'Scrivi una richiesta…' : 'Assistente non connesso'}
        aria-label="Richiesta testuale ad ARGUS"
      />
      <button className="voice-text-send" type="submit" disabled={disabled || !text.trim()} title="Invia richiesta">
        Invia
      </button>
    </form>
  );
}

function formatMs(ms) {
  return ms === null || ms === undefined ? '…' : `${Math.round(ms)} ms`;
}

/**
 * Debug-mode latency table: per-phase and round-trip ms for recent turns,
 * plus the in-progress turn's live elapsed time. Gated behind ?voiceDebug=1
 * at the call site (see AppContext.jsx's buildVoiceConfig).
 */
export function DebugPhasePanel({ recentTurns, liveDurationMs, visualPhase }) {
  const hasLive = liveDurationMs !== null && liveDurationMs !== undefined;
  return (
    <div className="voice-debug-panel">
      {hasLive && (
        <div className="voice-debug-live">
          {visualPhaseToLabel(visualPhase)} <strong>{formatMs(liveDurationMs)}</strong>
        </div>
      )}
      {recentTurns.length === 0 ? (
        <div className="console-empty">Nessun turno registrato</div>
      ) : (
        <table className="voice-debug-table">
          <thead>
            <tr>
              <th>STT</th>
              <th>LLM</th>
              <th>TTS</th>
              <th>Totale</th>
            </tr>
          </thead>
          <tbody>
            {recentTurns.map((turn) => (
              <tr key={turn.turnId} className="voice-debug-row">
                <td>{formatMs(turn.sttMs)}</td>
                <td>{formatMs(turn.llmMs)}</td>
                <td>{formatMs(turn.ttsMs)}</td>
                <td>{formatMs(turn.roundTripMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * One transcript row - extracted out of TranscriptPanel so ChatFeed
 * (voiceContentUI.jsx) can interleave transcript lines with rich content
 * blocks without duplicating this markup. TranscriptPanel's own output is
 * unchanged (still built from this same function), so its existing tests
 * don't need updating.
 */
export function TranscriptLine({ role, text, partial }) {
  return (
    <div className={`voice-transcript-line voice-transcript-line--${role} ${partial ? 'voice-transcript-line--partial' : ''}`}>
      <span className="voice-transcript-role">{role === 'user' ? 'Tu' : 'Assistente'}</span>
      <span className="voice-transcript-text">{text}</span>
    </div>
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
        <TranscriptLine key={i} role={entry.role} text={entry.text} />
      ))}
      {partial && (
        <TranscriptLine role={partial.role} text={partial.text} partial />
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
