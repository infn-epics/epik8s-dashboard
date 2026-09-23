/**
 * AuthContext — Global authentication state using PAT (Personal Access Token).
 *
 * Provides:
 *  - user: { id, login, name, email, avatarUrl, profileUrl } or null
 *  - token: PAT string or null
 *  - provider: 'github' | 'gitlab' | null (auto-detected from giturl)
 *  - role: 'viewer' | 'operator' | 'admin'
 *  - isAuthenticated: boolean
 *  - login(pat): validate PAT, fetch user info, detect role
 *  - logout(): clear session
 *  - hasRole(requiredRole): check permission level
 *  - repoInfo: parsed git repository info
 */
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  loadSession,
  saveSession,
  clearSession,
  loginWithPat,
  fetchRepoRole,
  hasRole as checkRole,
} from '../services/auth.js';
import { parseGitUrl } from '../services/gitApi.js';
import {
  resolveOidcConfig,
  startLogin,
  completeLoginIfCallback,
  restoreSession,
  refresh as oidcRefresh,
  logout as oidcLogout,
  decodeJwt,
  userFromClaims,
  setAccessToken,
} from '../services/oidc.js';

const AuthContext = createContext(null);

export function AuthProvider({ children, giturl }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [provider, setProvider] = useState(null);
  const [role, setRole] = useState('viewer');
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  const repoInfo = useMemo(() => parseGitUrl(giturl), [giturl]);

  // Keycloak (OIDC) mode replaces the PAT login when an issuer is resolvable.
  const oidcCfg = useMemo(() => resolveOidcConfig({
    search: window.location.search,
    hostname: window.location.hostname,
    env: import.meta.env || {},
  }), []);
  const [refreshToken, setRefreshToken] = useState(null);

  const applyOidcTokens = useCallback((tokens) => {
    const u = userFromClaims(decodeJwt(tokens.accessToken));
    setAccessToken(tokens.accessToken);
    setUser(u);
    setToken(tokens.accessToken);
    setProvider('keycloak');
    setRole(u?.role || 'viewer');
    setRefreshToken(tokens.refreshToken);
  }, []);

  // OIDC: finish a login redirect, or restore the session after a reload.
  useEffect(() => {
    if (!oidcCfg) return undefined;
    let cancelled = false;
    (async () => {
      setAuthLoading(true);
      try {
        const tokens = (await completeLoginIfCallback(oidcCfg)) || (await restoreSession(oidcCfg));
        if (tokens && !cancelled) applyOidcTokens(tokens);
      } catch (err) {
        if (!cancelled) setAuthError(err.message);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [oidcCfg, applyOidcTokens]);

  // OIDC: renew the short-lived access token shortly before it expires.
  useEffect(() => {
    if (!oidcCfg || !refreshToken || !token) return undefined;
    const exp = decodeJwt(token)?.exp;
    const ms = Math.max(((exp || 0) * 1000 - Date.now()) - 30000, 5000);
    const t = setTimeout(async () => {
      try {
        applyOidcTokens(await oidcRefresh(oidcCfg, refreshToken));
      } catch {
        // Session ended (idle/max lifespan or revoked): drop to logged-out.
        setAccessToken(null);
        setUser(null); setToken(null); setProvider(null); setRole('viewer'); setRefreshToken(null);
      }
    }, ms);
    return () => clearTimeout(t);
  }, [oidcCfg, refreshToken, token, applyOidcTokens]);

  // Restore session on mount
  useEffect(() => {
    if (oidcCfg) return;
    const session = loadSession();
    if (session?.token && session?.user) {
      setUser(session.user);
      setToken(session.token);
      setProvider(session.provider);
      setRole(session.role || 'viewer');
    }
  }, []);

  // Refresh role when repoInfo changes and we have a token
  useEffect(() => {
    if (!oidcCfg && token && provider && repoInfo) {
      fetchRepoRole(provider, token, repoInfo)
        .then(r => {
          setRole(r);
          const session = loadSession();
          if (session) {
            saveSession({ ...session, role: r });
          }
        })
        .catch(err => {
          console.warn('[Auth] Failed to refresh repo role:', err);
          setRole('viewer');
        });
    }
  }, [token, provider, repoInfo]);

  const login = useCallback(async (pat) => {
    if (oidcCfg) {
      setAuthError(null);
      await startLogin(oidcCfg);
      return;
    }
    if (!repoInfo) {
      setAuthError('No repository configured (giturl missing)');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const result = await loginWithPat(pat, repoInfo);
      setUser(result.user);
      setToken(result.token);
      setProvider(result.provider);
      setRole(result.role);
      saveSession({
        provider: result.provider,
        token: result.token,
        user: result.user,
        role: result.role,
      });
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }, [repoInfo, oidcCfg]);

  const logout = useCallback(() => {
    if (oidcCfg) {
      setAccessToken(null);
      oidcLogout(oidcCfg);
      return;
    }
    clearSession();
    setUser(null);
    setToken(null);
    setProvider(null);
    setRole('viewer');
    setAuthError(null);
  }, [oidcCfg]);

  const hasRoleFn = useCallback((requiredRole) => {
    return checkRole(role, requiredRole);
  }, [role]);

  const value = useMemo(() => ({
    user,
    token,
    provider,
    role,
    isAuthenticated: !!token && !!user,
    authError,
    authLoading,
    repoInfo,
    oidc: !!oidcCfg,
    login,
    logout,
    hasRole: hasRoleFn,
  }), [user, token, provider, role, authError, authLoading, repoInfo, oidcCfg, login, logout, hasRoleFn]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
