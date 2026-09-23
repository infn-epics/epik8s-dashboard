/**
 * PAT Authentication Service — Personal Access Token based auth for GitHub & GitLab.
 *
 * Flow:
 *  1. User provides a PAT (from GitHub/GitLab settings)
 *  2. App validates the PAT by fetching user info
 *  3. App determines role from repo permissions
 *  4. Session stored in sessionStorage (survives page refresh)
 *
 * The project defaults to the beamline git repository (giturl from config).
 */

const SS_AUTH_SESSION_KEY = 'epik8s-auth-session';

// ─── Session persistence (survives page refresh within tab) ─────────────

export function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SS_AUTH_SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveSession(session) {
  if (session) {
    sessionStorage.setItem(SS_AUTH_SESSION_KEY, JSON.stringify(session));
  } else {
    sessionStorage.removeItem(SS_AUTH_SESSION_KEY);
  }
}

export function clearSession() {
  sessionStorage.removeItem(SS_AUTH_SESSION_KEY);
}

// ─── Build auth headers for the appropriate platform ────────────────────

export function authHeaders(provider, token) {
  if (provider === 'github') {
    return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' };
  }
  // GitLab PAT uses PRIVATE-TOKEN header
  return { 'PRIVATE-TOKEN': token };
}

// ─── Login with PAT ─────────────────────────────────────────────────────

/**
 * Validate a PAT by fetching user information.
 * @param {string} pat - The personal access token
 * @param {object} repoInfo - { platform, host, projectPath }
 * @returns {object} { provider, token, user, role }
 */
export async function loginWithPat(pat, repoInfo) {
  if (!pat?.trim()) throw new Error('Please provide a Personal Access Token');
  if (!repoInfo) throw new Error('No repository configured');

  const provider = repoInfo.platform; // 'github' | 'gitlab'

  // Validate the PAT by fetching user info
  const user = await fetchUserInfo(provider, pat, repoInfo.host);

  // Determine role from repo permissions
  const role = await fetchRepoRole(provider, pat, repoInfo);

  return { provider, token: pat, user, role };
}

// ─── Fetch user info ────────────────────────────────────────────────────

async function fetchUserInfo(provider, token, host) {
  if (provider === 'github') {
    const resp = await fetch('https://api.github.com/user', {
      headers: authHeaders('github', token),
    });
    if (resp.status === 401) throw new Error('Invalid GitHub token — check your PAT');
    if (!resp.ok) throw new Error(`Failed to fetch GitHub user info (${resp.status})`);
    const data = await resp.json();
    return {
      id: data.id,
      login: data.login,
      name: data.name || data.login,
      email: data.email,
      avatarUrl: data.avatar_url,
      profileUrl: data.html_url,
    };
  } else {
    const h = host || 'gitlab.com';
    const resp = await fetch(`https://${h}/api/v4/user`, {
      headers: authHeaders('gitlab', token),
    });
    if (resp.status === 401) throw new Error('Invalid GitLab token — check your PAT');
    if (!resp.ok) throw new Error(`Failed to fetch GitLab user info (${resp.status})`);
    const data = await resp.json();
    return {
      id: data.id,
      login: data.username,
      name: data.name || data.username,
      email: data.email,
      avatarUrl: data.avatar_url,
      profileUrl: data.web_url,
    };
  }
}

// ─── Determine role from repo permissions ───────────────────────────────

export async function fetchRepoRole(provider, token, repoInfo) {
  if (!repoInfo) return 'viewer';

  try {
    if (provider === 'github') {
      const resp = await fetch(`https://api.github.com/repos/${repoInfo.projectPath}`, {
        headers: authHeaders('github', token),
      });
      if (!resp.ok) return 'viewer';
      const data = await resp.json();
      if (data.permissions?.admin) return 'admin';
      if (data.permissions?.push) return 'operator';
      return 'viewer';
    } else {
      const host = repoInfo.host || 'gitlab.com';
      const projectId = encodeURIComponent(repoInfo.projectPath);
      const resp = await fetch(`https://${host}/api/v4/projects/${projectId}`, {
        headers: authHeaders('gitlab', token),
      });
      if (!resp.ok) return 'viewer';
      const data = await resp.json();
      const level = data.permissions?.project_access?.access_level
        || data.permissions?.group_access?.access_level
        || 10;
      if (level >= 40) return 'admin';   // Maintainer or Owner
      if (level >= 30) return 'operator'; // Developer
      return 'viewer';                    // Reporter or Guest
    }
  } catch {
    return 'viewer';
  }
}

// ─── Roles & Permissions ────────────────────────────────────────────────

export const ROLES = {
  viewer: {
    label: 'Viewer',
    description: 'Read-only access to dashboards and monitoring',
    color: '#888',
  },
  operator: {
    label: 'Operator',
    description: 'Control devices, edit dashboards, create tickets',
    color: '#4488ff',
  },
  expert: {
    label: 'Expert',
    description: 'Beamline expert: edit configuration and control IOCs (Keycloak login)',
    color: '#aa44ff',
  },
  admin: {
    label: 'Admin',
    description: 'Full access: edit configuration, manage layouts, administer',
    color: '#ff6600',
  },
};

const ROLE_HIERARCHY = ['viewer', 'operator', 'expert', 'admin'];

/**
 * Check if a role has at least the required level.
 * hasRole('operator', 'viewer') → true
 * hasRole('viewer', 'admin') → false
 */
export function hasRole(userRole, requiredRole) {
  const userLevel = ROLE_HIERARCHY.indexOf(userRole || 'viewer');
  const requiredLevel = ROLE_HIERARCHY.indexOf(requiredRole || 'viewer');
  return userLevel >= requiredLevel;
}
