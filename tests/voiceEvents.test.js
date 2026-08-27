import { describe, it, expect } from 'vitest';
import {
  isHighlightEvent,
  isTranscriptEvent,
  isConfirmRequestEvent,
  isTextInputEvent,
  isPhaseEvent,
  isContentEvent,
  isContentChartEvent,
  isContentTableEvent,
  isContentWidgetEvent,
  buildChatFeed,
  matchDeviceId,
  computeBackoffDelay,
  MAX_RECONNECT_ATTEMPTS,
} from '../src/voice/events.js';

describe('type guards', () => {
  it('accepts a well-formed highlight event', () => {
    expect(isHighlightEvent({ type: 'highlight', device_id: 'IOC1:MOT01', reason: 'x' })).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(isHighlightEvent(null)).toBe(false);
    expect(isHighlightEvent({ type: 'highlight' })).toBe(false);
    expect(isHighlightEvent({ type: 'transcript', device_id: 'x' })).toBe(false);
  });

  it('accepts partial and final transcript events', () => {
    expect(isTranscriptEvent({ type: 'transcript', role: 'user', text: 'hi', final: false })).toBe(true);
    expect(isTranscriptEvent({ type: 'transcript', role: 'assistant', text: 'hi', final: true })).toBe(true);
    expect(isTranscriptEvent({ type: 'transcript', role: 'bot', text: 'hi' })).toBe(false);
  });

  it('accepts a well-formed confirm_request', () => {
    expect(isConfirmRequestEvent({ type: 'confirm_request', action_id: 'a1', label: 'Spegnere Q1?' })).toBe(true);
    expect(isConfirmRequestEvent({ type: 'confirm_request', action_id: '', label: 'x' })).toBe(false);
  });

  it('accepts bounded non-empty text input only', () => {
    expect(isTextInputEvent({ type: 'text_input', text: 'stato BTF' })).toBe(true);
    expect(isTextInputEvent({ type: 'text_input', text: '  ' })).toBe(false);
    expect(isTextInputEvent({ type: 'text_input', text: 'x'.repeat(4001) })).toBe(false);
  });

  it('accepts well-formed phase events', () => {
    expect(isPhaseEvent({ type: 'phase', turn_id: 't1', phase: 'stt', edge: 'start', ts: 1 })).toBe(true);
    expect(isPhaseEvent({ type: 'phase', turn_id: 't1', phase: 'llm', edge: 'end', ts: 2 })).toBe(true);
    expect(isPhaseEvent({ type: 'phase', turn_id: 't1', phase: 'tts', edge: 'start', ts: 3 })).toBe(true);
  });

  it('rejects malformed phase events', () => {
    expect(isPhaseEvent(null)).toBe(false);
    expect(isPhaseEvent({ type: 'phase', turn_id: '', phase: 'stt', edge: 'start' })).toBe(false);
    expect(isPhaseEvent({ type: 'phase', turn_id: 't1', phase: 'unknown', edge: 'start' })).toBe(false);
    expect(isPhaseEvent({ type: 'phase', turn_id: 't1', phase: 'stt', edge: 'unknown' })).toBe(false);
    expect(isPhaseEvent({ type: 'transcript', turn_id: 't1', phase: 'stt', edge: 'start' })).toBe(false);
  });

  it('accepts well-formed content events per kind', () => {
    expect(isContentEvent({ type: 'content', kind: 'table' })).toBe(true);
    expect(isContentEvent({ type: 'content', kind: 'chart' })).toBe(true);
    expect(isContentEvent({ type: 'content', kind: 'widget' })).toBe(true);
    expect(isContentEvent({ type: 'content', kind: 'bogus' })).toBe(false);
    expect(isContentEvent(null)).toBe(false);
  });

  it('narrows content events by kind-specific shape', () => {
    expect(isContentChartEvent({ type: 'content', kind: 'chart', series: [] })).toBe(true);
    expect(isContentChartEvent({ type: 'content', kind: 'chart' })).toBe(false);
    expect(isContentChartEvent({ type: 'content', kind: 'table', series: [] })).toBe(false);

    expect(isContentTableEvent({ type: 'content', kind: 'table', columns: [], rows: [] })).toBe(true);
    expect(isContentTableEvent({ type: 'content', kind: 'table', columns: [] })).toBe(false);

    expect(isContentWidgetEvent({ type: 'content', kind: 'widget', widget_type: 'motor' })).toBe(true);
    expect(isContentWidgetEvent({ type: 'content', kind: 'widget', widget_type: '' })).toBe(false);
  });
});

describe('buildChatFeed', () => {
  it('interleaves transcript and content entries in chronological order', () => {
    const transcript = [
      { role: 'user', text: 'ciao', ts: 100 },
      { role: 'assistant', text: 'risposta', ts: 300 },
    ];
    const content = [{ kind: 'chart', ts: 200, title: 'x' }];
    const feed = buildChatFeed(transcript, content);
    expect(feed.map((e) => e.kind)).toEqual(['transcript', 'content', 'transcript']);
    expect(feed[1].content.title).toBe('x');
  });

  it('breaks ties at equal ts by putting transcript before content, stable order otherwise', () => {
    const transcript = [{ role: 'user', text: 'a', ts: 100 }];
    const content = [{ kind: 'chart', ts: 100, title: 'x' }];
    const feed = buildChatFeed(transcript, content);
    expect(feed.map((e) => e.kind)).toEqual(['transcript', 'content']);
  });

  it('treats a missing ts as 0, not a crash', () => {
    const feed = buildChatFeed([{ role: 'user', text: 'a' }], []);
    expect(feed).toHaveLength(1);
    expect(feed[0].ts).toBe(0);
  });

  it('handles empty inputs', () => {
    expect(buildChatFeed([], [])).toEqual([]);
  });
});

describe('matchDeviceId', () => {
  const widget = { pvPrefix: 'EUAPS:CTRL:FPMMIR:HMOT01', deviceId: 'pollux-ctrl01:HMOT01' };

  it('matches exact deviceId case-insensitively', () => {
    expect(matchDeviceId('POLLUX-CTRL01:HMOT01', widget)).toBe(true);
  });

  it('matches exact pvPrefix', () => {
    expect(matchDeviceId('EUAPS:CTRL:FPMMIR:HMOT01', widget)).toBe(true);
  });

  it('matches a bare prefix sent by the agent', () => {
    expect(matchDeviceId('EUAPS:CTRL:FPMMIR', widget)).toBe(true);
  });

  it('matches after stripping a common EPICS PV suffix', () => {
    expect(matchDeviceId('EUAPS:CTRL:FPMMIR:HMOT01:RBV', widget)).toBe(true);
  });

  it('does not match an unrelated device', () => {
    expect(matchDeviceId('EUAPS:CAM:SIM01', widget)).toBe(false);
  });

  it('is false for empty/missing input', () => {
    expect(matchDeviceId('', widget)).toBe(false);
    expect(matchDeviceId('IOC1:MOT01', null)).toBe(false);
  });
});

describe('computeBackoffDelay', () => {
  it('increases with attempt number and caps at the last step', () => {
    const d0 = computeBackoffDelay(0);
    const d1 = computeBackoffDelay(1);
    expect(d1).toBeGreaterThan(d0);
    expect(computeBackoffDelay(MAX_RECONNECT_ATTEMPTS + 10)).toBe(computeBackoffDelay(MAX_RECONNECT_ATTEMPTS - 1));
  });
});
