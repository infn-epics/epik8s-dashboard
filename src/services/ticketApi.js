/**
 * Ticket / Issue API — Create, list, and comment on GitHub/GitLab issues.
 *
 * Uses PAT from AuthContext for all API calls.
 */
import { authHeaders } from './auth.js';
import { gitFetch } from './devProxy.js';

/**
 * Create an issue on the repository.
 * @param {object} repoInfo - { platform, host, projectPath }
 * @param {string} token - OAuth access token
 * @param {object} issue - { title, body, labels? }
 * @returns {object} Created issue data
 */
export async function createIssue(repoInfo, token, issue) {
  if (repoInfo.platform === 'github') {
    return createGitHubIssue(repoInfo, token, issue);
  }
  return createGitLabIssue(repoInfo, token, issue);
}

/**
 * List open issues for the repository.
 * @param {object} repoInfo
 * @param {string} token
 * @param {object} options - { labels?, state?, perPage?, page? }
 */
export async function listIssues(repoInfo, token, options = {}) {
  if (repoInfo.platform === 'github') {
    return listGitHubIssues(repoInfo, token, options);
  }
  return listGitLabIssues(repoInfo, token, options);
}

/**
 * Add a comment to an existing issue.
 * @param {object} repoInfo
 * @param {string} token
 * @param {number|string} issueId
 * @param {string} body
 */
export async function addComment(repoInfo, token, issueId, body) {
  if (repoInfo.platform === 'github') {
    return addGitHubComment(repoInfo, token, issueId, body);
  }
  return addGitLabComment(repoInfo, token, issueId, body);
}

// ─── Predefined labels for beamline issues ──────────────────────────────

export const ISSUE_LABELS = [
  { name: 'device', color: '#4488ff', description: 'Device-related issue' },
  { name: 'service', color: '#ff8800', description: 'Service-related issue' },
  { name: 'beamline', color: '#22c55e', description: 'General beamline issue' },
  { name: 'alarm', color: '#ef4444', description: 'Alarm / urgent issue' },
  { name: 'configuration', color: '#534AB7', description: 'Configuration issue' },
  { name: 'enhancement', color: '#00cccc', description: 'Feature request' },
  { name: 'bug', color: '#dc2626', description: 'Bug report' },
];

/**
 * Build issue body with device/service context.
 */
export function buildIssueBody({ context, description, deviceInfo, serviceInfo, user }) {
  const lines = [];

  if (description) lines.push(description, '');

  if (deviceInfo) {
    lines.push('## Device Information');
    lines.push(`- **Name**: ${deviceInfo.name}`);
    if (deviceInfo.pvPrefix) lines.push(`- **PV Prefix**: ${deviceInfo.pvPrefix}`);
    if (deviceInfo.family) lines.push(`- **Family/Type**: ${deviceInfo.family}`);
    if (deviceInfo.iocName) lines.push(`- **IOC**: ${deviceInfo.iocName}`);
    if (deviceInfo.zone) lines.push(`- **Zone**: ${deviceInfo.zone}`);
    lines.push('');
  }

  if (serviceInfo) {
    lines.push('## Service Information');
    lines.push(`- **Service**: ${serviceInfo.name}`);
    if (serviceInfo.host) lines.push(`- **Host**: ${serviceInfo.host}`);
    if (serviceInfo.type) lines.push(`- **Type**: ${serviceInfo.type}`);
    lines.push('');
  }

  if (context) {
    lines.push('## Context');
    lines.push(context);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Created via EPIK8s Dashboard${user ? ` by ${user.name} (@${user.login})` : ''}*`);

  return lines.join('\n');
}

// ─── File uploads (for issue attachments) ───────────────────────────────

/**
 * Upload a file to the GitLab project for use as an issue attachment.
 * Returns { markdown, url } where markdown is the embed string.
 */
async function uploadFileGitLab({ host, projectPath }, token, file) {
  const projectId = encodeURIComponent(projectPath);
  const url = `https://${host}/api/v4/projects/${projectId}/uploads`;
  const formData = new FormData();
  formData.append('file', file);
  const resp = await gitFetch(url, {
    method: 'POST',
    headers: { 'PRIVATE-TOKEN': token },
    body: formData,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitLab upload failed (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  return {
    markdown: data.markdown,
    url: `https://${host}/${projectPath}${data.url}`,
    alt: data.alt,
  };
}

/**
 * Upload files and return markdown strings to embed in the issue body.
 * GitHub doesn't have a direct upload API, so files are base64-encoded inline.
 * GitLab uses the project uploads endpoint.
 */
export async function uploadAttachments(repoInfo, token, files) {
  const results = [];
  for (const file of files) {
    if (repoInfo.platform === 'gitlab') {
      const res = await uploadFileGitLab(repoInfo, token, file);
      results.push(res);
    } else {
      // GitHub: encode small images as data-uri in markdown (limited to ~10MB)
      const dataUrl = await fileToDataUrl(file);
      results.push({
        markdown: `![${file.name}](${dataUrl})`,
        url: dataUrl,
        alt: file.name,
      });
    }
  }
  return results;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── GitHub ─────────────────────────────────────────────────────────────

async function createGitHubIssue({ projectPath }, token, { title, body, labels }) {
  const url = `https://api.github.com/repos/${projectPath}/issues`;
  const resp = await gitFetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders('github', token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      body: body || '',
      labels: labels || [],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to create GitHub issue (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  return {
    id: data.number,
    title: data.title,
    url: data.html_url,
    state: data.state,
    createdAt: data.created_at,
  };
}

async function listGitHubIssues({ projectPath }, token, { labels, state, perPage, page } = {}) {
  const params = new URLSearchParams();
  if (labels) params.set('labels', labels.join(','));
  if (state) params.set('state', state);
  params.set('per_page', String(perPage || 20));
  params.set('page', String(page || 1));

  const url = `https://api.github.com/repos/${projectPath}/issues?${params}`;
  const resp = await gitFetch(url, {
    headers: authHeaders('github', token),
  });
  if (!resp.ok) throw new Error(`Failed to list GitHub issues (${resp.status})`);
  const data = await resp.json();
  return data.map(i => ({
    id: i.number,
    title: i.title,
    url: i.html_url,
    state: i.state,
    labels: i.labels.map(l => l.name),
    createdAt: i.created_at,
    author: i.user?.login,
  }));
}

async function addGitHubComment({ projectPath }, token, issueNumber, body) {
  const url = `https://api.github.com/repos/${projectPath}/issues/${issueNumber}/comments`;
  const resp = await gitFetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders('github', token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  if (!resp.ok) throw new Error(`Failed to add comment (${resp.status})`);
  return resp.json();
}

// ─── GitLab ─────────────────────────────────────────────────────────────

async function createGitLabIssue({ host, projectPath }, token, { title, body, labels }) {
  const projectId = encodeURIComponent(projectPath);
  const url = `https://${host}/api/v4/projects/${projectId}/issues`;
  const resp = await gitFetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders('gitlab', token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      description: body || '',
      labels: labels ? labels.join(',') : undefined,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to create GitLab issue (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  return {
    id: data.iid,
    title: data.title,
    url: data.web_url,
    state: data.state,
    createdAt: data.created_at,
  };
}

async function listGitLabIssues({ host, projectPath }, token, { labels, state, perPage, page } = {}) {
  const projectId = encodeURIComponent(projectPath);
  const params = new URLSearchParams();
  if (labels) params.set('labels', labels.join(','));
  if (state) params.set('state', state === 'open' ? 'opened' : state);
  params.set('per_page', String(perPage || 20));
  params.set('page', String(page || 1));

  const url = `https://${host}/api/v4/projects/${projectId}/issues?${params}`;
  const resp = await gitFetch(url, {
    headers: authHeaders('gitlab', token),
  });
  if (!resp.ok) throw new Error(`Failed to list GitLab issues (${resp.status})`);
  const data = await resp.json();
  return data.map(i => ({
    id: i.iid,
    title: i.title,
    url: i.web_url,
    state: i.state,
    labels: i.labels || [],
    createdAt: i.created_at,
    author: i.author?.username,
  }));
}

async function addGitLabComment({ host, projectPath }, token, issueId, body) {
  const projectId = encodeURIComponent(projectPath);
  const url = `https://${host}/api/v4/projects/${projectId}/issues/${issueId}/notes`;
  const resp = await gitFetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders('gitlab', token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  if (!resp.ok) throw new Error(`Failed to add comment (${resp.status})`);
  return resp.json();
}
