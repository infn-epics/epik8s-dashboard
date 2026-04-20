import { describe, it, expect } from 'vitest';
import { normalizeChannelNameFilter } from '../src/services/channelFinderApi.js';
import { resolveChannelRuntimePv } from '../src/components/views/ChannelBrowserView.jsx';

describe('PVA channel browser handling', () => {
  it('strips protocol prefixes before ChannelFinder name lookups', () => {
    expect(normalizeChannelNameFilter('pva://TEST:PV')).toBe('TEST:PV');
    expect(normalizeChannelNameFilter('ca://TEST:PV')).toBe('TEST:PV');
    expect(normalizeChannelNameFilter('TEST:PV')).toBe('TEST:PV');
  });

  it('uses the PVA prefix when visualizing a PVA channel', () => {
    const channel = {
      name: 'TEST:PV',
      properties: [{ name: 'pvProtocol', value: 'pva' }],
    };
    expect(resolveChannelRuntimePv(channel)).toBe('pva://TEST:PV');
  });
});
