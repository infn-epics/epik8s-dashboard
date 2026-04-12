/**
 * ChannelFinder REST API client.
 *
 * Derives the base URL from the beamline config:
 *   https://{namespace}-channelfinder.{epik8namespace}/ChannelFinder
 *
 * API reference:
 *   GET /resources/channels/combined?~name=...&~size=N&~from=M&~track_total_hits=true
 *   GET /resources/channels/<name>
 */

import { proxyUrl } from './devProxy.js';

let _baseUrl = null;

/**
 * Build the ChannelFinder URL from config.
 */
export function buildChannelFinderUrl(config) {
  const params = new URLSearchParams(window.location.search);
  const override = params.get('channelfinder');
  if (override) return proxyUrl(override);

  const services = config?.epicsConfiguration?.services || {};
  const cf = services.channelfinder || {};
  if (cf.url) return proxyUrl(cf.url);

  const ns = config?.namespace || '';
  const domain = config?.epik8namespace || '';
  if (ns && domain) {
    return proxyUrl(`https://${ns}-channelfinder.${domain}/ChannelFinder`);
  }
  return null;
}

export function setChannelFinderUrl(url) {
  _baseUrl = url;
}

export function getChannelFinderUrl() {
  return _baseUrl;
}

async function readJsonOrThrow(resp, label) {
  const contentType = resp.headers.get('content-type') || '';
  const text = await resp.text();
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(text);
  } catch {
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || contentType.includes('text/html')) {
      throw new Error(`${label}: expected JSON but received HTML (check ChannelFinder URL/proxy/authentication)`);
    }
    const preview = trimmed.slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(`${label}: invalid JSON response: ${preview}`);
  }
}

/**
 * Query channels with pagination using the /combined endpoint.
 *
 * @param {Object} filters - { name, iocName, zone, devtype, devgroup, raw }
 * @param {number} page - 0-based page index
 * @param {number} pageSize - results per page
 * @returns {{ totalCount: number, channels: Array }}
 */
export async function searchChannels(filters = {}, page = 0, pageSize = 50) {
  if (!_baseUrl) throw new Error('ChannelFinder URL not configured');

  const params = new URLSearchParams();
  if (filters.name) params.set('~name', filters.name);
  if (filters.iocName) params.set('iocName', filters.iocName);
  if (filters.zone) params.set('zone', filters.zone);
  if (filters.devtype) params.set('devtype', filters.devtype);
  if (filters.devgroup) params.set('devgroup', filters.devgroup);
  if (filters.tag) params.set('~tag', filters.tag);

  // Raw query appended directly (user can specify any key=value pairs)
  if (filters.raw) {
    for (const part of filters.raw.split('&')) {
      const [k, ...rest] = part.split('=');
      if (k) params.set(k.trim(), rest.join('=').trim());
    }
  }

  params.set('~size', String(pageSize));
  params.set('~from', String(page * pageSize));
  params.set('~track_total_hits', 'true');

  const resp = await fetch(`${_baseUrl}/resources/channels/combined?${params}`);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ChannelFinder query failed (${resp.status}): ${text}`);
  }
  const data = await readJsonOrThrow(resp, 'ChannelFinder query failed');
  return {
    totalCount: data.count ?? data.totalCount ?? 0,
    channels: data.channels ?? [],
  };
}

/**
 * Get a single channel by exact name.
 */
export async function getChannel(channelName) {
  if (!_baseUrl) throw new Error('ChannelFinder URL not configured');
  const resp = await fetch(`${_baseUrl}/resources/channels/${encodeURIComponent(channelName)}`);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ChannelFinder channel fetch failed (${resp.status}): ${text}`);
  }
  return readJsonOrThrow(resp, 'ChannelFinder channel fetch failed');
}

/**
 * Find all channels belonging to a given IOC name.
 */
export async function getChannelsByIoc(iocName, page = 0, pageSize = 100) {
  return searchChannels({ iocName }, page, pageSize);
}

/**
 * Find channels by a device name prefix (typically pvPrefix).
 */
export async function getChannelsByPrefix(prefix, page = 0, pageSize = 100) {
  return searchChannels({ name: `${prefix}*` }, page, pageSize);
}
