import { describe, it, expect } from 'vitest';
import {
  isHighlightEvent,
  isTranscriptEvent,
  isConfirmRequestEvent,
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
