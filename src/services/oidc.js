/**
 * Keycloak (OIDC) login — Authorization Code flow with PKCE (S256), public
 * client, no secret and no client library.
 *
 * The access token (5 min) is kept in memory only; the refresh token and the
 * PKCE state live in sessionStorage so a page reload keeps the session. Roles
 * and beamlines come from the token claims (`roles`, `beamlines`), which is
 * what the backend authorises on too — the UI only mirrors them.
 */

const SS_KEY = 'epik8s-oidc-session';
const SS_PENDING = 'epik8s-oidc-pending';
const DEFAULT_CLIENT_ID = 'epik8s-dashboard';

// ─── Configuration ──────────────────────────────────────────────────────

/**
 * Where is Keycloak? First match wins:
 *   ?oidc=<issuer>  |  VITE_OIDC_ISSUER  |  config.oidc.issuer  |
 *   convention {ns}-dashboard.{domain} -> https://keycloak.{domain}/realms/epik8s
 * Returns null when none applies (=> legacy PAT login stays in use).
 * `?oidc=off` forces the legacy login.
 */
export function resolveOidcConfig({ search = '', hostname = '', env = {}, config = null } = {}) {
  const params = new URLSearchParams(search);
  const override = params.get('oidc');
  if (override === 'off') return null;
  let issuer = override || env.VITE_OIDC_ISSUER || config?.oidc?.issuer || null;
  if (!issuer) {
    const i = hostname.indexOf('-dashboard.');
    if (i > -1) issuer = `https://keycloak.${hostname.slice(i + '-dashboard.'.length)}/realms/epik8s`;
  }
  if (!issuer) return null;
  return {
    issuer: issuer.replace(/\/+$/, ''),
    clientId: config?.oidc?.clientId || env.VITE_OIDC_CLIENT_ID || DEFAULT_CLIENT_ID,
  };
}

// ─── PKCE ───────────────────────────────────────────────────────────────

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(len = 32) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return b64url(a);
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

// ─── Token helpers ──────────────────────────────────────────────────────

export function decodeJwt(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  } catch {
    return null;
  }
}

/** Map Keycloak capability roles onto the dashboard's viewer/operator/expert/admin levels. */
export function dashboardRole(roles = []) {
  const r = new Set(roles);
  if (r.has('platform.admin')) return 'admin';
  if (r.has('config.edit') || r.has('ioc.control')) return 'expert';
  if (r.has('pv.write')) return 'operator';
  return 'viewer';
}

/** Build the dashboard user from access-token claims. */
export function userFromClaims(claims) {
  if (!claims) return null;
  const roles = Array.isArray(claims.roles) ? claims.roles : [];
  const beamlines = Array.isArray(claims.beamlines) ? claims.beamlines : [];
  return {
    id: claims.sub,
    login: claims.preferred_username || claims.sub,
    name: claims.name || claims.preferred_username || claims.sub,
    email: claims.email || null,
    avatarUrl: null,
    profileUrl: null,
    roles,
    beamlines,
    role: dashboardRole(roles),
  };
}

// ─── Login / callback / refresh / logout ────────────────────────────────

export async function startLogin(cfg, { redirectUri = window.location.origin + window.location.pathname } = {}) {
  const verifier = randomString(48);
  const state = randomString(16);
  sessionStorage.setItem(SS_PENDING, JSON.stringify({ verifier, state, redirectUri }));
  const url = new URL(`${cfg.issuer}/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: redirectUri,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString();
  window.location.assign(url.toString());
}

async function tokenRequest(cfg, body) {
  const resp = await fetch(`${cfg.issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, ...body }).toString(),
  });
  if (!resp.ok) throw new Error(`Token request failed (${resp.status})`);
  const t = await resp.json();
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 300) * 1000 };
}

function persist(tokens) {
  sessionStorage.setItem(SS_KEY, JSON.stringify({ refreshToken: tokens.refreshToken }));
}

/** If the URL carries ?code=&state= from Keycloak, exchange it. Returns tokens or null. */
export async function completeLoginIfCallback(cfg) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return null;
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem(SS_PENDING) || 'null'); } catch { pending = null; }
  sessionStorage.removeItem(SS_PENDING);
  // Always strip the one-time params so a reload never replays the code.
  for (const k of ['code', 'state', 'session_state', 'iss']) params.delete(k);
  const qs = params.toString();
  window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  if (!pending || pending.state !== state) throw new Error('Login state mismatch — please try again');
  const tokens = await tokenRequest(cfg, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  });
  persist(tokens);
  return tokens;
}

/** Restore a session after reload using the stored refresh token. */
export async function restoreSession(cfg) {
  let s;
  try { s = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch { s = null; }
  if (!s?.refreshToken) return null;
  try {
    return await refresh(cfg, s.refreshToken);
  } catch {
    sessionStorage.removeItem(SS_KEY);
    return null;
  }
}

export async function refresh(cfg, refreshToken) {
  const tokens = await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken });
  persist(tokens);
  return tokens;
}

export function logout(cfg, { redirectUri = window.location.origin + window.location.pathname } = {}) {
  sessionStorage.removeItem(SS_KEY);
  const url = new URL(`${cfg.issuer}/protocol/openid-connect/logout`);
  url.search = new URLSearchParams({ client_id: cfg.clientId, post_logout_redirect_uri: redirectUri }).toString();
  window.location.assign(url.toString());
}

// ─── Current access token, for API calls outside React ──────────────────

let currentToken = null;
export function setAccessToken(t) { currentToken = t; }
export function getAccessToken() { return currentToken; }
/** True once an OIDC login is active (git calls then go through the backend). */
export function oidcActive() { return !!currentToken; }
