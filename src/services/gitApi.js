/**
 * Git platform API abstraction — supports GitLab and GitHub.
 *
 * Detects platform from the repository URL.  Uses personal access tokens (PAT)
 * for authentication.  Operations:
 *   - getFile: read a file from the repo
 *   - commitFile: create or update a file via a commit
 */

import { proxyUrl } from './devProxy.js';

/**
 * Build a raw (unauthenticated) download URL for a file in a repository.
 * GitLab: https://{host}/{projectPath}/-/raw/{branch}/{filePath}
 * GitHub:  https://raw.githubusercontent.com/{projectPath}/{branch}/{filePath}
 */
function buildRawUrl(repoInfo, filePath, branch) {
  if (repoInfo.platform === 'github') {
    return `https://raw.githubusercontent.com/${repoInfo.projectPath}/${branch}/${filePath}`;
  }
  return `https://${repoInfo.host}/${repoInfo.projectPath}/-/raw/${branch}/${filePath}`;
}

/**
 * Fetch any file from a git repository.
 *
 * Strategy:
 *  1. If a token is provided, try the authenticated git API (supports private repos).
 *  2. Fall back to the public raw URL (works for public repos without a token).
 *
 * @param {Object} repoInfo - { platform, host, projectPath } from parseGitUrl()
 * @param {string} filePath  - repo-relative path, e.g. "deploy/values-softiocs.yaml"
 * @param {string} [branch='main']
 * @param {string|null} [token] - personal access token (optional for public repos)
 * @returns {Promise<string>} file content as a string
 */
export async function fetchFileFromGit(repoInfo, filePath, branch = 'main', token = null) {
  if (!repoInfo) throw new Error('No repository configured');

  if (token) {
    try {
      const { content } = await getFile(repoInfo, filePath, branch, token);
      return content;
    } catch (apiErr) {
      const msg = String(apiErr.message);
      // Auth failures are terminal — don't fall back to raw
      if (msg.includes('401') || msg.includes('403')) throw apiErr;
    }
  }

  // No token provided — try the REST API without authentication.
  // For public repos, the GitLab/GitHub REST API supports CORS from the browser
  // (unlike raw file URLs which have no CORS headers).
  try {
    const { content } = await getFile(repoInfo, filePath, branch, '');
    return content;
  } catch (apiErr) {
    const msg = String(apiErr.message);
    if (msg.includes('401') || msg.includes('403')) {
      throw new Error('Authentication required — please log in with a personal access token');
    }
    throw new Error(`Cannot fetch ${filePath} from repository: ${msg}`);
  }
}

/**
 * Parse a git clone URL into { platform, host, projectPath }.
 * Handles https://host/group/project.git and git@host:group/project.git
 */
export function parseGitUrl(giturl) {
  if (!giturl) return null;

  // HTTPS
  const httpsMatch = giturl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    const host = httpsMatch[1];
    const projectPath = httpsMatch[2];
    const platform = host.includes('github.com') ? 'github' : 'gitlab';
    return { platform, host, projectPath };
  }

  // SSH
  const sshMatch = giturl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const host = sshMatch[1];
    const projectPath = sshMatch[2];
    const platform = host.includes('github.com') ? 'github' : 'gitlab';
    return { platform, host, projectPath };
  }

  return null;
}

/**
 * Read a file from the repository.
 * Returns { content (string), sha (GitHub) | blob_id (GitLab), encoding }.
 */
export async function getFile(repoInfo, filePath, branch, token) {
  if (repoInfo.platform === 'github') {
    return getFileGitHub(repoInfo, filePath, branch, token);
  }
  return getFileGitLab(repoInfo, filePath, branch, token);
}

/**
 * Commit a file (create or update) to the repository.
 * Returns the commit info from the API.
 */
export async function commitFile(repoInfo, filePath, branch, content, commitMessage, token, existingRef) {
  if (!token) {
    throw new Error('Authentication required — please log in with a personal access token');
  }
  if (repoInfo.platform === 'github') {
    return commitFileGitHub(repoInfo, filePath, branch, content, commitMessage, token, existingRef);
  }
  return commitFileGitLab(repoInfo, filePath, branch, content, commitMessage, token, existingRef);
}

/**
 * Commit multiple files in a single commit (or sequential commits for GitHub).
 * @param {Object} repoInfo - parsed git URL info
 * @param {{ path: string, content: string }[]} files - files to commit
 * @param {string} branch
 * @param {string} commitMessage
 * @param {string} token - PAT
 */
export async function commitFiles(repoInfo, files, branch, commitMessage, token) {
  if (!token) {
    throw new Error('Authentication required — please log in with a personal access token');
  }
  if (repoInfo.platform === 'github') {
    return commitFilesGitHub(repoInfo, files, branch, commitMessage, token);
  }
  return commitFilesGitLab(repoInfo, files, branch, commitMessage, token);
}

// ─── GitLab ────────────────────────────────────────────────────────────

async function getFileGitLab({ host, projectPath }, filePath, branch, token) {
  const projectId = encodeURIComponent(projectPath);
  const encodedPath = encodeURIComponent(filePath);
  const url = `https://${host}/api/v4/projects/${projectId}/repository/files/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const headers = {};
  if (token) headers['PRIVATE-TOKEN'] = token;
  const resp = await fetch(proxyUrl(url), { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitLab GET file failed (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  const content = atob(data.content);
  return { content, blob_id: data.blob_id, encoding: data.encoding };
}

async function commitFileGitLab({ host, projectPath }, filePath, branch, content, commitMessage, token) {
  const projectId = encodeURIComponent(projectPath);
  const encodedPath = encodeURIComponent(filePath);
  const url = `https://${host}/api/v4/projects/${projectId}/repository/files/${encodedPath}`;

  // Determine if the file already exists — GitLab requires POST for create, PUT for update
  const checkResp = await fetch(proxyUrl(`${url}?ref=${encodeURIComponent(branch)}`), {
    headers: { 'PRIVATE-TOKEN': token },
  });
  const method = checkResp.ok ? 'PUT' : 'POST';

  const resp = await fetch(proxyUrl(url), {
    method,
    headers: {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      branch,
      content,
      commit_message: commitMessage,
      encoding: 'text',
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitLab commit failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

// ─── GitHub ────────────────────────────────────────────────────────────

async function getFileGitHub({ projectPath }, filePath, branch, token) {
  const url = `https://api.github.com/repos/${projectPath}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(proxyUrl(url), { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub GET file failed (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  const content = atob(data.content.replace(/\n/g, ''));
  return { content, sha: data.sha, encoding: data.encoding };
}

async function commitFileGitHub({ projectPath }, filePath, branch, content, commitMessage, token, existingRef) {
  const url = `https://api.github.com/repos/${projectPath}/contents/${filePath}`;
  const body = {
    message: commitMessage,
    content: btoa(unescape(encodeURIComponent(content))),
    branch,
  };
  // If updating an existing file, we need the sha
  if (existingRef) body.sha = existingRef;

  const resp = await fetch(proxyUrl(url), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub commit failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

// ─── Multi-file commits ────────────────────────────────────────────────

/**
 * GitLab: commit multiple files in a single commit via the Commits API.
 */
async function commitFilesGitLab({ host, projectPath }, files, branch, commitMessage, token) {
  const projectId = encodeURIComponent(projectPath);
  const url = `https://${host}/api/v4/projects/${projectId}/repository/commits`;

  // Build actions array — check each file to decide create vs update
  const actions = [];
  for (const f of files) {
    const encodedPath = encodeURIComponent(f.path);
    const checkUrl = `https://${host}/api/v4/projects/${projectId}/repository/files/${encodedPath}?ref=${encodeURIComponent(branch)}`;
    const checkResp = await fetch(proxyUrl(checkUrl), { headers: { 'PRIVATE-TOKEN': token } });
    actions.push({
      action: checkResp.ok ? 'update' : 'create',
      file_path: f.path,
      content: f.content,
    });
  }

  const resp = await fetch(proxyUrl(url), {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      branch,
      commit_message: commitMessage,
      actions,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitLab multi-file commit failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

/**
 * GitHub: commit files sequentially (GitHub Contents API doesn't support multi-file).
 */
async function commitFilesGitHub(repoInfo, files, branch, commitMessage, token) {
  let lastResult = null;
  for (const f of files) {
    // Check if file exists to get its sha
    let existingSha = null;
    try {
      const existing = await getFileGitHub(repoInfo, f.path, branch, token);
      existingSha = existing.sha;
    } catch { /* file does not exist  */ }
    lastResult = await commitFileGitHub(repoInfo, f.path, branch, f.content, commitMessage, token, existingSha);
  }
  return lastResult;
}
