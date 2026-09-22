import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSaveAndRestoreUrl, setSaveAndRestoreUrl, getSaveAndRestoreUrl,
  searchNodes, getNode, getChildren, getConfiguration, getSnapshotItems,
  vTypeNumber, vTypeLabel, snapshotToMagnetRows,
} from '../src/services/saveAndRestoreApi.js';

describe('buildSaveAndRestoreUrl', () => {
  // This suite runs in vitest's default (non-DOM) environment, like the other API tests in this
  // repo (gitApi.test.js): stub a minimal `window` rather than pull in jsdom.
  const withSearch = (search) => vi.stubGlobal('window', { location: { search } });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives the URL from namespace and epik8namespace, with the /save-restore context path', () => {
    withSearch('');
    const url = buildSaveAndRestoreUrl({ namespace: 'btf', epik8namespace: 'k8sda.lnf.infn.it' });
    expect(url).toBe('https://btf-saveandrestore.k8sda.lnf.infn.it/save-restore');
  });

  it('prefers an explicit services.saveandrestore.host', () => {
    withSearch('');
    const url = buildSaveAndRestoreUrl({
      epicsConfiguration: { services: { saveandrestore: { host: 'sar.example.org' } } },
    });
    expect(url).toBe('https://sar.example.org/save-restore');
  });

  it('prefers an explicit services.saveandrestore.url as-is (no path appended)', () => {
    withSearch('');
    const url = buildSaveAndRestoreUrl({
      epicsConfiguration: { services: { saveandrestore: { url: 'https://sar.example.org/custom/' } } },
    });
    expect(url).toBe('https://sar.example.org/custom');
  });

  it('returns null without enough information', () => {
    withSearch('');
    expect(buildSaveAndRestoreUrl({})).toBeNull();
  });

  it('honors the ?saveandrestore= query override', () => {
    withSearch('?saveandrestore=https://override.example/save-restore/');
    expect(buildSaveAndRestoreUrl({ namespace: 'btf', epik8namespace: 'x' }))
      .toBe('https://override.example/save-restore');
  });

  it('works without a window at all (SSR-safe), falling back to null with no config host', () => {
    expect(buildSaveAndRestoreUrl({})).toBeNull();
  });
});

describe('vTypeNumber / vTypeLabel', () => {
  it('reads a numeric VType value', () => {
    expect(vTypeNumber({ type: { name: 'VDouble' }, value: 12.5 })).toBe(12.5);
    expect(vTypeNumber({ value: null })).toBeNull();
    expect(vTypeNumber(undefined)).toBeNull();
  });

  it('reads a string value as an upper-case label', () => {
    expect(vTypeLabel({ value: 'standby' })).toBe('STANDBY');
  });

  it('resolves a VEnum index through display.choices', () => {
    expect(vTypeLabel({ value: 2, display: { choices: ['off', 'on', 'standby'] } })).toBe('STANDBY');
  });

  it('falls back to the unimag STATE_SP/STATE_RB labels when there are no choices', () => {
    expect(vTypeLabel({ value: 1 })).toBe('ON');
    expect(vTypeLabel({ value: 6 })).toBe('SP_NOT_REACHED');
  });

  it('falls back to the raw number when nothing else is known', () => {
    expect(vTypeLabel({ value: 42 })).toBe('42');
  });
});

describe('snapshotToMagnetRows', () => {
  it('splits CURRENT_SP and STATE_SP items into rows, keyed by device base', () => {
    const { rows, skipped } = snapshotToMagnetRows([
      { configPv: { pvName: 'BTF:MAG:EEI:QUATB201:CURRENT_SP' }, value: { value: 12.5 } },
      { configPv: { pvName: 'BTF:MAG:EEI:QUATB201:STATE_SP' }, value: { value: 1 } },
      { configPv: { pvName: 'BTF:MAG:EEI:CHHTB001:STATE_SP' }, value: { value: 'standby' } },
    ]);
    expect(rows).toEqual([
      { base: 'BTF:MAG:EEI:QUATB201', prefix: 'BTF:MAG:EEI', name: 'QUATB201', current: 12.5, state: 'ON' },
      { base: 'BTF:MAG:EEI:CHHTB001', prefix: 'BTF:MAG:EEI', name: 'CHHTB001', current: null, state: 'STANDBY' },
    ]);
    expect(skipped).toEqual([]);
  });

  it('skips PVs that are neither CURRENT_SP nor STATE_SP, and reports them', () => {
    const { rows, skipped } = snapshotToMagnetRows([
      { configPv: { pvName: 'BTF:MAG:EEI:QUATB201:CURRENT_RB' }, value: { value: 12.5 } },
    ]);
    expect(rows).toEqual([]);
    expect(skipped).toEqual(['BTF:MAG:EEI:QUATB201:CURRENT_RB: not a magnet CURRENT_SP/STATE_SP']);
  });

  it('reports a CURRENT_SP item with no numeric value instead of silently dropping the row', () => {
    const { rows, skipped } = snapshotToMagnetRows([
      { configPv: { pvName: 'A:B:C:CURRENT_SP' }, value: { value: null } },
    ]);
    expect(rows).toEqual([{ base: 'A:B:C', prefix: 'A:B', name: 'C', current: null, state: '' }]);
    expect(skipped).toEqual(['A:B:C:CURRENT_SP: no numeric value']);
  });

  it('returns nothing for an empty or missing item list', () => {
    expect(snapshotToMagnetRows([])).toEqual({ rows: [], skipped: [] });
    expect(snapshotToMagnetRows(undefined)).toEqual({ rows: [], skipped: [] });
  });
});

describe('REST calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setSaveAndRestoreUrl(null);
  });

  const stubFetch = (body, ok = true, status = 200) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok, status, statusText: ok ? 'OK' : 'Error',
      text: async () => JSON.stringify(body),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('rejects when the URL has not been configured', async () => {
    setSaveAndRestoreUrl(null);
    await expect(searchNodes('*')).rejects.toThrow('not configured');
  });

  it('searchNodes hits /search?name=<query> and returns the node list', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    const fetchMock = stubFetch({ hitCount: 1, nodes: [{ uniqueId: '1', name: 'BTF_CONF', nodeType: 'FOLDER' }] });
    const nodes = await searchNodes('BTF*');
    expect(fetchMock.mock.calls[0][0]).toBe('https://sar.example/save-restore/search?name=BTF*');
    expect(nodes).toEqual([{ uniqueId: '1', name: 'BTF_CONF', nodeType: 'FOLDER' }]);
  });

  it('defaults the query to "*" when blank', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    const fetchMock = stubFetch({ nodes: [] });
    await searchNodes('   ');
    expect(fetchMock.mock.calls[0][0]).toContain('name=*');
  });

  it('getNode and getChildren hit /node/{id} and /node/{id}/children', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    let fetchMock = stubFetch({ uniqueId: 'x', name: 'n' });
    await getNode('x y');
    expect(fetchMock.mock.calls[0][0]).toBe('https://sar.example/save-restore/node/x%20y');

    fetchMock = stubFetch([]);
    await getChildren('abc');
    expect(fetchMock.mock.calls[0][0]).toBe('https://sar.example/save-restore/node/abc/children');
  });

  it('getConfiguration returns the pvList, defaulting to []', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    stubFetch({ uniqueId: 'c', pvList: [{ pvName: 'A:B:CURRENT_SP' }] });
    expect(await getConfiguration('c')).toEqual([{ pvName: 'A:B:CURRENT_SP' }]);

    stubFetch({ uniqueId: 'c' });
    expect(await getConfiguration('c')).toEqual([]);
  });

  it('getSnapshotItems returns the snapshotItems, defaulting to []', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    stubFetch({ uniqueId: 's', snapshotItems: [{ configPv: { pvName: 'A:B:CURRENT_SP' } }] });
    expect(await getSnapshotItems('s')).toEqual([{ configPv: { pvName: 'A:B:CURRENT_SP' } }]);
  });

  it('throws with the response body on a non-OK status', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    stubFetch({ error: 'nope' }, false, 404);
    await expect(getNode('missing')).rejects.toThrow('save-and-restore 404');
  });

  it('getSaveAndRestoreUrl reflects the last setSaveAndRestoreUrl call', () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    expect(getSaveAndRestoreUrl()).toBe('https://sar.example/save-restore');
  });
});
