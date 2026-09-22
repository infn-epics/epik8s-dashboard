/**
 * Phoebus save-and-restore REST client (read-only).
 *
 * Derives the base URL from the beamline config:
 *   https://{namespace}-saveandrestore.{epik8namespace}/save-restore
 *
 * The service organizes data as a tree of Node: FOLDER > CONFIGURATION (a
 * named list of PVs) > SNAPSHOT (values captured for that list). Reading is
 * open (no auth); creating/updating requires a save-and-restore login this
 * client does not perform, so only browsing and loading is supported here.
 *
 * API reference (from this service's own /v3/api-docs):
 *   GET /search?name=<glob>        flat text search across all nodes
 *   GET /node/{id}                 one node
 *   GET /node/{id}/children        a folder's or configuration's children
 *   GET /config/{id}               a configuration's PV list
 *   GET /snapshot/{id}             a snapshot's PV list with captured values
 */

import { proxyUrl } from './devProxy.js';

let _baseUrl = null;

export function buildSaveAndRestoreUrl(config) {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(search);
  const override = params.get('saveandrestore');
  if (override) return proxyUrl(override.replace(/\/+$/, ''));

  const services = config?.epicsConfiguration?.services || {};
  const sar = services.saveandrestore || {};
  if (sar.url) return proxyUrl(sar.url.replace(/\/+$/, ''));
  if (sar.host) return proxyUrl(`https://${sar.host}/save-restore`);

  const ns = config?.namespace || '';
  const domain = config?.epik8namespace || '';
  if (ns && domain) return proxyUrl(`https://${ns}-saveandrestore.${domain}/save-restore`);
  return null;
}

export function setSaveAndRestoreUrl(url) {
  _baseUrl = url;
}

export function getSaveAndRestoreUrl() {
  return _baseUrl;
}

async function getJson(path) {
  if (!_baseUrl) throw new Error('save-and-restore URL not configured');
  const resp = await fetch(`${_baseUrl}${path}`);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`save-and-restore ${resp.status}: ${text.slice(0, 200) || resp.statusText}`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`save-and-restore: invalid JSON response (${text.slice(0, 120)})`);
  }
}

/** Flat text search across every node (folders, configurations, snapshots). `query` supports `*`. */
export async function searchNodes(query) {
  const q = (query || '').trim() || '*';
  const result = await getJson(`/search?name=${encodeURIComponent(q)}`);
  return result?.nodes || [];
}

export function getNode(nodeId) {
  return getJson(`/node/${encodeURIComponent(nodeId)}`);
}

export function getChildren(nodeId) {
  return getJson(`/node/${encodeURIComponent(nodeId)}/children`);
}

/** A configuration's PV list: [{ pvName, readbackPvName, readOnly }]. */
export async function getConfiguration(nodeId) {
  const data = await getJson(`/config/${encodeURIComponent(nodeId)}`);
  return data?.pvList || [];
}

/** A snapshot's captured values: [{ configPv, value, readbackValue }] (VType-shaped values). */
export async function getSnapshotItems(nodeId) {
  const data = await getJson(`/snapshot/${encodeURIComponent(nodeId)}`);
  return data?.snapshotItems || [];
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
