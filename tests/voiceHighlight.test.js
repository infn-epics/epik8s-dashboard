import { describe, it, expect } from 'vitest';
import { upsertHighlight, pruneExpired, DEFAULT_HIGHLIGHT_TTL_MS } from '../src/voice/events.js';

describe('upsertHighlight', () => {
  it('adds a new entry with the default TTL when ttl_ms is absent', () => {
    const now = 1_000_000;
    const list = upsertHighlight([], { device_id: 'IOC1:MOT01', reason: 'x' }, now);
    expect(list).toHaveLength(1);
    expect(list[0].expiresAt).toBe(now + DEFAULT_HIGHLIGHT_TTL_MS);
  });

  it('honors an explicit ttl_ms', () => {
    const now = 1_000_000;
    const list = upsertHighlight([], { device_id: 'IOC1:MOT01', ttl_ms: 2000 }, now);
    expect(list[0].expiresAt).toBe(now + 2000);
  });

  it('replaces (not duplicates) an existing entry for the same device', () => {
    const now = 1_000_000;
    let list = upsertHighlight([], { device_id: 'IOC1:MOT01' }, now);
    list = upsertHighlight(list, { device_id: 'IOC1:MOT01', reason: 'updated' }, now + 500);
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe('updated');
  });

  it('keeps unrelated entries untouched', () => {
    const now = 1_000_000;
    let list = upsertHighlight([], { device_id: 'IOC1:MOT01' }, now);
    list = upsertHighlight(list, { device_id: 'IOC1:MOT02' }, now);
    expect(list.map((h) => h.deviceId).sort()).toEqual(['IOC1:MOT01', 'IOC1:MOT02']);
  });
});

describe('pruneExpired', () => {
  it('drops entries whose expiresAt has passed', () => {
    const list = [
      { deviceId: 'A', expiresAt: 1000 },
      { deviceId: 'B', expiresAt: 5000 },
    ];
    expect(pruneExpired(list, 2000).map((h) => h.deviceId)).toEqual(['B']);
  });

  it('keeps entries expiring exactly at "now" excluded (strict future only)', () => {
    const list = [{ deviceId: 'A', expiresAt: 2000 }];
    expect(pruneExpired(list, 2000)).toHaveLength(0);
    expect(pruneExpired(list, 1999)).toHaveLength(1);
  });
});
