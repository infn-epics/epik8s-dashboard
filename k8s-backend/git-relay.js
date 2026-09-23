/**
 * Server-side Git access for the dashboard.
 *
 * The backend holds the Git credential (GIT_TOKEN); operators authenticate
 * with Keycloak only and never see or type a PAT. A relay request is refused
 * unless its URL lies under the beamline's OWN repository, so the credential
 * cannot be used against any other project or host.
 */

/** Parse https://host/group/project(.git) or git@host:group/project(.git). */
export function parseGitRepo(giturl) {
  if (!giturl) return null;
  let host;
  let path;
  const ssh = /^git@([^:]+):(.+)$/.exec(giturl);
  if (ssh) {
    [, host, path] = ssh;
  } else {
    try {
      const u = new URL(giturl);
      host = u.hostname;
      path = u.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }
  path = path.replace(/\.git$/, '').replace(/\/+$/, '');
  if (!host || !path) return null;
  return { platform: host === 'github.com' ? 'github' : 'gitlab', host, projectPath: path };
}

/** URL prefixes the token may be used against for this repository. */
export function allowedPrefixes(repo) {
  if (!repo) return [];
  if (repo.platform === 'github') {
    return [
      `https://api.github.com/repos/${repo.projectPath}/`,
      `https://raw.githubusercontent.com/${repo.projectPath}/`,
    ];
  }
  const id = encodeURIComponent(repo.projectPath);
  return [
    `https://${repo.host}/api/v4/projects/${id}/`,
    `https://${repo.host}/${repo.projectPath}/-/`,
  ];
}

/** True when `target` (after URL normalisation, so ../ tricks collapse) is under an allowed prefix. */
export function isAllowedGitUrl(target, prefixes) {
  let href;
  try { href = new URL(target).href; } catch { return false; }
  return prefixes.some(p => href.startsWith(p));
}

export function gitAuthHeaders(repo, token) {
  if (!token) return {};
  return repo.platform === 'github'
    ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' }
    : { 'PRIVATE-TOKEN': token };
}

/**
 * fetch() for Git-host calls. Node 20's built-in fetch ignores HTTPS_PROXY, and
 * the cluster reaches the Git host only through the site proxy, so route via
 * undici's ProxyAgent when one is configured (honouring NO_PROXY).
 */
import { fetch as undiciFetch, ProxyAgent } from 'undici';

let _agent;
function bypass(host, noProxy) {
  return (noProxy || '').split(',').map(s => s.trim()).filter(Boolean).some(p => {
    const d = p.replace(/^\*?\./, '');
    return host === d || host.endsWith(`.${d}`);
  });
}

export function gitHostFetch(url, init = {}, env = process.env) {
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  if (!proxy || bypass(new URL(url).hostname, env.NO_PROXY || env.no_proxy)) return fetch(url, init);
  _agent ||= new ProxyAgent(proxy);
  return undiciFetch(url, { ...init, dispatcher: _agent });
}
