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
  const isLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1');
  if (!isLocal) return url;
  try {
    const u = new URL(url);
    // Don't proxy requests that are already local
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return url;
    // Rewrite to local proxy path
    return `/__proxy/${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
