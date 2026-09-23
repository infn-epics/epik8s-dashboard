/**
 * Keycloak (OIDC) bearer-token authentication and authorisation for the backend.
 *
 * Off unless OIDC_ISSUER is set, so existing deployments keep working until
 * they are switched over. When on, EVERY /api/v1 route except /healthz needs a
 * valid access token, and each route names the capability role it needs
 * (deny by default: a route without a rule is refused).
 *
 * A request is allowed when the token
 *   - is signed by the issuer's JWKS, unexpired, with iss and aud matching, AND
 *   - carries the capability role (flat `roles` claim, composites expanded by
 *     Keycloak), AND
 *   - lists this backend's beamline in the `beamlines` claim
 *     (platform.admin bypasses the beamline check).
 *
 * Environment:
 *   OIDC_ISSUER      https://keycloak.example/realms/epik8s   (enables auth)
 *   OIDC_AUDIENCE    epik8s-services                          (default)
 *   OIDC_JWKS_URI    override (default <issuer>/protocol/openid-connect/certs)
 *   BEAMLINE         beamline id checked against `beamlines` (default: namespace)
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const CAPABILITY = {
  READ: 'pv.read',
  CONFIG: 'config.edit',
  CONTROL: 'ioc.control',
  TICKET: 'logbook.write',
  ADMIN: 'platform.admin',
};

/** Pure check: does this claim set grant `capability` on `beamline`? */
export function authorize(claims, capability, beamline) {
  const roles = Array.isArray(claims?.roles) ? claims.roles : [];
  if (roles.includes(CAPABILITY.ADMIN)) return { ok: true };
  if (!roles.includes(capability)) return { ok: false, reason: `missing role ${capability}` };
  const beamlines = Array.isArray(claims?.beamlines) ? claims.beamlines : [];
  if (!beamline || !beamlines.includes(beamline)) {
    return { ok: false, reason: `not a member of beamline ${beamline}` };
  }
  return { ok: true };
}

/** Capability a request needs, or null when the route has no rule (=> refuse). */
export function requiredCapability(method, path, query = {}) {
  const m = method.toUpperCase();
  if (path === '/api/v1/git-proxy' || path === '/api/v1/namespace') return CAPABILITY.READ;
  if (path.startsWith('/api/v1/git/')) {
    if (m === 'GET') return CAPABILITY.READ;
    // Operators file tickets (issues); every other Git write is a config change.
    let target = '';
    try { target = new URL(String(query.url || '')).pathname; } catch { /* no/invalid url */ }
    return /\/issues(\/|$)/.test(target) ? CAPABILITY.TICKET : CAPABILITY.CONFIG;
  }
  if (path === '/api/v1/saveandrestore-proxy') return m === 'GET' ? CAPABILITY.READ : CAPABILITY.CONFIG;
  if (path.startsWith('/api/v1/files/')) return CAPABILITY.READ;
  if (path.startsWith('/api/v1/')) {
    // K8s / ArgoCD: reads are monitoring, anything that changes state is IOC control.
    return m === 'GET' ? CAPABILITY.READ : CAPABILITY.CONTROL;
  }
  return null;
}

/** WebSocket paths: pod exec/attach are control, everything else read. */
export function requiredWsCapability(pathname) {
  if (pathname.startsWith('/ws/pods/') && (pathname.endsWith('/exec') || pathname.endsWith('/attach'))) {
    return CAPABILITY.CONTROL;
  }
  return CAPABILITY.READ;
}

export function createAuth({ issuer, audience = 'epik8s-services', jwksUri, beamline, keyResolver } = {}) {
  if (!issuer) return null;
  const jwks = keyResolver || createRemoteJWKSet(new URL(jwksUri || `${issuer.replace(/\/$/, '')}/protocol/openid-connect/certs`));

  async function verify(token) {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    return payload;
  }

  function bearer(req) {
    // X-Epik8s-Token lets a route (save-and-restore) keep its own Authorization header.
    if (req.headers['x-epik8s-token']) return req.headers['x-epik8s-token'];
    const m = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] || '');
    return m ? m[1] : null;
  }

  /** Express middleware. `/healthz` and CORS preflights stay open. */
  function middleware(req, res, next) {
    if (req.method === 'OPTIONS' || req.path === '/healthz') return next();
    const cap = requiredCapability(req.method, req.path, req.query);
    if (!cap) return res.status(403).json({ error: 'No access rule for this route' });
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    verify(token).then(claims => {
      const decision = authorize(claims, cap, beamline);
      if (!decision.ok) return res.status(403).json({ error: `Forbidden: ${decision.reason}` });
      req.user = claims;
      next();
    }).catch(() => res.status(401).json({ error: 'Invalid or expired token' }));
  }

  /** WebSocket upgrade check; browsers cannot set headers, so accept ?access_token=. */
  async function authorizeUpgrade(req, pathname) {
    const url = new URL(req.url, 'http://x');
    const token = bearer(req) || url.searchParams.get('access_token');
    if (!token) return false;
    try {
      const claims = await verify(token);
      return authorize(claims, requiredWsCapability(pathname), beamline).ok;
    } catch {
      return false;
    }
  }

  return { middleware, authorizeUpgrade, verify };
}
