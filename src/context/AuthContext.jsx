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

const AuthContext = createContext(null);

export function AuthProvider({ children, giturl }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [provider, setProvider] = useState(null);
  const [role, setRole] = useState('viewer');
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  const repoInfo = useMemo(() => parseGitUrl(giturl), [giturl]);

  // Restore session on mount
  useEffect(() => {
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
    if (token && provider && repoInfo) {
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
  }, [repoInfo]);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setToken(null);
    setProvider(null);
    setRole('viewer');
    setAuthError(null);
  }, []);

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
    login,
    logout,
    hasRole: hasRoleFn,
  }), [user, token, provider, role, authError, authLoading, repoInfo, login, logout, hasRoleFn]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
