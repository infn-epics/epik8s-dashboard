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

import { readFileSync, existsSync } from 'node:fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { KubeConfig, CoreV1Api, AppsV1Api, CustomObjectsApi, Metrics } from '@kubernetes/client-node';

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
      }, undefined, undefined, undefined, undefined, undefined, {
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
      });
      results.push(dep.metadata.name);
    }

    res.json({ restarted: results });
  } catch (err) { next(err); }
});

app.delete('/api/v1/applications/:name', async (req, res, next) => {
  try {
    res.json(await deleteArgoApp(req.params.name));
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
    }, undefined, undefined, undefined, undefined, undefined, {
      headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
    });
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
    }, undefined, undefined, undefined, undefined, undefined, {
      headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
    });
    res.json({ restarted: req.params.name });
  } catch (err) { next(err); }
});

app.delete('/api/v1/deployments/:name', async (req, res, next) => {
  try {
    await appsApi.deleteNamespacedDeployment({
      name: req.params.name,
      namespace: NAMESPACE,
    });
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
    }, undefined, undefined, undefined, undefined, undefined, {
      headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
    });
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
    }, undefined, undefined, undefined, undefined, undefined, {
      headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
    });
    res.json({ restarted: req.params.name });
  } catch (err) { next(err); }
});

app.delete('/api/v1/statefulsets/:name', async (req, res, next) => {
  try {
    await appsApi.deleteNamespacedStatefulSet({
      name: req.params.name,
      namespace: NAMESPACE,
    });
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

// ─── Error handler ──────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[ERROR] ${status}: ${err.message}`);
  res.status(status).json({ error: err.message });
});

// ─── Start ──────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`epik8s-backend listening on :${PORT}`);
  console.log(`  namespace       : ${NAMESPACE}`);
  console.log(`  argocd ns       : ${ARGOCD_NAMESPACE}`);
});
