import yaml from 'js-yaml';
import { parseDevices } from '../models/device.js';
import { parseGitUrl, fetchFileFromGit } from './gitApi.js';
import { proxyUrl } from './devProxy.js';

const VALUES_YAML_PATH = 'values.yaml';
const GIT_VALUES_CANDIDATES = [VALUES_YAML_PATH, `deploy/${VALUES_YAML_PATH}`];

/**
 * Resolve where to load values.yaml from.
 *
 * Priority (highest to lowest):
 *  1. `?giturl=<url>&gitbranch=<branch>` — load from a git repository
 *     (stored in localStorage so reloads remember it)
 *  2. `?values=<path>` — a directly accessible HTTP path
 *  3. `/values.yaml` served alongside the dashboard
 *
 * Returns { url|null, gitinfo|null, valuesPath|null }
 * so the caller can also store the resolved giturl for later use.
 */
const LS_GITURL_KEY = 'epik8s-giturl';
const LS_GITBRANCH_KEY = 'epik8s-gitbranch';
const LS_GITTOKEN_KEY = 'epik8s-gittoken';

export function saveGitConfig(giturl, gitbranch, token) {
  if (giturl) localStorage.setItem(LS_GITURL_KEY, giturl);
  if (gitbranch) localStorage.setItem(LS_GITBRANCH_KEY, gitbranch);
  if (token) localStorage.setItem(LS_GITTOKEN_KEY, token);
}

export function clearGitConfig() {
  localStorage.removeItem(LS_GITURL_KEY);
  localStorage.removeItem(LS_GITBRANCH_KEY);
  localStorage.removeItem(LS_GITTOKEN_KEY);
}

export function loadStoredGitConfig() {
  return {
    giturl: localStorage.getItem(LS_GITURL_KEY) || '',
    gitbranch: localStorage.getItem(LS_GITBRANCH_KEY) || 'main',
    token: localStorage.getItem(LS_GITTOKEN_KEY) || '',
  };
}

/**
 * Load an epik8s values.yaml and return normalized configuration.
 *
 * @param {string} [valuesPath='/values.yaml'] - HTTP path fallback
 * @param {Object} [opts]
 * @param {string} [opts.giturl]   - beamline git repo URL (takes priority)
 * @param {string} [opts.gitbranch='main']
 * @param {string} [opts.token]    - PAT for private repos
 * @returns {{ devices, cameras, zones, config, pvws, giturl, gitbranch }}
 */
export async function loadConfig(valuesPath = '/values.yaml', opts = {}) {
  let text;
  let resolvedGiturl = opts.giturl || '';
  let resolvedBranch = opts.gitbranch || 'main';

  if (resolvedGiturl) {
    // Load the beamline config from the repository.
    // Some repos keep it at the root as values.yaml, others at deploy/values.yaml.
    const repoInfo = parseGitUrl(resolvedGiturl);
    if (!repoInfo) throw new Error(`Cannot parse git URL: ${resolvedGiturl}`);

    const requestedPath = String(valuesPath || '').replace(/^\/+/, '') || VALUES_YAML_PATH;
    const candidatePaths = [...new Set([requestedPath, ...GIT_VALUES_CANDIDATES])];
    let lastError = null;

    for (const candidate of candidatePaths) {
      try {
        text = await fetchFileFromGit(repoInfo, candidate, resolvedBranch, opts.token || null);
        break;
      } catch (err) {
        lastError = err;
        if (!String(err?.message || '').includes('404')) throw err;
      }
    }

    if (!text && lastError) throw lastError;
  } else {
    const resp = await fetch(proxyUrl(valuesPath));
    if (!resp.ok) throw new Error(`Failed to load ${valuesPath}: ${resp.status}`);
    text = await resp.text();
  }

  const config = yaml.load(text);

  // Expose giturl/gitbranch from the YAML if not provided as opts
  if (!resolvedGiturl && config.giturl) {
    resolvedGiturl = config.giturl;
    resolvedBranch = config.gitrev || 'main';
  }
  // Attach resolved git info so downstream contexts can use it directly
  config._giturl = resolvedGiturl;
  config._gitbranch = resolvedBranch;

  // Extract pvws service config
  const services = config.epicsConfiguration?.services || {};
  let pvwsCfg = services.camarray?.pvws || null;
  if (!pvwsCfg) {
    for (const svc of Object.values(services)) {
      if (svc.pvws?.host) { pvwsCfg = svc.pvws; break; }
    }
  }
  pvwsCfg = pvwsCfg || {};
  const pvws = {
    host: pvwsCfg.host || '',
    port: pvwsCfg.port || 80,
  };

  const devices = parseDevices(config);
  const cameras = devices.filter((d) => d.streamEnabled);
  const configZones = (config.zones || []).map((z) => (typeof z === 'string' ? z : z.name));
  const deviceZones = [...new Set(devices.map((d) => d.zone).filter(Boolean))];
  const zones = configZones.length > 0 ? configZones : deviceZones;

  return { devices, cameras, zones, config, pvws };
}

// Legacy compat
export const loadCamerasFromConfig = loadConfig;
