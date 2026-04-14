/**
 * Dev-mode HTTPS proxy helper.
 *
 * When running on localhost (Vite dev server), external HTTPS services
 * use self-signed certificates that browsers reject.  This module rewrites
 * absolute URLs to go through a local Vite middleware that proxies the
 * request with `rejectUnauthorized: false`.
 *
 * In production builds the function is a no-op (returns the URL unchanged).
 *
 * Proxy path format:  /__proxy/<host>/<rest-of-path>
 */

/**
 * If the app is being served from localhost (dev server OR `vite preview`),
 * rewrite external URLs to `/__proxy/<host>/<path>` so the local server's
 * proxy middleware can forward the request with CORS headers.
 *
 * Uses a runtime check (window.location.hostname) so it also activates in
 * production builds served locally, not only in Vite dev mode.
 */
export function proxyUrl(url) {
  if (!url) return url;
  // Only rewrite when the Vite dev server is running (it provides the /__proxy/ middleware).
  // Production builds served locally (e.g. `serve -s dist`) do NOT have the proxy.
  if (!import.meta.env.DEV) return url;
  const isLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1');
  if (!isLocal) return url;
  try {
    const u = new URL(url);
    // Don't proxy requests that are already local
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return url;
    // Rewrite to local proxy path (strip trailing slash to avoid double-slash when path is appended)
    const path = u.pathname.replace(/\/+$/, '');
    return `/__proxy/${u.host}${path}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * Derive the k8s-backend base URL without needing the loaded config.
 *
 * Naming convention:  {ns}-dashboard.{domain}  →  {ns}-backend.{domain}
 *
 * Also respects the ?backend= query param override.
 */
function deriveBackendUrl() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const override = params.get('backend');
  if (override) return override.replace(/\/+$/, '');

  const host = window.location.hostname;
  const dashIdx = host.indexOf('-dashboard.');
  if (dashIdx > -1) {
    const ns = host.slice(0, dashIdx);
    const domain = host.slice(dashIdx + '-dashboard.'.length);
    return `${window.location.protocol}//${ns}-backend.${domain}`;
  }
  return null;
}

/**
 * Fetch a raw file URL in a CORS-safe manner.
 *
 * • Dev:        rewrites to the Vite `/__proxy/` middleware (existing behaviour)
 * • Production: routes through the k8s-backend `/api/v1/git-proxy` endpoint
 *               which fetches server-side without CORS restrictions.
 * • Fallback:   direct browser fetch (works for public repos with CORS headers)
 *
 * @param {string}      rawUrl  Absolute URL of the file to fetch
 * @param {string|null} token   Optional PAT (passed as X-Git-Token header)
 * @returns {Promise<Response>}
 */
export async function gitProxyFetch(rawUrl, token = null) {
  if (import.meta.env.DEV) {
    // Dev server: use the Vite proxy middleware
    const proxied = proxyUrl(rawUrl);
    const headers = {};
    if (token) {
      headers['PRIVATE-TOKEN'] = token;
      headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(proxied, { headers });
  }

  // Production: route through the k8s-backend to avoid browser CORS restrictions
  const backendUrl = deriveBackendUrl();
  if (backendUrl) {
    const endpoint = `${backendUrl}/api/v1/git-proxy?url=${encodeURIComponent(rawUrl)}`;
    const headers = { Accept: 'text/plain, */*' };
    if (token) headers['X-Git-Token'] = token;
    return fetch(endpoint, { headers });
  }

  // Fallback: direct fetch (succeeds only for repos with Access-Control-Allow-Origin)
  const headers = {};
  if (token) {
    headers['PRIVATE-TOKEN'] = token;
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(rawUrl, { headers });
}
