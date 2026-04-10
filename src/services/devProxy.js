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
 * If we are in dev mode and `url` points to an external HTTPS (or HTTP)
 * host, rewrite it to `/__proxy/<host>/<path>` so the Vite dev proxy
 * middleware can forward the request.
 */
export function proxyUrl(url) {
  if (!import.meta.env.DEV || !url) return url;
  try {
    const u = new URL(url);
    // Don't proxy local URLs
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return url;
    // Rewrite to local proxy path
    return `/__proxy/${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
