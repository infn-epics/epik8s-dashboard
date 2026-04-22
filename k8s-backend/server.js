/**
 * EPIK8s Backend — Kubernetes & ArgoCD API proxy.
 *
 * Runs inside the beamline namespace and uses the in-cluster ServiceAccount
 * to proxy K8s API and ArgoCD requests for the dashboard frontend.
 *
 * ArgoCD Application resources are queried directly via the K8s CRD API
 * (argoproj.io/v1alpha1/applications) — no ArgoCD REST API token needed.
 *
 * Environment variables:
 *   NAMESPACE          — target namespace (default: read from SA mount)
 *   ARGOCD_NAMESPACE   — namespace where ArgoCD Application CRs live (default: argocd)
 *   PORT               — listen port (default: 3001)
 *   ALLOWED_ORIGINS    — comma-separated CORS origins (default: *)
 *   LOG_LEVEL          — morgan format (default: combined)
 */

import { readFileSync, existsSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, resolve, extname, basename, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';
import { KubeConfig, CoreV1Api, AppsV1Api, CustomObjectsApi, Metrics, Exec, Attach, Log } from '@kubernetes/client-node';

// ─── Config ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3001', 10);
const ARGOCD_NAMESPACE = process.env.ARGOCD_NAMESPACE || 'argocd';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
const LOG_LEVEL = process.env.LOG_LEVEL || 'combined';

// Read namespace from downward API or SA token mount
function detectNamespace() {
  if (process.env.NAMESPACE) return process.env.NAMESPACE;
  const nsFile = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';
  if (existsSync(nsFile)) return readFileSync(nsFile, 'utf8').trim();
  return 'default';
}
const NAMESPACE = detectNamespace();

// ─── K8s client (in-cluster or kubeconfig) ──────────────────────────────

const kc = new KubeConfig();
try {
  kc.loadFromCluster();
} catch {
  kc.loadFromDefault();
}

const coreApi = kc.makeApiClient(CoreV1Api);
const appsApi = kc.makeApiClient(AppsV1Api);
const customApi = kc.makeApiClient(CustomObjectsApi);

// ─── ArgoCD CRD helpers ──────────────────────────────────────────────────

const ARGO_GROUP = 'argoproj.io';
const ARGO_VERSION = 'v1alpha1';
const ARGO_PLURAL = 'applications';

/** List ArgoCD Applications belonging to this beamline namespace. */
async function listArgoApps() {
  const resp = await customApi.listNamespacedCustomObject({
    group: ARGO_GROUP,
    version: ARGO_VERSION,
    namespace: ARGOCD_NAMESPACE,
    plural: ARGO_PLURAL,
  });
  return (resp.items || []).filter(
    app => app.spec?.destination?.namespace === NAMESPACE ||
           app.spec?.project === NAMESPACE
  );
}

/** Get a single ArgoCD Application by name. */
async function getArgoApp(name) {
  return customApi.getNamespacedCustomObject({
    group: ARGO_GROUP,
    version: ARGO_VERSION,
    namespace: ARGOCD_NAMESPACE,
    plural: ARGO_PLURAL,
    name,
  });
}

/** Patch an ArgoCD Application (merge-patch). */
async function patchArgoApp(name, body) {
  return customApi.patchNamespacedCustomObject(
    { group: ARGO_GROUP, version: ARGO_VERSION, namespace: ARGOCD_NAMESPACE, plural: ARGO_PLURAL, name, body },
    undefined, undefined, undefined, undefined,
    { headers: { 'Content-Type': 'application/merge-patch+json' } },
  );
}

/** Delete an ArgoCD Application. */
async function deleteArgoApp(name) {
  return customApi.deleteNamespacedCustomObject({
    group: ARGO_GROUP,
    version: ARGO_VERSION,
    namespace: ARGOCD_NAMESPACE,
    plural: ARGO_PLURAL,
    name,
    body: { propagationPolicy: 'Foreground' },
  });
}

// ─── Express app ────────────────────────────────────────────────────────

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan(LOG_LEVEL));
app.use(express.json());

// CORS
const corsOrigins = ALLOWED_ORIGINS === '*' ? '*' : ALLOWED_ORIGINS.split(',').map(s => s.trim());
app.use(cors({ origin: corsOrigins, credentials: true }));

// ─── HTTP server (needed for WebSocket upgrade) ─────────────────────────

const server = createServer(app);

// ─── WebSocket servers (chat + system events + pod log/exec/attach) ──

const chatWss = new WebSocketServer({ noServer: true });
const systemWss = new WebSocketServer({ noServer: true });
const podLogWss = new WebSocketServer({ noServer: true });
const podExecWss = new WebSocketServer({ noServer: true });
const podAttachWss = new WebSocketServer({ noServer: true });

// Route WS upgrade by URL path
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === '/ws/chat') {
    chatWss.handleUpgrade(req, socket, head, ws => chatWss.emit('connection', ws, req));
  } else if (pathname === '/ws/system') {
    systemWss.handleUpgrade(req, socket, head, ws => systemWss.emit('connection', ws, req));
  } else if (pathname.startsWith('/ws/pods/') && pathname.endsWith('/logs')) {
    podLogWss.handleUpgrade(req, socket, head, ws => podLogWss.emit('connection', ws, req));
  } else if (pathname.startsWith('/ws/pods/') && pathname.endsWith('/exec')) {
    podExecWss.handleUpgrade(req, socket, head, ws => podExecWss.emit('connection', ws, req));
  } else if (pathname.startsWith('/ws/pods/') && pathname.endsWith('/attach')) {
    podAttachWss.handleUpgrade(req, socket, head, ws => podAttachWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// --- Chat relay ---
// Max total WS message size: ~4MB (base64 overhead for ~3MB of files)
const MAX_WS_MSG_BYTES = 4 * 1024 * 1024;

chatWss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    if (raw.length > MAX_WS_MSG_BYTES) return; // drop oversized
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    // Build sanitised attachments (max 5, each name+dataUrl)
    let attachments = [];
    if (Array.isArray(msg.attachments)) {
      attachments = msg.attachments.slice(0, 5).map(a => ({
        name: String(a.name || 'file').slice(0, 200),
        dataUrl: String(a.dataUrl || '').slice(0, 3 * 1024 * 1024),
      })).filter(a => a.dataUrl.length > 0);
    }
    const envelope = {
      type: 'chat',
      user: String(msg.user || 'anonymous').slice(0, 64),
      text: String(msg.text || '').slice(0, 2000),
      broadcast: !!msg.broadcast,
      attachments,
      ts: new Date().toISOString(),
    };
    const payload = JSON.stringify(envelope);
    for (const client of chatWss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  });
});

// --- System event broadcaster ---
function emitSystemEvent(action, resource, name, extra = {}) {
  const event = {
    type: 'system',
    action,
    resource,
    name,
    namespace: NAMESPACE,
    ts: new Date().toISOString(),
    ...extra,
  };
  const payload = JSON.stringify(event);
  for (const client of systemWss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

// ─── Git proxy (CORS-free file fetch for browser clients) ───────────────
//
// GET /api/v1/git-proxy?url=<encoded_url>
// Optional header  X-Git-Token: <PAT>
//
// The browser cannot fetch raw GitLab/GitHub files directly because those
// servers don't set Access-Control-Allow-Origin.  This endpoint fetches the
// URL server-side (no CORS restriction) and relays the response back to the
// browser.  Only http/https URLs are accepted.

app.get('/api/v1/git-proxy', async (req, res, next) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'Missing ?url= parameter' });

    let parsed;
    try { parsed = new URL(targetUrl); } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return res.status(400).json({ error: 'Only http/https URLs allowed' });
    }

    const token = req.headers['x-git-token'];
    const headers = { 'User-Agent': 'epik8s-backend/1.0', 'Accept': 'text/plain, */*' };
    if (token) {
      // GitLab PAT
      headers['PRIVATE-TOKEN'] = token;
      // GitHub PAT
      headers['Authorization'] = `Bearer ${token}`;
    }

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    let upstream;
    try {
      upstream = await fetch(targetUrl, { headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (upstream.status === 401 || upstream.status === 403) {
      return res.status(upstream.status).json({ error: 'Authentication required' });
    }
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream HTTP ${upstream.status}` });
    }

    const text = await upstream.text();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(text);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream request timed out' });
    }
    next(err);
  }
});

// ─── Health ─────────────────────────────────────────────────────────────

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', namespace: NAMESPACE, timestamp: new Date().toISOString() });
});

// ─── Namespace info ─────────────────────────────────────────────────────

app.get('/api/v1/namespace', async (_req, res, next) => {
  try {
    const ns = await coreApi.readNamespace({ name: NAMESPACE });
    const pods = await coreApi.listNamespacedPod({ namespace: NAMESPACE });
    const svcs = await coreApi.listNamespacedService({ namespace: NAMESPACE });
    res.json({
      name: NAMESPACE,
      status: ns.status?.phase,
      labels: ns.metadata?.labels,
      podCount: pods.items.length,
      serviceCount: svcs.items.length,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// ArgoCD Applications (via K8s CRD API — no ArgoCD token required)
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/v1/applications', async (_req, res, next) => {
  try {
    res.json(await listArgoApps());
  } catch (err) { next(err); }
});

app.get('/api/v1/applications/:name', async (req, res, next) => {
  try {
    res.json(await getArgoApp(req.params.name));
  } catch (err) { next(err); }
});

// Trigger sync by setting spec.operation on the Application CR
app.post('/api/v1/applications/:name/sync', async (req, res, next) => {
  try {
    const data = await patchArgoApp(req.params.name, {
      spec: {
        operation: {
          sync: { revision: 'HEAD', prune: false },
          initiatedBy: { username: 'epik8s-dashboard' },
        },
      },
    });
    emitSystemEvent('sync', 'application', req.params.name);
    res.json(data);
  } catch (err) { next(err); }
});

app.post('/api/v1/applications/:name/restart', async (req, res, next) => {
  try {
    // ArgoCD doesn't have a direct restart API; we use resource actions.
    // Trigger a rolling restart by patching the managed Deployments in the namespace.
    const appName = req.params.name;
    const restartAnnotation = { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() };

    // Find deployments owned by this ArgoCD app
    const deps = await appsApi.listNamespacedDeployment({ namespace: NAMESPACE });
    const matching = deps.items.filter(d =>
      d.metadata?.labels?.['argocd.argoproj.io/instance'] === appName ||
      d.metadata?.labels?.['app.kubernetes.io/instance'] === appName ||
      d.metadata?.name === appName
    );

    const results = [];
    for (const dep of matching) {
      const patch = {
        spec: { template: { metadata: { annotations: restartAnnotation } } },
      };
      await appsApi.patchNamespacedDeployment({
        name: dep.metadata.name,
        namespace: NAMESPACE,
        body: patch,
      }, {
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
      });
      results.push(dep.metadata.name);
    }

    emitSystemEvent('restart', 'application', req.params.name, { deployments: results });
    res.json({ restarted: results });
  } catch (err) { next(err); }
});

app.delete('/api/v1/applications/:name', async (req, res, next) => {
  try {
    const result = await deleteArgoApp(req.params.name);
    emitSystemEvent('delete', 'application', req.params.name);
    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// Kubernetes Resources
// ═══════════════════════════════════════════════════════════════════════

// --- Pods ---------------------------------------------------------

app.get('/api/v1/pods', async (_req, res, next) => {
  try {
    const data = await coreApi.listNamespacedPod({ namespace: NAMESPACE });
    res.json({ items: data.items });
  } catch (err) { next(err); }
});

app.get('/api/v1/pods/:name/logs', async (req, res, next) => {
  try {
    const opts = {
      name: req.params.name,
      namespace: NAMESPACE,
      tailLines: parseInt(req.query.tailLines || '200', 10),
    };
    if (req.query.container) opts.container = req.query.container;
    const logs = await coreApi.readNamespacedPodLog(opts);
    res.json({ logs: typeof logs === 'string' ? logs : String(logs) });
  } catch (err) { next(err); }
});

app.delete('/api/v1/pods/:name', async (req, res, next) => {
  try {
    await coreApi.deleteNamespacedPod({
      name: req.params.name,
      namespace: NAMESPACE,
    });
    emitSystemEvent('delete', 'pod', req.params.name);
    res.json({ deleted: req.params.name });
  } catch (err) { next(err); }
});

// --- Services -----------------------------------------------------

app.get('/api/v1/services', async (_req, res, next) => {
  try {
    const data = await coreApi.listNamespacedService({ namespace: NAMESPACE });
    res.json({ items: data.items });
  } catch (err) { next(err); }
});

// --- ConfigMaps ---------------------------------------------------

app.get('/api/v1/configmaps', async (_req, res, next) => {
  try {
    const data = await coreApi.listNamespacedConfigMap({ namespace: NAMESPACE });
    res.json({ items: data.items });
  } catch (err) { next(err); }
});

// --- Deployments --------------------------------------------------

app.get('/api/v1/deployments', async (_req, res, next) => {
  try {
    const data = await appsApi.listNamespacedDeployment({ namespace: NAMESPACE });
    res.json({ items: data.items });
  } catch (err) { next(err); }
});

app.post('/api/v1/deployments/:name/scale', async (req, res, next) => {
  try {
    const replicas = parseInt(req.body.replicas, 10);
    if (isNaN(replicas) || replicas < 0 || replicas > 20) {
      return res.status(400).json({ error: 'replicas must be 0-20' });
    }
    const patch = { spec: { replicas } };
    await appsApi.patchNamespacedDeployment({
      name: req.params.name,
      namespace: NAMESPACE,
      body: patch,
    }, {
      headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
    });
    emitSystemEvent('scale', 'deployment', req.params.name, { replicas });
    res.json({ scaled: req.params.name, replicas });
  } catch (err) { next(err); }
});

app.post('/api/v1/deployments/:name/restart', async (req, res, next) => {
  try {
    const patch = {
      spec: { template: { metadata: { annotations: {
        'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
      } } } },
    };
    await appsApi.patchNamespacedDeployment({
      name: req.params.name,
      namespace: NAMESPACE,
      body: patch,
    }, {
      headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
    });
    emitSystemEvent('restart', 'deployment', req.params.name);
    res.json({ restarted: req.params.name });
  } catch (err) { next(err); }
});

app.delete('/api/v1/deployments/:name', async (req, res, next) => {
  try {
    await appsApi.deleteNamespacedDeployment({
      name: req.params.name,
      namespace: NAMESPACE,
    });
    emitSystemEvent('delete', 'deployment', req.params.name);
    res.json({ deleted: req.params.name });
  } catch (err) { next(err); }
});

// --- StatefulSets -------------------------------------------------

app.get('/api/v1/statefulsets', async (_req, res, next) => {
  try {
    const data = await appsApi.listNamespacedStatefulSet({ namespace: NAMESPACE });
    res.json({ items: data.items });
  } catch (err) { next(err); }
});

app.post('/api/v1/statefulsets/:name/scale', async (req, res, next) => {
  try {
    const replicas = parseInt(req.body.replicas, 10);
    if (isNaN(replicas) || replicas < 0 || replicas > 20) {
      return res.status(400).json({ error: 'replicas must be 0-20' });
    }
    const patch = { spec: { replicas } };
    await appsApi.patchNamespacedStatefulSet({
      name: req.params.name,
      namespace: NAMESPACE,
      body: patch,
    }, {
      headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
    });
    emitSystemEvent('scale', 'statefulset', req.params.name, { replicas });
    res.json({ scaled: req.params.name, replicas });
  } catch (err) { next(err); }
});

app.post('/api/v1/statefulsets/:name/restart', async (req, res, next) => {
  try {
    const patch = {
      spec: { template: { metadata: { annotations: {
        'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
      } } } },
    };
    await appsApi.patchNamespacedStatefulSet({
      name: req.params.name,
      namespace: NAMESPACE,
      body: patch,
    }, {
      headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
    });
    emitSystemEvent('restart', 'statefulset', req.params.name);
    res.json({ restarted: req.params.name });
  } catch (err) { next(err); }
});

app.delete('/api/v1/statefulsets/:name', async (req, res, next) => {
  try {
    await appsApi.deleteNamespacedStatefulSet({
      name: req.params.name,
      namespace: NAMESPACE,
    });
    emitSystemEvent('delete', 'statefulset', req.params.name);
    res.json({ deleted: req.params.name });
  } catch (err) { next(err); }
});

// --- Nodes --------------------------------------------------------

app.get('/api/v1/nodes', async (_req, res, next) => {
  try {
    const nodesResp = await coreApi.listNode();
    // Get metrics if available (requires metrics-server)
    let metricsMap = {};
    try {
      const metricsApi = new Metrics(kc);
      const nodeMetrics = await metricsApi.getNodeMetrics();
      for (const m of nodeMetrics.items || []) {
        metricsMap[m.metadata.name] = m.usage;
      }
    } catch { /* metrics-server may not be installed */ }

    // Get pods per node (only our namespace)
    const podsResp = await coreApi.listNamespacedPod({ namespace: NAMESPACE });
    const podsByNode = {};
    for (const pod of podsResp.items) {
      const node = pod.spec?.nodeName;
      if (node) {
        if (!podsByNode[node]) podsByNode[node] = [];
        podsByNode[node].push(pod.metadata.name);
      }
    }

    const nodes = nodesResp.items.map(n => {
      const name = n.metadata?.name || '';
      const capacity = n.status?.capacity || {};
      const allocatable = n.status?.allocatable || {};
      const conditions = n.status?.conditions || [];
      const ready = conditions.find(c => c.type === 'Ready');
      const addresses = n.status?.addresses || [];
      const internalIP = addresses.find(a => a.type === 'InternalIP')?.address || '';
      return {
        name,
        status: ready?.status === 'True' ? 'Ready' : 'NotReady',
        roles: Object.keys(n.metadata?.labels || {})
          .filter(l => l.startsWith('node-role.kubernetes.io/'))
          .map(l => l.replace('node-role.kubernetes.io/', '')),
        internalIP,
        capacity: {
          cpu: capacity.cpu || '',
          memory: capacity.memory || '',
          pods: capacity.pods || '',
          ephemeralStorage: capacity['ephemeral-storage'] || '',
        },
        allocatable: {
          cpu: allocatable.cpu || '',
          memory: allocatable.memory || '',
          pods: allocatable.pods || '',
        },
        usage: metricsMap[name] || null,
        namespacePods: podsByNode[name] || [],
        labels: n.metadata?.labels || {},
        createdAt: n.metadata?.creationTimestamp || '',
        osImage: n.status?.nodeInfo?.osImage || '',
        kubeletVersion: n.status?.nodeInfo?.kubeletVersion || '',
      };
    });
    res.json({ items: nodes });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// Pod log streaming, exec, and attach via WebSocket
// ═══════════════════════════════════════════════════════════════════════

function parsePodPath(pathname) {
  // /ws/pods/<podName>/(logs|exec|attach)
  const m = pathname.match(/^\/ws\/pods\/([^/]+)\/(logs|exec|attach)$/);
  return m ? { podName: decodeURIComponent(m[1]), action: m[2] } : null;
}

// --- Streaming Pod Logs ---
podLogWss.on('connection', async (ws, req) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const parsed = parsePodPath(pathname);
  if (!parsed) { ws.close(1008, 'Invalid pod path'); return; }

  const { podName } = parsed;
  const container = searchParams.get('container') || undefined;
  const tailLines = parseInt(searchParams.get('tailLines') || '200', 10);

  try {
    const logStream = new Log(kc);
    const stream = await logStream.log(NAMESPACE, podName, container, {
      follow: true,
      tailLines,
      pretty: false,
    });

    stream.on('data', (chunk) => {
      if (ws.readyState === 1) ws.send(chunk.toString());
    });
    stream.on('error', (err) => {
      if (ws.readyState === 1) ws.send(`\n[log stream error: ${err.message}]\n`);
      ws.close(1011, 'Log stream error');
    });
    stream.on('end', () => {
      if (ws.readyState === 1) ws.send('\n[log stream ended]\n');
      ws.close(1000, 'Log stream ended');
    });

    ws.on('close', () => {
      try { stream.destroy(); } catch { /* ignore */ }
    });
  } catch (err) {
    if (ws.readyState === 1) ws.send(`Error: ${err.message}`);
    ws.close(1011, err.message);
  }
});

// --- Pod Exec (interactive shell) ---
podExecWss.on('connection', async (ws, req) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const parsed = parsePodPath(pathname);
  if (!parsed) { ws.close(1008, 'Invalid pod path'); return; }

  const { podName } = parsed;
  const container = searchParams.get('container') || undefined;
  const cmdParam = searchParams.get('cmd') || '/bin/sh';
  const command = cmdParam.split(' ');

  try {
    const exec = new Exec(kc);
    // Create a writable stream that sends data to the WebSocket
    const { PassThrough } = await import('node:stream');
    const stdinStream = new PassThrough();
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    stdoutStream.on('data', (chunk) => {
      if (ws.readyState === 1) ws.send(chunk.toString());
    });
    stderrStream.on('data', (chunk) => {
      if (ws.readyState === 1) ws.send(chunk.toString());
    });

    ws.on('message', (data) => {
      const msg = data.toString();
      // Handle resize messages
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'resize') {
          // k8s exec doesn't support resize through this API easily,
          // but we can try setting COLUMNS/LINES env on next command
          return;
        }
      } catch { /* not JSON, treat as stdin */ }
      stdinStream.write(msg);
    });

    const execConn = await exec.exec(
      NAMESPACE,
      podName,
      container,
      command,
      stdoutStream,
      stderrStream,
      stdinStream,
      true, // tty
    );

    ws.on('close', () => {
      try { stdinStream.destroy(); } catch { /* ignore */ }
      try { if (execConn && execConn.close) execConn.close(); } catch { /* ignore */ }
    });

    if (execConn && execConn.on) {
      execConn.on('close', () => {
        if (ws.readyState === 1) ws.close(1000, 'Exec session ended');
      });
      execConn.on('error', (err) => {
        if (ws.readyState === 1) ws.send(`\n[exec error: ${err.message}]\n`);
        ws.close(1011, err.message);
      });
    }
  } catch (err) {
    if (ws.readyState === 1) ws.send(`Error: ${err.message}`);
    ws.close(1011, err.message);
  }
});

// --- Pod Attach ---
podAttachWss.on('connection', async (ws, req) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const parsed = parsePodPath(pathname);
  if (!parsed) { ws.close(1008, 'Invalid pod path'); return; }

  const { podName } = parsed;
  const container = searchParams.get('container') || undefined;

  try {
    const attach = new Attach(kc);
    const { PassThrough } = await import('node:stream');
    const stdinStream = new PassThrough();
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    stdoutStream.on('data', (chunk) => {
      if (ws.readyState === 1) ws.send(chunk.toString());
    });
    stderrStream.on('data', (chunk) => {
      if (ws.readyState === 1) ws.send(chunk.toString());
    });

    ws.on('message', (data) => {
      stdinStream.write(data.toString());
    });

    const attachConn = await attach.attach(
      NAMESPACE,
      podName,
      container,
      stdoutStream,
      stderrStream,
      stdinStream,
      true, // tty
    );

    ws.on('close', () => {
      try { stdinStream.destroy(); } catch { /* ignore */ }
      try { if (attachConn && attachConn.close) attachConn.close(); } catch { /* ignore */ }
    });

    if (attachConn && attachConn.on) {
      attachConn.on('close', () => {
        if (ws.readyState === 1) ws.close(1000, 'Attach session ended');
      });
      attachConn.on('error', (err) => {
        if (ws.readyState === 1) ws.send(`\n[attach error: ${err.message}]\n`);
        ws.close(1011, err.message);
      });
    }
  } catch (err) {
    if (ws.readyState === 1) ws.send(`Error: ${err.message}`);
    ws.close(1011, err.message);
  }
});

// ─── File Browser ──────────────────────────────────────────────────────
//
// Provides REST access to files on the NFS mount for the camera file browser.
// Restricted to FILES_BASE_PATH (default: /nfs/data) for path traversal safety.
//
// GET /api/v1/files/list?path=<dir>       — list directory entries
// GET /api/v1/files/content?path=<file>   — stream a single file
// GET /api/v1/files/archive?path=<dir>    — tar.gz of the entire directory

const FILES_BASE_PATH = (process.env.FILES_BASE_PATH || '/nfs/data').replace(/\/$/, '');

function safeFilePath(requestedPath) {
  if (!requestedPath) return null;
  const normalized = resolve(normalize(String(requestedPath)));
  // Must be inside the allowed base path
  if (!normalized.startsWith(FILES_BASE_PATH + '/') && normalized !== FILES_BASE_PATH) return null;
  return normalized;
}

app.get('/api/v1/files/list', (req, res) => {
  const safep = safeFilePath(req.query.path);
  if (!safep) return res.status(403).json({ error: 'Path not allowed or missing ?path=' });
  if (!existsSync(safep)) return res.status(404).json({ error: 'Path not found' });
  try {
    const st = statSync(safep);
    if (!st.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });
    const entries = readdirSync(safep).map(name => {
      const full = join(safep, name);
      try {
        const s = statSync(full);
        return { name, path: full, isDir: s.isDirectory(), size: s.size, mtime: s.mtime.toISOString() };
      } catch {
        return { name, path: full, isDir: false, size: 0, mtime: '' };
      }
    });
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ path: safep, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/v1/files/content', (req, res) => {
  const safep = safeFilePath(req.query.path);
  if (!safep) return res.status(403).json({ error: 'Path not allowed or missing ?path=' });
  if (!existsSync(safep)) return res.status(404).json({ error: 'File not found' });
  try {
    const st = statSync(safep);
    if (st.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });
    const mimeMap = {
      '.tiff': 'image/tiff', '.tif': 'image/tiff',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.hdf5': 'application/x-hdf5', '.h5': 'application/x-hdf5',
    };
    const ct = mimeMap[extname(safep).toLowerCase()] || 'application/octet-stream';
    const asDownload = req.query.download === '1';
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Length', st.size);
    res.setHeader('Content-Disposition',
      `${asDownload ? 'attachment' : 'inline'}; filename="${basename(safep)}"`);
    createReadStream(safep).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/v1/files/archive', (req, res) => {
  const safep = safeFilePath(req.query.path);
  if (!safep) return res.status(403).json({ error: 'Path not allowed or missing ?path=' });
  if (!existsSync(safep)) return res.status(404).json({ error: 'Path not found' });
  try {
    const st = statSync(safep);
    if (!st.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });
    const dirName = basename(safep);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${dirName}.tar.gz"`);
    const tar = spawn('tar', ['-czf', '-', '-C', dirname(safep), dirName]);
    tar.stdout.pipe(res);
    tar.stderr.on('data', d => console.error('[tar]', d.toString()));
    tar.on('error', err => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.destroy();
    });
    req.on('close', () => tar.kill());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Error handler ──────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[ERROR] ${status}: ${err.message}`);
  res.status(status).json({ error: err.message });
});

// ─── Start ──────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log(`epik8s-backend listening on :${PORT}`);
  console.log(`  namespace       : ${NAMESPACE}`);
  console.log(`  argocd ns       : ${ARGOCD_NAMESPACE}`);
  console.log(`  websocket       : /ws/chat, /ws/system, /ws/pods/:name/{logs,exec,attach}`);
});
