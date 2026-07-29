import { describe, it, expect } from 'vitest';
import { reducePhaseEvent, computeTurnDurations } from '../src/voice/events.js';

function phaseEvent(turnId, phase, edge, ts) {
  return { type: 'phase', turn_id: turnId, phase, edge, ts };
}

describe('reducePhaseEvent', () => {
  it('creates a new turn entry on the first event', () => {
    const turns = reducePhaseEvent([], phaseEvent('t1', 'stt', 'start', 100));
    expect(turns).toHaveLength(1);
    expect(turns[0].turnId).toBe('t1');
    expect(turns[0].phases.stt.start).toBe(100);
  });

  it('records start and end for a simple stt/llm/tts sequence', () => {
    let turns = [];
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'stt', 'start', 100));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'stt', 'end', 200));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'llm', 'start', 200));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'llm', 'end', 500));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'tts', 'start', 500));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'tts', 'end', 700));

    expect(turns).toHaveLength(1);
    expect(turns[0].phases).toEqual({
      stt: { start: 100, end: 200 },
      llm: { start: 200, end: 500 },
      tts: { start: 500, end: 700 },
    });
  });

  it('is idempotent-first-start: a repeated llm start does not reset the clock (tool-call case)', () => {
    let turns = [];
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'llm', 'start', 200));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'llm', 'end', 300));
    // model performs a tool call, generation resumes:
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'llm', 'start', 350));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'llm', 'end', 600));

    expect(turns[0].phases.llm.start).toBe(200);
    expect(turns[0].phases.llm.end).toBe(600);
    expect(computeTurnDurations(turns[0]).llmMs).toBe(400);
  });

  it('keeps separate turns independent', () => {
    let turns = [];
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'stt', 'start', 100));
    turns = reducePhaseEvent(turns, phaseEvent('t2', 'stt', 'start', 900));
    expect(turns.map((t) => t.turnId).sort()).toEqual(['t1', 't2']);
  });

  it('caps the tracked turn list', () => {
    let turns = [];
    for (let i = 0; i < 25; i += 1) {
      turns = reducePhaseEvent(turns, phaseEvent(`t${i}`, 'stt', 'start', i));
    }
    expect(turns).toHaveLength(20);
    expect(turns[0].turnId).toBe('t5');
    expect(turns[turns.length - 1].turnId).toBe('t24');
  });

  it('ignores malformed events, returning the list unchanged', () => {
    const turns = [{ turnId: 't1', phases: { stt: {}, llm: {}, tts: {} } }];
    expect(reducePhaseEvent(turns, { type: 'transcript' })).toBe(turns);
  });
});

describe('computeTurnDurations', () => {
  it('returns null for phases still in flight (no end yet)', () => {
    const turn = reducePhaseEvent([], phaseEvent('t1', 'stt', 'start', 100))[0];
    const durations = computeTurnDurations(turn);
    expect(durations.sttMs).toBeNull();
    expect(durations.llmMs).toBeNull();
    expect(durations.ttsMs).toBeNull();
    expect(durations.roundTripMs).toBeNull();
  });

  it('computes per-phase and round-trip durations for a completed turn', () => {
    let turns = [];
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'stt', 'start', 100));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'stt', 'end', 250));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'llm', 'start', 250));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'llm', 'end', 600));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'tts', 'start', 600));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'tts', 'end', 900));

    const durations = computeTurnDurations(turns[0]);
    expect(durations).toEqual({ sttMs: 150, llmMs: 350, ttsMs: 300, roundTripMs: 800 });
  });

  it('computes round trip even when a middle phase is still open', () => {
    let turns = [];
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'stt', 'start', 100));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'stt', 'end', 250));
    turns = reducePhaseEvent(turns, phaseEvent('t1', 'llm', 'start', 250));

    const durations = computeTurnDurations(turns[0]);
    expect(durations.sttMs).toBe(150);
    expect(durations.llmMs).toBeNull();
    expect(durations.roundTripMs).toBe(150);
  });

  it('handles an entirely empty turn', () => {
    const durations = computeTurnDurations({ turnId: 't1', phases: { stt: {}, llm: {}, tts: {} } });
    expect(durations).toEqual({ sttMs: null, llmMs: null, ttsMs: null, roundTripMs: null });
  });
});
