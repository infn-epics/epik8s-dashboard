/**
 * K8s / ArgoCD API client — talks to the EPIK8s backend running in the beamline namespace.
 *
 * The backend exposes REST endpoints for:
 *  - ArgoCD Application management (list, sync, restart, get health)
 *  - Kubernetes resource inspection (pods, services, configmaps)
 *  - Pod logs
 *
 * Base URL is derived from config: https://{namespace}-backend.{epik8namespace}
 * or can be overridden via ?backend= query param.
 */

import { proxyUrl } from './devProxy.js';

let _baseUrl = null;

/**
 * Derive the backend URL from the beamline config.
 */
export function buildBackendUrl(config) {
  const params = new URLSearchParams(window.location.search);
  const override = params.get('backend');
  if (override) return proxyUrl(override);

  const ns = config?.namespace || '';
  const domain = config?.epik8namespace || '';
  if (ns && domain) return proxyUrl(`https://${ns}-backend.${domain}`);
  return null;
}

export function setBackendUrl(url) {
  _baseUrl = url;
}

export function getBackendUrl() {
  return _baseUrl;
}

/**
 * Generic authenticated fetch against the backend.
 */
async function apiFetch(path, token, options = {}) {
  if (!_baseUrl) throw new Error('Backend URL not configured');
  const url = `${_baseUrl}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${options.method || 'GET'} ${path} failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

// ─── ArgoCD Applications ────────────────────────────────────────────────

export function listApplications(token) {
  return apiFetch('/api/v1/applications', token);
}

export function getApplication(name, token) {
  return apiFetch(`/api/v1/applications/${encodeURIComponent(name)}`, token);
}

export function syncApplication(name, token) {
  return apiFetch(`/api/v1/applications/${encodeURIComponent(name)}/sync`, token, {
    method: 'POST',
  });
}

export function restartApplication(name, token) {
  return apiFetch(`/api/v1/applications/${encodeURIComponent(name)}/restart`, token, {
    method: 'POST',
  });
}

export function deleteApplication(name, token) {
  return apiFetch(`/api/v1/applications/${encodeURIComponent(name)}`, token, {
    method: 'DELETE',
  });
}

// ─── Kubernetes Resources ───────────────────────────────────────────────

export function listPods(token) {
  return apiFetch('/api/v1/pods', token);
}

export function getPodLogs(podName, token, { container, tailLines = 200 } = {}) {
  const params = new URLSearchParams();
  if (container) params.set('container', container);
  params.set('tailLines', String(tailLines));
  return apiFetch(`/api/v1/pods/${encodeURIComponent(podName)}/logs?${params}`, token);
}

export function deletePod(podName, token) {
  return apiFetch(`/api/v1/pods/${encodeURIComponent(podName)}`, token, {
    method: 'DELETE',
  });
}

export function listServices(token) {
  return apiFetch('/api/v1/services', token);
}

export function listConfigMaps(token) {
  return apiFetch('/api/v1/configmaps', token);
}

export function listDeployments(token) {
  return apiFetch('/api/v1/deployments', token);
}

export function listStatefulSets(token) {
  return apiFetch('/api/v1/statefulsets', token);
}

export function scaleDeployment(name, replicas, token) {
  return apiFetch(`/api/v1/deployments/${encodeURIComponent(name)}/scale`, token, {
    method: 'POST',
    body: JSON.stringify({ replicas }),
  });
}

export function restartDeployment(name, token) {
  return apiFetch(`/api/v1/deployments/${encodeURIComponent(name)}/restart`, token, {
    method: 'POST',
  });
}

export function deleteDeployment(name, token) {
  return apiFetch(`/api/v1/deployments/${encodeURIComponent(name)}`, token, {
    method: 'DELETE',
  });
}

// ─── StatefulSets ───────────────────────────────────────────────────────

export function scaleStatefulSet(name, replicas, token) {
  return apiFetch(`/api/v1/statefulsets/${encodeURIComponent(name)}/scale`, token, {
    method: 'POST',
    body: JSON.stringify({ replicas }),
  });
}

export function restartStatefulSet(name, token) {
  return apiFetch(`/api/v1/statefulsets/${encodeURIComponent(name)}/restart`, token, {
    method: 'POST',
  });
}

export function deleteStatefulSet(name, token) {
  return apiFetch(`/api/v1/statefulsets/${encodeURIComponent(name)}`, token, {
    method: 'DELETE',
  });
}

// ─── Nodes ──────────────────────────────────────────────────────────────

export function listNodes(token) {
  return apiFetch('/api/v1/nodes', token);
}

// ─── Namespace info ─────────────────────────────────────────────────────

export function getNamespaceInfo(token) {
  return apiFetch('/api/v1/namespace', token);
}

// ─── Health check ───────────────────────────────────────────────────────

export async function checkBackendHealth() {
  if (!_baseUrl) return false;
  try {
    const resp = await fetch(`${_baseUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
    return resp.ok;
  } catch {
    return false;
  }
}
