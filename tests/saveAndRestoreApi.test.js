import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSaveAndRestoreUrl, setSaveAndRestoreUrl, getSaveAndRestoreUrl,
  searchNodes, getNode, getChildren, getConfiguration, getSnapshotItems,
  createFolder, updateNode, deleteNodes, createConfiguration, updateConfiguration,
  takeSnapshot, updateSnapshot,
  login, logoutSaveAndRestore, isSaveAndRestoreLoggedIn, getSaveAndRestoreUser,
  vTypeNumber, vTypeLabel, vTypeText, withVTypeValue, snapshotToMagnetRows,
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

describe('vTypeText / withVTypeValue', () => {
  it('prefers the number, then the label, then a placeholder', () => {
    expect(vTypeText({ value: 12.5 })).toBe('12.5');
    expect(vTypeText({ value: 'standby' })).toBe('STANDBY');
    expect(vTypeText({ value: null })).toBe('---');
  });

  it('replaces a numeric value, keeping type/alarm/time/display untouched', () => {
    const original = { type: { name: 'VDouble' }, value: 10, alarm: { severity: 'NONE' }, display: { units: 'A' } };
    const edited = withVTypeValue(original, '12.5');
    expect(edited).toEqual({ ...original, value: 12.5 });
    expect(original.value).toBe(10); // not mutated
  });

  it('replaces a string value when the text is not a number', () => {
    expect(withVTypeValue({ value: 'ON' }, 'OFF')).toEqual({ value: 'OFF' });
  });

  it('treats a blank edit as the literal empty string, not 0', () => {
    expect(withVTypeValue({ value: 1 }, '')).toEqual({ value: '' });
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

describe('REST calls (no window: proxyUrl is a no-op, so this exercises the raw upstream URL)', () => {
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

// The service sends no CORS headers and rejects the browser's preflight outright, so every
// request goes through a proxy: the Vite dev server's /__proxy/ middleware in dev, or the
// dashboard's own k8s-backend in production. Both paths are exercised explicitly here, since
// vitest's default import.meta.env.DEV (true) and lack of a `window` would otherwise silently
// select neither (see the describe block above).
describe('transport routing (dev proxy vs. production backend proxy)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    setSaveAndRestoreUrl(null);
  });

  const stubFetch = (body = { nodes: [] }) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('dev + localhost: rewrites through the Vite /__proxy/ middleware', async () => {
    vi.stubEnv('DEV', true);
    vi.stubGlobal('window', { location: { hostname: 'localhost', protocol: 'http:', search: '' } });
    setSaveAndRestoreUrl('https://btf-saveandrestore.k8sda.lnf.infn.it/save-restore');
    const fetchMock = stubFetch();

    await searchNodes('*');

    expect(fetchMock.mock.calls[0][0]).toBe('/__proxy/btf-saveandrestore.k8sda.lnf.infn.it/save-restore/search?name=*');
  });

  it('production: routes through the k8s-backend saveandrestore-proxy endpoint', async () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('window', {
      location: { hostname: 'btf-dashboard.k8sda.lnf.infn.it', protocol: 'https:', search: '' },
    });
    setSaveAndRestoreUrl('https://btf-saveandrestore.k8sda.lnf.infn.it/save-restore');
    const fetchMock = stubFetch();

    await searchNodes('*');

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl.startsWith('https://btf-backend.k8sda.lnf.infn.it/api/v1/saveandrestore-proxy?url=')).toBe(true);
    expect(decodeURIComponent(calledUrl.split('?url=')[1]))
      .toBe('https://btf-saveandrestore.k8sda.lnf.infn.it/save-restore/search?name=*');
  });

  it('production without a resolvable backend: falls back to a direct fetch', async () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('window', { location: { hostname: 'example.org', protocol: 'https:', search: '' } });
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    const fetchMock = stubFetch();

    await searchNodes('*');

    expect(fetchMock.mock.calls[0][0]).toBe('https://sar.example/save-restore/search?name=*');
  });
});

describe('write endpoints', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setSaveAndRestoreUrl(null);
    logoutSaveAndRestore();
  });

  const stubFetch = (body = {}) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const call = (mock, i = 0) => mock.mock.calls[i];

  it('createFolder POSTs a FOLDER node to /node?parentNodeId=<id>', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    const fetchMock = stubFetch({ uniqueId: 'new', name: 'BTF_CONF', nodeType: 'FOLDER' });

    await createFolder('root-id', 'BTF_CONF', 'desc');

    const [url, init] = call(fetchMock);
    expect(url).toBe('https://sar.example/save-restore/node?parentNodeId=root-id');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'BTF_CONF', nodeType: 'FOLDER', description: 'desc' });
  });

  it('updateNode POSTs the given node to /node (rename)', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    const fetchMock = stubFetch({ uniqueId: 'x', name: 'renamed' });

    await updateNode({ uniqueId: 'x', name: 'renamed', nodeType: 'FOLDER' });

    const [url, init] = call(fetchMock);
    expect(url).toBe('https://sar.example/save-restore/node');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ uniqueId: 'x', name: 'renamed', nodeType: 'FOLDER' });
  });

  it('deleteNodes DELETEs the array of ids to /node', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    const fetchMock = stubFetch(null);

    await deleteNodes(['a', 'b']);

    const [url, init] = call(fetchMock);
    expect(url).toBe('https://sar.example/save-restore/node');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual(['a', 'b']);
  });

  it('createConfiguration PUTs a Configuration to /config?parentNodeId=<id>', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    const fetchMock = stubFetch({ configurationNode: { uniqueId: 'c' } });
    const pvList = [{ pvName: 'A:B:CURRENT_SP', readbackPvName: 'A:B:CURRENT_RB' }];

    await createConfiguration('folder-id', 'MAGNET_SP', 'desc', pvList);

    const [url, init] = call(fetchMock);
    expect(url).toBe('https://sar.example/save-restore/config?parentNodeId=folder-id');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      configurationNode: { name: 'MAGNET_SP', nodeType: 'CONFIGURATION', description: 'desc' },
      configurationData: { pvList },
    });
  });

  it('updateConfiguration POSTs the node and new PV list to /config', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    const fetchMock = stubFetch({});
    const node = { uniqueId: 'c', name: 'MAGNET_SP', nodeType: 'CONFIGURATION' };
    const pvList = [{ pvName: 'A:B:CURRENT_SP' }];

    await updateConfiguration(node, pvList);

    const [url, init] = call(fetchMock);
    expect(url).toBe('https://sar.example/save-restore/config');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ configurationNode: node, configurationData: { pvList } });
  });

  it('takeSnapshot PUTs to /take-snapshot/{configId} with name and optional comment', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    let fetchMock = stubFetch({ snapshotNode: { name: 'snap1' } });
    await takeSnapshot('cfg-id', 'snap1');
    expect(call(fetchMock)[0]).toBe('https://sar.example/save-restore/take-snapshot/cfg-id?name=snap1');
    expect(call(fetchMock)[1].method).toBe('PUT');

    fetchMock = stubFetch({ snapshotNode: { name: 'snap2' } });
    await takeSnapshot('cfg-id', 'snap2', 'before ramp');
    expect(call(fetchMock)[0]).toBe('https://sar.example/save-restore/take-snapshot/cfg-id?name=snap2&comment=before+ramp');
  });

  it('updateSnapshot POSTs the node and edited items to /snapshot', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    const fetchMock = stubFetch({});
    const node = { uniqueId: 's', name: 'snap1', nodeType: 'SNAPSHOT' };
    const items = [{ configPv: { pvName: 'A:B:CURRENT_SP' }, value: { value: 5 } }];

    await updateSnapshot(node, items);

    const [url, init] = call(fetchMock);
    expect(url).toBe('https://sar.example/save-restore/snapshot');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ snapshotNode: node, snapshotData: { snapshotItems: items } });
  });

  it('sends the operator Authorization header on a write once logged in', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    stubFetch({ userName: 'epics', roles: ['sar-user'] });
    await login('epics', 'secret');

    const fetchMock = stubFetch({ uniqueId: 'x' });
    await createFolder('root', 'F');

    expect(call(fetchMock)[1].headers.Authorization).toBe(`Basic ${btoa('epics:secret')}`);
  });

  it('sends no Authorization header on a read/write before logging in', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    const fetchMock = stubFetch({ nodes: [] });
    await searchNodes('*');
    expect(call(fetchMock)[1].headers.Authorization).toBeUndefined();
  });

  it('reports a distinct message for a rejected write vs. a read that needed a login', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');

    const unauthorized = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '' });
    vi.stubGlobal('fetch', unauthorized);
    await expect(createFolder('root', 'F')).rejects.toThrow('login required');

    // A successful login, then a write this account turns out not to have rights for.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify({ userName: 'epics' }),
    }));
    await login('epics', 'secret');
    vi.stubGlobal('fetch', unauthorized);
    await expect(createFolder('root', 'F')).rejects.toThrow('login rejected');
  });
});

describe('login / session', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setSaveAndRestoreUrl(null);
    logoutSaveAndRestore();
  });

  it('is logged out by default', () => {
    expect(isSaveAndRestoreLoggedIn()).toBe(false);
    expect(getSaveAndRestoreUser()).toBeNull();
  });

  it('login() POSTs Basic-authenticated /login and, on success, is remembered', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify({ userName: 'epics', roles: ['sar-user'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = await login('epics', 'secret');

    expect(user).toEqual({ userName: 'epics', roles: ['sar-user'] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sar.example/save-restore/login');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${btoa('epics:secret')}`);
    expect(isSaveAndRestoreLoggedIn()).toBe(true);
    expect(getSaveAndRestoreUser()).toBe('epics');
  });

  it('does not remember a rejected login', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '' }));

    await expect(login('epics', 'wrong')).rejects.toThrow();
    expect(isSaveAndRestoreLoggedIn()).toBe(false);
  });

  it('logoutSaveAndRestore() forgets the login', async () => {
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify({ userName: 'epics' }),
    }));
    await login('epics', 'secret');

    logoutSaveAndRestore();

    expect(isSaveAndRestoreLoggedIn()).toBe(false);
    expect(getSaveAndRestoreUser()).toBeNull();
  });

  it('persists the login to sessionStorage so it survives this tab reloading', async () => {
    const store = {};
    vi.stubGlobal('sessionStorage', {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    });
    setSaveAndRestoreUrl('https://sar.example/save-restore');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify({ userName: 'epics' }),
    }));

    await login('epics', 'secret');

    expect(JSON.parse(store['epik8s-saveandrestore-auth'])).toEqual({
      username: 'epics', basic: `Basic ${btoa('epics:secret')}`,
    });

    logoutSaveAndRestore();
    expect(store['epik8s-saveandrestore-auth']).toBeUndefined();
  });
});
