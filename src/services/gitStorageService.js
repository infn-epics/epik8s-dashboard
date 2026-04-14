/**
 * Git-backed storage service for layouts and dashboards.
 *
 * Persists beamline layouts and dashboard JSON files to the beamline's
 * git repository (GitLab or GitHub) via platform REST APIs.
 *
 * Directory convention:
 *   <repo>/dashboard/layouts/   — beamline layout JSON files
 *   <repo>/dashboard/dashboards/ — dashboard JSON files
 *
 * Uses gitApi.js for all git operations (read, commit).
 * Auth token comes from the AuthContext (PAT-based).
 */

import { parseGitUrl, getFile, commitFile } from './gitApi.js';
import { proxyUrl } from './devProxy.js';

// ─── Path conventions ──────────────────────────────────────────────────

const LAYOUTS_DIR = 'dashboard/layouts';
const DASHBOARDS_DIR = 'dashboard/dashboards';

function layoutPath(name) {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${LAYOUTS_DIR}/${safe}.json`;
}

function dashboardPath(name) {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${DASHBOARDS_DIR}/${safe}.json`;
}

// ─── List files in a directory ─────────────────────────────────────────

async function listDirectory(repoInfo, dirPath, branch, token) {
  if (repoInfo.platform === 'github') {
    return listDirectoryGitHub(repoInfo, dirPath, branch, token);
  }
  return listDirectoryGitLab(repoInfo, dirPath, branch, token);
}

async function listDirectoryGitLab({ host, projectPath }, dirPath, branch, token) {
  const projectId = encodeURIComponent(projectPath);
  const url = `https://${host}/api/v4/projects/${projectId}/repository/tree?path=${encodeURIComponent(dirPath)}&ref=${encodeURIComponent(branch)}&per_page=100`;
  const headers = {};
  if (token) headers['PRIVATE-TOKEN'] = token;
  const resp = await fetch(proxyUrl(url), { headers });
  if (resp.status === 404) return []; // directory doesn't exist yet
  if (!resp.ok) throw new Error(`GitLab list failed (${resp.status})`);
  const items = await resp.json();
  return items
    .filter(i => i.type === 'blob' && i.name.endsWith('.json'))
    .map(i => ({ name: i.name, path: i.path }));
}

async function listDirectoryGitHub({ projectPath }, dirPath, branch, token) {
  const url = `https://api.github.com/repos/${projectPath}/contents/${dirPath}?ref=${encodeURIComponent(branch)}`;
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(proxyUrl(url), { headers });
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`GitHub list failed (${resp.status})`);
  const items = await resp.json();
  if (!Array.isArray(items)) return [];
  return items
    .filter(i => i.type === 'file' && i.name.endsWith('.json'))
    .map(i => ({ name: i.name, path: i.path, sha: i.sha }));
}

// ─── File history (commits) ────────────────────────────────────────────

async function fileHistory(repoInfo, filePath, branch, token, limit = 20) {
  if (repoInfo.platform === 'github') {
    return fileHistoryGitHub(repoInfo, filePath, branch, token, limit);
  }
  return fileHistoryGitLab(repoInfo, filePath, branch, token, limit);
}

async function fileHistoryGitLab({ host, projectPath }, filePath, branch, token, limit) {
  const projectId = encodeURIComponent(projectPath);
  const url = `https://${host}/api/v4/projects/${projectId}/repository/commits?path=${encodeURIComponent(filePath)}&ref_name=${encodeURIComponent(branch)}&per_page=${limit}`;
  const headers = {};
  if (token) headers['PRIVATE-TOKEN'] = token;
  const resp = await fetch(proxyUrl(url), { headers });
  if (!resp.ok) return [];
  const commits = await resp.json();
  return commits.map(c => ({
    sha: c.id,
    message: c.message,
    author: c.author_name,
    date: c.created_at,
  }));
}

async function fileHistoryGitHub({ projectPath }, filePath, branch, token, limit) {
  const url = `https://api.github.com/repos/${projectPath}/commits?path=${encodeURIComponent(filePath)}&sha=${encodeURIComponent(branch)}&per_page=${limit}`;
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(proxyUrl(url), { headers });
  if (!resp.ok) return [];
  const commits = await resp.json();
  return commits.map(c => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.commit.author.name,
    date: c.commit.author.date,
  }));
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Create a gitStorage instance bound to a specific repo + branch + token.
 *
 * Usage:
 *   const gs = createGitStorage(repoInfo, branch, token);
 *   const layouts = await gs.listLayouts();
 *   const data = await gs.loadLayout('sparc-beamline');
 *   await gs.saveLayout('sparc-beamline', jsonData, 'Updated flag positions');
 */
export function createGitStorage(repoInfo, branch, token) {
  if (!repoInfo) throw new Error('No git repository configured');

  return {
    // ─── Layouts ──────────────────────────────────────────────

    /** List all layout files in dashboard/layouts/ */
    async listLayouts() {
      const files = await listDirectory(repoInfo, LAYOUTS_DIR, branch, token);
      return files.map(f => ({
        name: f.name.replace(/\.json$/, ''),
        path: f.path,
        sha: f.sha,
      }));
    },

    /** Load a layout JSON by name. Returns { data, ref } where ref is sha/blob_id for optimistic locking. */
    async loadLayout(name) {
      const path = layoutPath(name);
      const result = await getFile(repoInfo, path, branch, token);
      const data = JSON.parse(result.content);
      return { data, ref: result.sha || result.blob_id, path };
    },

    /** Save a layout. commitMsg is optional. ref is the previous sha/blob_id for conflict detection. */
    async saveLayout(name, data, commitMsg, ref) {
      const path = layoutPath(name);
      const content = JSON.stringify(data, null, 2);
      const message = commitMsg || `Update layout: ${name}`;
      return commitFile(repoInfo, path, branch, content, message, token, ref);
    },

    /** Delete a layout by committing an empty/deletion. (GitLab supports delete via API, GitHub needs the Trees API — for now we'll skip) */

    /** Check if the remote layout has changed since localRef. Returns { conflict, remoteRef, remoteData }. */
    async checkLayoutConflict(name, localRef) {
      try {
        const { data, ref } = await this.loadLayout(name);
        if (!localRef) return { conflict: false, remoteRef: ref, remoteData: data };
        return { conflict: ref !== localRef, remoteRef: ref, remoteData: data };
      } catch {
        // File doesn't exist remotely — no conflict
        return { conflict: false, remoteRef: null, remoteData: null };
      }
    },

    /** Get commit history for a layout file. */
    async layoutHistory(name, limit) {
      return fileHistory(repoInfo, layoutPath(name), branch, token, limit);
    },

    // ─── Dashboards ───────────────────────────────────────────

    /** List all dashboard files in dashboard/dashboards/ */
    async listDashboards() {
      const files = await listDirectory(repoInfo, DASHBOARDS_DIR, branch, token);
      return files.map(f => ({
        name: f.name.replace(/\.json$/, ''),
        path: f.path,
        sha: f.sha,
      }));
    },

    /** Load a dashboard JSON by name. Returns { data, ref }. */
    async loadDashboard(name) {
      const path = dashboardPath(name);
      const result = await getFile(repoInfo, path, branch, token);
      const data = JSON.parse(result.content);
      return { data, ref: result.sha || result.blob_id, path };
    },

    /** Save a dashboard to git. */
    async saveDashboard(name, data, commitMsg, ref) {
      const path = dashboardPath(name);
      const content = JSON.stringify(data, null, 2);
      const message = commitMsg || `Update dashboard: ${name}`;
      return commitFile(repoInfo, path, branch, content, message, token, ref);
    },

    /** Check if the remote dashboard has changed since localRef. Returns { conflict, remoteRef, remoteData }. */
    async checkDashboardConflict(name, localRef) {
      try {
        const { data, ref } = await this.loadDashboard(name);
        if (!localRef) return { conflict: false, remoteRef: ref, remoteData: data };
        return { conflict: ref !== localRef, remoteRef: ref, remoteData: data };
      } catch {
        return { conflict: false, remoteRef: null, remoteData: null };
      }
    },

    /** Get commit history for a dashboard file. */
    async dashboardHistory(name, limit) {
      return fileHistory(repoInfo, dashboardPath(name), branch, token, limit);
    },
  };
}

/**
 * Hook-friendly helper: create a gitStorage from useGitFetch-like params.
 */
export function createGitStorageFromConfig(config, token) {
  const giturl = config?._giturl || config?.giturl;
  if (!giturl) return null;
  const repoInfo = parseGitUrl(giturl);
  if (!repoInfo) return null;
  const branch = config?._gitbranch || config?.gitrev || 'main';
  return createGitStorage(repoInfo, branch, token);
}
