/**
 * Phoebus save-and-restore REST client.
 *
 * Derives the base URL from the beamline config:
 *   https://{namespace}-saveandrestore.{epik8namespace}/save-restore
 *
 * The service organizes data as a tree of Node: FOLDER > CONFIGURATION (a
 * named list of PVs) > SNAPSHOT (values captured for that list).
 *
 * The service sends no Access-Control-Allow-Origin, and its Spring Security
 * filter chain rejects the browser's CORS preflight outright (401/403 on
 * OPTIONS, before any CORS header is added) — so a direct browser fetch is
 * blocked for every method, reads included. Every call here goes through a
 * CORS-free proxy instead: the Vite dev server's `/__proxy/` middleware in
 * dev, or the dashboard's own k8s-backend (`/api/v1/saveandrestore-proxy`)
 * in production — same dual-path pattern as gitProxyFetch in devProxy.js.
 *
 * Reading (search, node, config, snapshot) needs no authentication. Creating,
 * updating or deleting needs the operator's own save-and-restore login (HTTP
 * Basic — see login()); this client never holds or sends any credential of
 * its own.
 *
 * API reference (from this service's own /v3/api-docs):
 *   GET    /search?name=<glob>          flat text search across all nodes
 *   GET    /node/{id}                   one node
 *   GET    /node/{id}/children          a folder's or configuration's children
 *   POST   /node?parentNodeId=<id>      create a folder
 *   POST   /node                        rename/update a node (body carries its uniqueId)
 *   DELETE /node                        delete nodes (body: array of uniqueId)
 *   GET    /config/{id}                 a configuration's PV list
 *   PUT    /config?parentNodeId=<id>    create a configuration
 *   POST   /config                      update a configuration's PV list
 *   GET    /snapshot/{id}               a snapshot's PV list with captured values
 *   POST   /snapshot                    update a snapshot's captured values
 *   PUT    /take-snapshot/{configId}    capture live EPICS values now and save as a new snapshot
 *   POST   /login                       validate a login (HTTP Basic)
 */

import { proxyUrl, deriveBackendUrl } from './devProxy.js';

let _baseUrl = null;

export function buildSaveAndRestoreUrl(config) {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(search);
  const override = params.get('saveandrestore');
  if (override) return override.replace(/\/+$/, '');

  const services = config?.epicsConfiguration?.services || {};
  const sar = services.saveandrestore || {};
  if (sar.url) return sar.url.replace(/\/+$/, '');
  if (sar.host) return `https://${sar.host}/save-restore`;

  const ns = config?.namespace || '';
  const domain = config?.epik8namespace || '';
  if (ns && domain) return `https://${ns}-saveandrestore.${domain}/save-restore`;
  return null;
}

export function setSaveAndRestoreUrl(url) {
  _baseUrl = url;
}

export function getSaveAndRestoreUrl() {
  return _baseUrl;
}

/* ------------------------------------------------------------------ */
/* Operator credentials (HTTP Basic; kept for this browser tab only)   */
/* ------------------------------------------------------------------ */

const CREDENTIALS_KEY = 'epik8s-saveandrestore-auth';
let _credentials = null; // { username, basic: "Basic <base64>" }

function loadStoredCredentials() {
  try {
    const raw = sessionStorage.getItem(CREDENTIALS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Read the once-per-tab stored login eagerly, same as the rest of this module's module-level state.
_credentials = loadStoredCredentials();

export function getSaveAndRestoreUser() {
  return _credentials?.username || null;
}

export function isSaveAndRestoreLoggedIn() {
  return !!_credentials;
}

export function logoutSaveAndRestore() {
  _credentials = null;
  try { sessionStorage.removeItem(CREDENTIALS_KEY); } catch { /* ignore */ }
}

/**
 * Validate a save-and-restore login (HTTP Basic) and, on success, keep it
 * (in-memory + sessionStorage, this tab only) for subsequent writes.
 * Returns the service's UserData ({ userName, roles }).
 */
export async function login(username, password) {
  const basic = `Basic ${btoa(`${username}:${password}`)}`;
  const user = await sarFetch('/login', { method: 'POST', basic, body: {} });
  _credentials = { username, basic };
  try { sessionStorage.setItem(CREDENTIALS_KEY, JSON.stringify(_credentials)); } catch { /* ignore */ }
  return user;
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

async function sarFetch(path, { method = 'GET', body, basic } = {}) {
  if (!_baseUrl) throw new Error('save-and-restore URL not configured');
  const url = `${_baseUrl}${path}`;
  const auth = basic ?? _credentials?.basic;
  const headers = auth ? { Authorization: auth } : {};
  const init = { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) };

  let resp;
  if (Boolean(import.meta?.env?.DEV)) {
    resp = await fetch(proxyUrl(url), init);
  } else {
    const backendUrl = deriveBackendUrl();
    if (backendUrl) {
      resp = await fetch(`${backendUrl}/api/v1/saveandrestore-proxy?url=${encodeURIComponent(url)}`, init);
    } else {
      resp = await fetch(url, init); // last resort: will fail if the service still blocks CORS
    }
  }

  const text = await resp.text();
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(auth ? 'save-and-restore: login rejected' : 'save-and-restore: login required');
    }
    throw new Error(`save-and-restore ${resp.status}: ${text.slice(0, 200) || resp.statusText}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`save-and-restore: invalid JSON response (${text.slice(0, 120)})`);
  }
}

/* ------------------------------------------------------------------ */
/* Reads (no authentication needed)                                    */
/* ------------------------------------------------------------------ */

/** Flat text search across every node (folders, configurations, snapshots). `query` supports `*`. */
export async function searchNodes(query) {
  const q = (query || '').trim() || '*';
  const result = await sarFetch(`/search?name=${encodeURIComponent(q)}`);
  return result?.nodes || [];
}

export function getNode(nodeId) {
  return sarFetch(`/node/${encodeURIComponent(nodeId)}`);
}

export function getChildren(nodeId) {
  return sarFetch(`/node/${encodeURIComponent(nodeId)}/children`);
}

/** A configuration's PV list: [{ pvName, readbackPvName, readOnly }]. */
export async function getConfiguration(nodeId) {
  const data = await sarFetch(`/config/${encodeURIComponent(nodeId)}`);
  return data?.pvList || [];
}

/** A snapshot's captured values: [{ configPv, value, readbackValue }] (VType-shaped values). */
export async function getSnapshotItems(nodeId) {
  const data = await sarFetch(`/snapshot/${encodeURIComponent(nodeId)}`);
  return data?.snapshotItems || [];
}

/* ------------------------------------------------------------------ */
/* Writes (need login())                                               */
/* ------------------------------------------------------------------ */

/** Create a FOLDER under parentNodeId. Returns the new Node. */
export function createFolder(parentNodeId, name, description = '') {
  return sarFetch(`/node?parentNodeId=${encodeURIComponent(parentNodeId)}`, {
    method: 'POST',
    body: { name, nodeType: 'FOLDER', description },
  });
}

/** Rename/redescribe an existing node (any type). Returns the updated Node. */
export function updateNode(node) {
  return sarFetch('/node', { method: 'POST', body: node });
}

/** Delete one or more nodes (folders, configurations or snapshots) by id. */
export function deleteNodes(nodeIds) {
  return sarFetch('/node', { method: 'DELETE', body: nodeIds });
}

/**
 * Create a CONFIGURATION under parentNodeId with the given PV list.
 * pvList: [{ pvName, readbackPvName?, readOnly? }]. Returns the Configuration.
 */
export function createConfiguration(parentNodeId, name, description, pvList) {
  return sarFetch(`/config?parentNodeId=${encodeURIComponent(parentNodeId)}`, {
    method: 'PUT',
    body: {
      configurationNode: { name, nodeType: 'CONFIGURATION', description },
      configurationData: { pvList },
    },
  });
}

/** Update an existing configuration's name/description/PV list. `node` is its current Node. */
export function updateConfiguration(node, pvList) {
  return sarFetch('/config', {
    method: 'POST',
    body: { configurationNode: node, configurationData: { pvList } },
  });
}

/**
 * Capture live EPICS values now (read by the save-and-restore service itself, through its own
 * EPICS connection) and save them as a new SNAPSHOT under the given configuration.
 */
export function takeSnapshot(configNodeId, name, comment = '') {
  const q = new URLSearchParams({ name });
  if (comment) q.set('comment', comment);
  return sarFetch(`/take-snapshot/${encodeURIComponent(configNodeId)}?${q}`, { method: 'PUT' });
}

/** Update an existing snapshot's captured values/metadata. `node` is its current Node. */
export function updateSnapshot(node, snapshotItems) {
  return sarFetch('/snapshot', {
    method: 'POST',
    body: { snapshotNode: node, snapshotData: { snapshotItems } },
  });
}

/* ------------------------------------------------------------------ */
/* VType decoding                                                      */
/* ------------------------------------------------------------------ */

// STATE_RB/STATE_SP mbbi/mbbo labels of the unimag IOC (see unimag-opi/README.md), used only
// as a last resort when a VEnum value carries no display.choices of its own.
const UNIMAG_STATE_LABELS = [
  'OFF', 'ON', 'STANDBY', 'FAULT', 'EXT_INTLK', 'CONN_FAULT', 'SP_NOT_REACHED', 'ST_NOT_REACHED',
];

/** Numeric reading of a VType value, or null. */
export function vTypeNumber(vtype) {
  const v = vtype?.value;
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  return null;
}

/** Upper-case enum/string label of a VType value, or ''. */
export function vTypeLabel(vtype) {
  const v = vtype?.value;
  if (typeof v === 'string') return v.toUpperCase();
  if (typeof v === 'number') {
    const choices = vtype?.display?.choices;
    if (Array.isArray(choices) && choices[v] !== undefined) return String(choices[v]).toUpperCase();
    if (UNIMAG_STATE_LABELS[v] !== undefined) return UNIMAG_STATE_LABELS[v];
    return String(v);
  }
  return '';
}

/** Short text for a VType value, for display in a table cell. */
export function vTypeText(vtype) {
  const n = vTypeNumber(vtype);
  if (n !== null) return String(n);
  const l = vTypeLabel(vtype);
  return l || '---';
}

/**
 * A copy of `vtype` with its numeric or string value replaced, keeping type/alarm/time/display
 * as they were fetched. Used to edit an existing snapshot item without having to construct a
 * VType from scratch (only `takeSnapshot`, backed by the service's own EPICS read, does that).
 */
export function withVTypeValue(vtype, rawText) {
  const n = Number(rawText);
  const value = rawText.trim() !== '' && Number.isFinite(n) ? n : rawText;
  return { ...(vtype || {}), value };
}

/* ------------------------------------------------------------------ */
/* Snapshot -> magnet rows                                             */
/* ------------------------------------------------------------------ */

/**
 * Turn a snapshot's items into the row shape the magnet Restore/Pretune tables
 * use: { base, prefix, name, current, state }. A save-and-restore snapshot may
 * hold only CURRENT_SP, only STATE_SP, or both (BTF for instance keeps them as
 * two separate configurations); rows carry whichever side is present, with
 * current/state left null/'' otherwise so the caller can tell "no value" apart
 * from "0" or "OFF". PVs that are neither :CURRENT_SP nor :STATE_SP are skipped.
 */
export function snapshotToMagnetRows(items) {
  const rows = new Map(); // base -> row
  const skipped = [];

  const row = (base) => {
    if (!rows.has(base)) {
      const idx = base.lastIndexOf(':');
      rows.set(base, {
        base,
        prefix: idx < 0 ? '' : base.slice(0, idx),
        name: idx < 0 ? base : base.slice(idx + 1),
        current: null,
        state: '',
      });
    }
    return rows.get(base);
  };

  for (const item of items || []) {
    const pvName = item?.configPv?.pvName || '';
    if (pvName.endsWith(':CURRENT_SP')) {
      const n = vTypeNumber(item.value);
      row(pvName.slice(0, -':CURRENT_SP'.length)).current = n;
      if (n === null) skipped.push(`${pvName}: no numeric value`);
    } else if (pvName.endsWith(':STATE_SP')) {
      row(pvName.slice(0, -':STATE_SP'.length)).state = vTypeLabel(item.value);
    } else if (pvName) {
      skipped.push(`${pvName}: not a magnet CURRENT_SP/STATE_SP`);
    }
  }

  return { rows: [...rows.values()], skipped };
}
