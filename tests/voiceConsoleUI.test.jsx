import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  voiceStateToIcon,
  voiceStateToLabel,
  visualPhaseToIcon,
  visualPhaseToLabel,
  VoiceFabButton,
  VoiceOrb,
  DebugPhasePanel,
  ConfirmationBanner,
  TranscriptPanel,
} from '../src/components/consoles/voiceConsoleUI.jsx';

describe('voice state mapping', () => {
  it('maps every state to a distinct icon and label', () => {
    const states = ['idle', 'listening', 'thinking', 'speaking', 'error'];
    const icons = states.map(voiceStateToIcon);
    const labels = states.map(voiceStateToLabel);
    expect(new Set(icons).size).toBe(states.length);
    expect(new Set(labels).size).toBe(states.length);
  });

  it('falls back to idle for an unknown state', () => {
    expect(voiceStateToIcon('bogus')).toBe(voiceStateToIcon('idle'));
  });
});

describe('VoiceFabButton', () => {
  it('renders the icon for the current state and is enabled when connected', () => {
    const html = renderToStaticMarkup(
      <VoiceFabButton state="listening" connected onPressStart={() => {}} onPressEnd={() => {}} />
    );
    expect(html).toContain(voiceStateToIcon('listening'));
    expect(html).not.toContain('disabled');
    expect(html).toContain('voice-fab-btn--listening');
  });

  it('is disabled when not connected', () => {
    const html = renderToStaticMarkup(
      <VoiceFabButton state="idle" connected={false} onPressStart={() => {}} onPressEnd={() => {}} />
    );
    expect(html).toContain('disabled');
  });
});

describe('visual phase mapping', () => {
  it('maps every phase to a distinct icon and label', () => {
    const phases = ['idle', 'listening', 'stt', 'llm', 'tts', 'error'];
    const icons = phases.map(visualPhaseToIcon);
    const labels = phases.map(visualPhaseToLabel);
    expect(new Set(icons).size).toBe(phases.length);
    expect(new Set(labels).size).toBe(phases.length);
  });

  it('falls back to idle for an unknown phase', () => {
    expect(visualPhaseToIcon('bogus')).toBe(visualPhaseToIcon('idle'));
  });
});

describe('VoiceOrb', () => {
  it('renders a distinct class per visualPhase and is enabled when connected', () => {
    const html = renderToStaticMarkup(
      <VoiceOrb visualPhase="llm" connected onPressStart={() => {}} onPressEnd={() => {}} />
    );
    expect(html).toContain(visualPhaseToIcon('llm'));
    expect(html).not.toContain('disabled');
    expect(html).toContain('voice-orb--llm');
  });

  it('is disabled when not connected', () => {
    const html = renderToStaticMarkup(
      <VoiceOrb visualPhase="idle" connected={false} onPressStart={() => {}} onPressEnd={() => {}} />
    );
    expect(html).toContain('disabled');
  });
});

describe('DebugPhasePanel', () => {
  it('shows an empty state with no recent turns and no live phase', () => {
    const html = renderToStaticMarkup(
      <DebugPhasePanel recentTurns={[]} liveDurationMs={null} visualPhase="idle" />
    );
    expect(html).toContain('Nessun turno registrato');
  });

  it('renders per-phase durations and an in-progress marker for null values', () => {
    const html = renderToStaticMarkup(
      <DebugPhasePanel
        recentTurns={[{ turnId: 't1', sttMs: 150, llmMs: null, ttsMs: 300, roundTripMs: null }]}
        liveDurationMs={420}
        visualPhase="llm"
      />
    );
    expect(html).toContain('150 ms');
    expect(html).toContain('300 ms');
    expect(html).toContain('420 ms');
    expect(html).toContain('…');
  });
});

describe('ConfirmationBanner', () => {
  it('renders nothing when there is no pending action', () => {
    const html = renderToStaticMarkup(
      <ConfirmationBanner action={null} onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(html).toBe('');
  });

  it('renders the action label and Conferma/Annulla buttons', () => {
    const html = renderToStaticMarkup(
      <ConfirmationBanner
        action={{ action_id: 'a1', label: 'Spegnere il magnete Q1?' }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(html).toContain('Spegnere il magnete Q1?');
    expect(html).toContain('Conferma');
    expect(html).toContain('Annulla');
  });
});

describe('TranscriptPanel', () => {
  it('shows an empty state with no history or partial text', () => {
    const html = renderToStaticMarkup(<TranscriptPanel history={[]} partial={null} />);
    expect(html).toContain('Nessuna trascrizione');
  });

  it('renders history entries and the live partial line', () => {
    const html = renderToStaticMarkup(
      <TranscriptPanel
        history={[{ role: 'user', text: 'porta il motore a zero' }]}
        partial={{ role: 'assistant', text: 'sto muovendo…' }}
      />
    );
    expect(html).toContain('porta il motore a zero');
    expect(html).toContain('sto muovendo…');
    expect(html).toContain('voice-transcript-line--partial');
  });
});
