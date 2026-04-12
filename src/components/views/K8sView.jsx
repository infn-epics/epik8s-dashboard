/**
 * K8sView — Manage ArgoCD applications and Kubernetes resources
 * for the beamline namespace.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useApp } from '../../context/AppContext.jsx';
import {
  buildBackendUrl, setBackendUrl, getBackendUrl, checkBackendHealth,
  listApplications, syncApplication, restartApplication, deleteApplication,
  listPods, getPodLogs, deletePod,
  listServices, listConfigMaps, listDeployments, listStatefulSets,
  scaleDeployment, restartDeployment, deleteDeployment,
  scaleStatefulSet, restartStatefulSet, deleteStatefulSet,
  listNodes,
  streamPodLogs, execPod, attachPod,
} from '../../services/k8sApi.js';

const TABS = [
  { key: 'apps', label: '📦 Applications', icon: '📦' },
  { key: 'pods', label: '🐳 Pods', icon: '🐳' },
  { key: 'services', label: '🔌 Services', icon: '🔌' },
  { key: 'deployments', label: '🚀 Deployments', icon: '🚀' },
  { key: 'configmaps', label: '📋 ConfigMaps', icon: '📋' },
  { key: 'statefulsets', label: '💾 StatefulSets', icon: '💾' },
  { key: 'nodes', label: '🖥 Nodes', icon: '🖥' },
];

export default function K8sView() {
  const { token, isAuthenticated } = useAuth();
  const { config } = useApp();

  const [tab, setTab] = useState('apps');
  const [healthy, setHealthy] = useState(null);
  const [dataCache, setDataCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);
  const [search, setSearch] = useState('');

  // Pod logs
  const [logsOpen, setLogsOpen] = useState(null); // pod name
  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsStreaming, setLogsStreaming] = useState(false);
  const logsRef = useRef(null);
  const logsWsRef = useRef(null);

  // Pod exec / attach terminal
  const [termOpen, setTermOpen] = useState(null); // { podName, mode: 'exec'|'attach' }
  const [termText, setTermText] = useState('');
  const [termInput, setTermInput] = useState('');
  const termWsRef = useRef(null);
  const termRef = useRef(null);

  // Scale dialog
  const [scaleTarget, setScaleTarget] = useState(null); // { name, kind }
  const [scaleReplicas, setScaleReplicas] = useState(1);

  /* ── Init backend URL ───────────────────── */
  useEffect(() => {
    if (!getBackendUrl() && config) {
      const url = buildBackendUrl(config);
      if (url) setBackendUrl(url);
    }
  }, [config]);

  useEffect(() => {
    checkBackendHealth().then(setHealthy);
  }, []);

  /* ── Data fetching ──────────────────────── */
  const fetchTab = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      let result;
      switch (tab) {
        case 'apps': result = await listApplications(token); break;
        case 'pods': result = await listPods(token); break;
        case 'services': result = await listServices(token); break;
        case 'deployments': result = await listDeployments(token); break;
        case 'configmaps': result = await listConfigMaps(token); break;
        case 'statefulsets': result = await listStatefulSets(token); break;
        case 'nodes': result = await listNodes(token); break;
        default: return;
      }
      setDataCache(prev => ({ ...prev, [tab]: result }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab, token, isAuthenticated]);

  useEffect(() => {
    fetchTab();
  }, [fetchTab]);

  /* ── Actions ────────────────────────────── */
  const flash = (msg) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 4000);
  };

  const handleSync = async (name) => {
    try {
      await syncApplication(name, token);
      flash(`Synced ${name}`);
      fetchTab();
    } catch (err) { flash(`Sync failed: ${err.message}`); }
  };

  const handleRestart = async (name) => {
    try {
      await restartApplication(name, token);
      flash(`Restarted ${name}`);
      fetchTab();
    } catch (err) { flash(`Restart failed: ${err.message}`); }
  };

  const handleDeleteApplication = async (name) => {
    if (!window.confirm(`Delete application ${name}? This is destructive.`)) return;
    try {
      await deleteApplication(name, token);
      flash(`Deleted application ${name}`);
      fetchTab();
    } catch (err) { flash(`Delete failed: ${err.message}`); }
  };

  const handleDeletePod = async (podName) => {
    if (!window.confirm(`Delete pod ${podName}? It will be rescheduled.`)) return;
    try {
      await deletePod(podName, token);
      flash(`Deleted pod ${podName}`);
      fetchTab();
    } catch (err) { flash(`Delete failed: ${err.message}`); }
  };

  const handleScale = async () => {
    if (!scaleTarget) return;
    try {
      const scaleFn = scaleTarget.kind === 'statefulset' ? scaleStatefulSet : scaleDeployment;
      await scaleFn(scaleTarget.name, scaleReplicas, token);
      flash(`Scaled ${scaleTarget.name} to ${scaleReplicas}`);
      setScaleTarget(null);
      fetchTab();
    } catch (err) { flash(`Scale failed: ${err.message}`); }
  };

  const handleRestartDeployment = async (name) => {
    if (!window.confirm(`Restart deployment ${name}?`)) return;
    try {
      await restartDeployment(name, token);
      flash(`Restarted deployment ${name}`);
      fetchTab();
    } catch (err) { flash(`Restart failed: ${err.message}`); }
  };

  const handleDeleteDeployment = async (name) => {
    if (!window.confirm(`Delete deployment ${name}? This is destructive.`)) return;
    try {
      await deleteDeployment(name, token);
      flash(`Deleted deployment ${name}`);
      fetchTab();
    } catch (err) { flash(`Delete failed: ${err.message}`); }
  };

  const handleRestartStatefulSet = async (name) => {
    if (!window.confirm(`Restart statefulset ${name}?`)) return;
    try {
      await restartStatefulSet(name, token);
      flash(`Restarted statefulset ${name}`);
      fetchTab();
    } catch (err) { flash(`Restart failed: ${err.message}`); }
  };

  const handleDeleteStatefulSet = async (name) => {
    if (!window.confirm(`Delete statefulset ${name}? This is destructive.`)) return;
    try {
      await deleteStatefulSet(name, token);
      flash(`Deleted statefulset ${name}`);
      fetchTab();
    } catch (err) { flash(`Delete failed: ${err.message}`); }
  };

  const handleLogs = async (podName) => {
    // Close any existing stream
    if (logsWsRef.current) {
      logsWsRef.current.close();
      logsWsRef.current = null;
    }
    setLogsOpen(podName);
    setLogsLoading(true);
    setLogsText('');
    setLogsStreaming(false);
    try {
      // First fetch existing logs as one-shot
      const result = await getPodLogs(podName, token, { tailLines: 500 });
      const initial = typeof result === 'string' ? result : (result?.logs || JSON.stringify(result, null, 2));
      setLogsText(initial);

      // Then open streaming WebSocket for follow
      try {
        const ws = streamPodLogs(podName, { tailLines: 0 });
        logsWsRef.current = ws;
        ws.onopen = () => setLogsStreaming(true);
        ws.onmessage = (e) => {
          setLogsText(prev => prev + e.data);
        };
        ws.onclose = () => setLogsStreaming(false);
        ws.onerror = () => setLogsStreaming(false);
      } catch {
        // Streaming not available, that's ok — we have the one-shot data
      }
    } catch (err) {
      setLogsText(`Error fetching logs: ${err.message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  const closeLogs = () => {
    if (logsWsRef.current) {
      logsWsRef.current.close();
      logsWsRef.current = null;
    }
    setLogsOpen(null);
    setLogsStreaming(false);
  };

  const handleExec = (podName) => {
    // Close any existing terminal
    if (termWsRef.current) {
      termWsRef.current.close();
      termWsRef.current = null;
    }
    setTermOpen({ podName, mode: 'exec' });
    setTermText('');
    setTermInput('');
    try {
      const ws = execPod(podName);
      termWsRef.current = ws;
      ws.onmessage = (e) => {
        setTermText(prev => prev + e.data);
      };
      ws.onclose = () => {
        setTermText(prev => prev + '\n[session ended]\n');
      };
      ws.onerror = (err) => {
        setTermText(prev => prev + '\n[connection error]\n');
      };
    } catch (err) {
      setTermText(`Error: ${err.message}`);
    }
  };

  const handleAttach = (podName) => {
    if (termWsRef.current) {
      termWsRef.current.close();
      termWsRef.current = null;
    }
    setTermOpen({ podName, mode: 'attach' });
    setTermText('');
    setTermInput('');
    try {
      const ws = attachPod(podName);
      termWsRef.current = ws;
      ws.onmessage = (e) => {
        setTermText(prev => prev + e.data);
      };
      ws.onclose = () => {
        setTermText(prev => prev + '\n[session ended]\n');
      };
      ws.onerror = () => {
        setTermText(prev => prev + '\n[connection error]\n');
      };
    } catch (err) {
      setTermText(`Error: ${err.message}`);
    }
  };

  const closeTerm = () => {
    if (termWsRef.current) {
      termWsRef.current.close();
      termWsRef.current = null;
    }
    setTermOpen(null);
  };

  const sendTermInput = () => {
    if (!termInput || !termWsRef.current || termWsRef.current.readyState !== 1) return;
    termWsRef.current.send(termInput + '\n');
    setTermInput('');
  };

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logsText]);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [termText]);

  // Clean up WebSockets on unmount
  useEffect(() => {
    return () => {
      if (logsWsRef.current) logsWsRef.current.close();
      if (termWsRef.current) termWsRef.current.close();
    };
  }, []);

  /* ── Helpers ────────────────────────────── */
  const data = dataCache[tab] ?? null;
  const items = Array.isArray(data) ? data : (data?.items || []);

  const healthBadge = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'healthy' || s === 'synced' || s === 'running' || s === 'ready' || s === 'true') return 'k8s-badge--ok';
    if (s === 'degraded' || s === 'outofsync' || s === 'pending') return 'k8s-badge--warn';
    if (s === 'missing' || s === 'unknown' || s === 'failed' || s === 'error' || s === 'notready') return 'k8s-badge--err';
    return '';
  };

  /* ── Guard ──────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <div className="k8s-view">
        <div className="tickets-empty">
          <div className="tickets-empty-icon">☸</div>
          <h3>Kubernetes</h3>
          <p>Authenticate with a PAT in Settings to manage cluster resources.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="k8s-view">
      {/* Header */}
      <div className="k8s-header">
        <h2>☸ Kubernetes — {config?.namespace || 'namespace'}</h2>
        <div className="k8s-header-right">
          <span className={`k8s-health ${healthy === true ? 'k8s-health--ok' : healthy === false ? 'k8s-health--err' : ''}`}>
            {healthy === true ? '● Backend OK' : healthy === false ? '○ Backend unreachable' : '… Checking'}
          </span>
          <button className="bl-btn bl-btn--sm" onClick={fetchTab}>↻ Refresh</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="k8s-tabs">
        {TABS.map(t => (
          <button key={t.key}
            className={`k8s-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => { setTab(t.key); setSearch(''); }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="k8s-search-bar">
        <input
          className="k8s-search-input"
          type="text"
          placeholder={tab === 'apps' ? 'Search by name or label…' : 'Search by name…'}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="k8s-search-clear" onClick={() => setSearch('')}>✕</button>
        )}
      </div>

      {actionMsg && <div className="bl-editor-flash bl-editor-flash--ok">{actionMsg}</div>}
      {error && <div className="bl-editor-flash bl-editor-flash--err">{error}</div>}

      {/* Tab content */}
      <div className="k8s-content">
        {loading ? (
          <div className="tickets-loading">⟳ Loading…</div>
        ) : tab === 'apps' ? (
          <AppsTable items={items} search={search} onSync={handleSync} onRestart={handleRestart} onDelete={handleDeleteApplication} healthBadge={healthBadge} />
        ) : tab === 'pods' ? (
          <PodsTable items={items} search={search} onLogs={handleLogs} onExec={handleExec} onAttach={handleAttach} onDelete={handleDeletePod} healthBadge={healthBadge} />
        ) : tab === 'services' ? (
          <ServicesTable items={items} search={search} />
        ) : tab === 'deployments' ? (
          <DeploymentsTable items={items} search={search}
            onScale={(name, cur) => { setScaleTarget({ name, kind: 'deployment' }); setScaleReplicas(cur || 1); }}
            onRestart={handleRestartDeployment}
            onDelete={handleDeleteDeployment}
            healthBadge={healthBadge} />
        ) : tab === 'configmaps' ? (
          <ConfigMapsTable items={items} search={search} />
        ) : tab === 'statefulsets' ? (
          <StatefulSetsTable items={items} search={search}
            onScale={(name, cur) => { setScaleTarget({ name, kind: 'statefulset' }); setScaleReplicas(cur || 1); }}
            onRestart={handleRestartStatefulSet}
            onDelete={handleDeleteStatefulSet}
            healthBadge={healthBadge} />
        ) : tab === 'nodes' ? (
          <NodesTable items={items} search={search} healthBadge={healthBadge} />
        ) : null}
      </div>

      {/* Logs drawer */}
      {logsOpen && (
        <div className="k8s-logs-drawer">
          <div className="k8s-logs-header">
            <span>📜 Logs — {logsOpen} {logsStreaming && <span className="k8s-stream-badge">● streaming</span>}</span>
            <button className="widget-btn" onClick={closeLogs}>✕</button>
          </div>
          <pre className="k8s-logs-body" ref={logsRef}>
            {logsLoading ? '⟳ Loading logs…' : logsText || '(no output)'}
          </pre>
        </div>
      )}

      {/* Exec / Attach terminal drawer */}
      {termOpen && (
        <div className="k8s-logs-drawer k8s-term-drawer">
          <div className="k8s-logs-header">
            <span>{termOpen.mode === 'exec' ? '💻 Exec' : '🔗 Attach'} — {termOpen.podName}</span>
            <button className="widget-btn" onClick={closeTerm}>✕</button>
          </div>
          <pre className="k8s-logs-body k8s-term-body" ref={termRef}>
            {termText || '(connecting…)'}
          </pre>
          <div className="k8s-term-input-bar">
            <input
              className="k8s-term-input"
              type="text"
              value={termInput}
              onChange={e => setTermInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendTermInput(); }}
              placeholder="Type command and press Enter…"
              autoFocus
            />
            <button className="bl-btn bl-btn--xs" onClick={sendTermInput}>⏎</button>
          </div>
        </div>
      )}

      {/* Scale dialog */}
      {scaleTarget && (
        <div className="widget-modal-overlay" onClick={() => setScaleTarget(null)}>
          <div className="widget-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div className="widget-modal-header">
              <span className="widget-title">Scale {scaleTarget.name}</span>
              <button className="widget-btn" onClick={() => setScaleTarget(null)}>✕</button>
            </div>
            <div className="widget-modal-body">
              <div className="bl-tpl-field">
                <label className="bl-tpl-field-label">Replicas</label>
                <input type="number" min={0} max={20} className="settings-input"
                  value={scaleReplicas} onChange={e => setScaleReplicas(Number(e.target.value))} />
              </div>
              <div className="bll-picker-actions">
                <button className="bl-btn bl-btn--sm" onClick={() => setScaleTarget(null)}>Cancel</button>
                <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleScale}>Scale</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sortable table hook ─────────────────────────────────────────────── */

function useSortable(defaultCol = 'name', defaultDir = 'asc') {
  const [sortCol, setSortCol] = useState(defaultCol);
  const [sortDir, setSortDir] = useState(defaultDir);
  const toggle = (col) => {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };
  return { sortCol, sortDir, toggle };
}

function sortItems(items, col, dir, getter) {
  return [...items].sort((a, b) => {
    let va = getter(a, col);
    let vb = getter(b, col);
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function SortHeader({ label, col, sortCol, sortDir, onSort }) {
  const arrow = col === sortCol ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th className="k8s-sortable-th" onClick={() => onSort(col)}>
      {label}{arrow}
    </th>
  );
}

function filterBySearch(items, search, getName) {
  if (!search) return items;
  const q = search.toLowerCase();
  return items.filter(item => (getName(item) || '').toLowerCase().includes(q));
}

/* ── Helper: human-readable resource values ─────────────────────────── */

function humanMem(val) {
  if (!val) return '—';
  if (typeof val === 'number') return `${Math.round(val / 1024 / 1024)} Mi`;
  const s = String(val);
  if (s.endsWith('Ki')) return `${Math.round(parseInt(s) / 1024)} Mi`;
  if (s.endsWith('Mi')) return s;
  if (s.endsWith('Gi')) return s;
  const n = parseInt(s);
  if (!isNaN(n)) return `${Math.round(n / 1024 / 1024)} Mi`;
  return s;
}

function humanCpu(val) {
  if (!val) return '—';
  const s = String(val);
  if (s.endsWith('n')) return `${Math.round(parseInt(s) / 1e6)}m`;
  if (s.endsWith('m')) return s;
  const n = parseFloat(s);
  if (!isNaN(n)) return n < 1 ? `${Math.round(n * 1000)}m` : `${n}`;
  return s;
}

/* ── Sub-tables ─────────────────────────────────────────────────────────── */

function AppsTable({ items, search, onSync, onRestart, onDelete, healthBadge }) {
  const { sortCol, sortDir, toggle } = useSortable('name');
  const getName = (app) => app.metadata?.name || app.name || '';
  const getLabels = (app) => app.metadata?.labels || {};
  const labelsString = (app) => {
    const labels = getLabels(app);
    return Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(' ');
  };
  const getter = (app, col) => {
    if (col === 'name') return getName(app);
    if (col === 'health') return app.status?.health?.status || app.health || '';
    if (col === 'sync') return app.status?.sync?.status || app.sync || '';
    if (col === 'labels') return labelsString(app);
    if (col === 'repo') return app.spec?.source?.repoURL || app.repo || '';
    return '';
  };
  // Search on name AND labels
  const matchSearch = (app) => {
    if (!search) return true;
    const q = search.toLowerCase();
    if ((getName(app) || '').toLowerCase().includes(q)) return true;
    if (labelsString(app).toLowerCase().includes(q)) return true;
    return false;
  };
  const filtered = sortItems(items.filter(matchSearch), sortCol, sortDir, getter);
  if (!filtered.length) return <div className="tickets-empty-list">No applications found.</div>;
  return (
    <table className="k8s-table">
      <thead>
        <tr>
          <SortHeader label="Name" col="name" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Health" col="health" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Sync" col="sync" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Labels" col="labels" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Repo" col="repo" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map(app => {
          const name = getName(app);
          const health = getter(app, 'health');
          const sync = getter(app, 'sync');
          const labels = getLabels(app);
          const repo = getter(app, 'repo');
          return (
            <tr key={name}>
              <td className="k8s-cell-name">{name}</td>
              <td><span className={`k8s-badge ${healthBadge(health)}`}>{health}</span></td>
              <td><span className={`k8s-badge ${healthBadge(sync)}`}>{sync}</span></td>
              <td className="k8s-cell-labels">
                {Object.entries(labels).map(([k, v]) => (
                  <span key={k} className="k8s-label-pill" title={`${k}=${v}`}>{k.split('/').pop()}={v}</span>
                ))}
              </td>
              <td className="k8s-cell-url">{repo}</td>
              <td className="k8s-cell-actions">
                <button className="bl-btn bl-btn--xs" onClick={() => onSync(name)} title="Sync">🔄</button>
                <button className="bl-btn bl-btn--xs" onClick={() => onRestart(name)} title="Restart">♻</button>
                <button className="bl-btn bl-btn--xs bl-btn--danger" onClick={() => onDelete(name)} title="Delete">🗑</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PodsTable({ items, search, onLogs, onExec, onAttach, onDelete, healthBadge }) {
  const { sortCol, sortDir, toggle } = useSortable('name');
  const getName = (pod) => pod.metadata?.name || pod.name || '';
  const getter = (pod, col) => {
    if (col === 'name') return getName(pod);
    if (col === 'status') return pod.status?.phase || pod.phase || '';
    if (col === 'restarts') return pod.status?.containerStatuses?.[0]?.restartCount ?? 0;
    if (col === 'node') return pod.spec?.nodeName || '';
    if (col === 'cpu') {
      const req = pod.spec?.containers?.[0]?.resources?.requests?.cpu || '';
      return req;
    }
    if (col === 'memory') {
      const req = pod.spec?.containers?.[0]?.resources?.requests?.memory || '';
      return req;
    }
    if (col === 'age') return pod.metadata?.creationTimestamp || '';
    return '';
  };
  const filtered = sortItems(filterBySearch(items, search, getName), sortCol, sortDir, getter);
  if (!filtered.length) return <div className="tickets-empty-list">No pods found.</div>;
  return (
    <table className="k8s-table">
      <thead>
        <tr>
          <SortHeader label="Pod" col="name" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Status" col="status" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Restarts" col="restarts" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Node" col="node" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="CPU Req" col="cpu" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Mem Req" col="memory" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Age" col="age" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map(pod => {
          const name = getName(pod);
          const phase = getter(pod, 'status');
          const restarts = getter(pod, 'restarts');
          const node = getter(pod, 'node');
          const cpuReq = getter(pod, 'cpu');
          const memReq = getter(pod, 'memory');
          const started = getter(pod, 'age');
          return (
            <tr key={name}>
              <td className="k8s-cell-name">{name}</td>
              <td><span className={`k8s-badge ${healthBadge(phase)}`}>{phase}</span></td>
              <td>{restarts}</td>
              <td className="k8s-cell-node">{node}</td>
              <td>{humanCpu(cpuReq)}</td>
              <td>{humanMem(memReq)}</td>
              <td>{started ? new Date(started).toLocaleString() : ''}</td>
              <td className="k8s-cell-actions">
                <button className="bl-btn bl-btn--xs" onClick={() => onLogs(name)} title="View Logs">📜</button>
                <button className="bl-btn bl-btn--xs" onClick={() => onExec(name)} title="Exec Shell">💻</button>
                <button className="bl-btn bl-btn--xs" onClick={() => onAttach(name)} title="Attach">🔗</button>
                <button className="bl-btn bl-btn--xs bl-btn--danger" onClick={() => onDelete(name)} title="Delete">🗑</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DeploymentsTable({ items, search, onScale, onRestart, onDelete, healthBadge }) {
  const { sortCol, sortDir, toggle } = useSortable('name');
  const getName = (dep) => dep.metadata?.name || dep.name || '';
  const getter = (dep, col) => {
    if (col === 'name') return getName(dep);
    if (col === 'replicas') return dep.status?.replicas ?? dep.spec?.replicas ?? 0;
    if (col === 'ready') return dep.status?.readyReplicas ?? 0;
    if (col === 'updated') return dep.status?.updatedReplicas ?? 0;
    if (col === 'image') return dep.spec?.template?.spec?.containers?.[0]?.image || '';
    return '';
  };
  const filtered = sortItems(filterBySearch(items, search, getName), sortCol, sortDir, getter);
  if (!filtered.length) return <div className="tickets-empty-list">No deployments found.</div>;
  return (
    <table className="k8s-table">
      <thead>
        <tr>
          <SortHeader label="Deployment" col="name" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Replicas" col="replicas" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Ready" col="ready" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Updated" col="updated" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Image" col="image" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map(dep => {
          const name = getName(dep);
          const replicas = getter(dep, 'replicas');
          const ready = getter(dep, 'ready');
          const updated = getter(dep, 'updated');
          const image = getter(dep, 'image');
          return (
            <tr key={name}>
              <td className="k8s-cell-name">{name}</td>
              <td>{replicas}</td>
              <td><span className={`k8s-badge ${ready === replicas ? 'k8s-badge--ok' : 'k8s-badge--warn'}`}>{ready}/{replicas}</span></td>
              <td>{updated}</td>
              <td className="k8s-cell-url">{image}</td>
              <td className="k8s-cell-actions">
                <button className="bl-btn bl-btn--xs" onClick={() => onScale(name, replicas)} title="Scale">⚖</button>
                <button className="bl-btn bl-btn--xs" onClick={() => onRestart(name)} title="Restart">♻</button>
                <button className="bl-btn bl-btn--xs bl-btn--danger" onClick={() => onDelete(name)} title="Delete">🗑</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatefulSetsTable({ items, search, onScale, onRestart, onDelete, healthBadge }) {
  const { sortCol, sortDir, toggle } = useSortable('name');
  const getName = (ss) => ss.metadata?.name || ss.name || '';
  const getter = (ss, col) => {
    if (col === 'name') return getName(ss);
    if (col === 'replicas') return ss.status?.replicas ?? ss.spec?.replicas ?? 0;
    if (col === 'ready') return ss.status?.readyReplicas ?? 0;
    if (col === 'image') return ss.spec?.template?.spec?.containers?.[0]?.image || '';
    return '';
  };
  const filtered = sortItems(filterBySearch(items, search, getName), sortCol, sortDir, getter);
  if (!filtered.length) return <div className="tickets-empty-list">No statefulsets found.</div>;
  return (
    <table className="k8s-table">
      <thead>
        <tr>
          <SortHeader label="StatefulSet" col="name" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Replicas" col="replicas" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Ready" col="ready" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Image" col="image" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map(ss => {
          const name = getName(ss);
          const replicas = getter(ss, 'replicas');
          const ready = getter(ss, 'ready');
          const image = getter(ss, 'image');
          return (
            <tr key={name}>
              <td className="k8s-cell-name">{name}</td>
              <td>{replicas}</td>
              <td><span className={`k8s-badge ${ready === replicas ? 'k8s-badge--ok' : 'k8s-badge--warn'}`}>{ready}/{replicas}</span></td>
              <td className="k8s-cell-url">{image}</td>
              <td className="k8s-cell-actions">
                <button className="bl-btn bl-btn--xs" onClick={() => onScale(name, replicas)} title="Scale">⚖</button>
                <button className="bl-btn bl-btn--xs" onClick={() => onRestart(name)} title="Restart">♻</button>
                <button className="bl-btn bl-btn--xs bl-btn--danger" onClick={() => onDelete(name)} title="Delete">🗑</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ServicesTable({ items, search }) {
  const { sortCol, sortDir, toggle } = useSortable('name');
  const getName = (svc) => svc.metadata?.name || svc.name || '';
  const getter = (svc, col) => {
    if (col === 'name') return getName(svc);
    if (col === 'type') return svc.spec?.type || '';
    if (col === 'clusterIP') return svc.spec?.clusterIP || '';
    if (col === 'ports') {
      const ports = svc.spec?.ports || [];
      return ports.map(p => `${p.port}${p.targetPort ? ':' + p.targetPort : ''}/${p.protocol || 'TCP'}`).join(', ');
    }
    return '';
  };
  const filtered = sortItems(filterBySearch(items, search, getName), sortCol, sortDir, getter);
  if (!filtered.length) return <div className="tickets-empty-list">No services found.</div>;
  return (
    <table className="k8s-table">
      <thead>
        <tr>
          <SortHeader label="Name" col="name" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Type" col="type" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Cluster IP" col="clusterIP" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Ports" col="ports" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
        </tr>
      </thead>
      <tbody>
        {filtered.map(svc => (
          <tr key={getName(svc)}>
            <td className="k8s-cell-name">{getName(svc)}</td>
            <td>{getter(svc, 'type')}</td>
            <td>{getter(svc, 'clusterIP')}</td>
            <td>{getter(svc, 'ports')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConfigMapsTable({ items, search }) {
  const { sortCol, sortDir, toggle } = useSortable('name');
  const getName = (cm) => cm.metadata?.name || cm.name || '';
  const getter = (cm, col) => {
    if (col === 'name') return getName(cm);
    if (col === 'keys') {
      const keys = Object.keys(cm.data || {});
      return keys.join(', ') || '—';
    }
    if (col === 'age') return cm.metadata?.creationTimestamp || '';
    return '';
  };
  const filtered = sortItems(filterBySearch(items, search, getName), sortCol, sortDir, getter);
  if (!filtered.length) return <div className="tickets-empty-list">No configmaps found.</div>;
  return (
    <table className="k8s-table">
      <thead>
        <tr>
          <SortHeader label="Name" col="name" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Keys" col="keys" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Age" col="age" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
        </tr>
      </thead>
      <tbody>
        {filtered.map(cm => (
          <tr key={getName(cm)}>
            <td className="k8s-cell-name">{getName(cm)}</td>
            <td>{getter(cm, 'keys')}</td>
            <td>{getter(cm, 'age') ? new Date(getter(cm, 'age')).toLocaleString() : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NodesTable({ items, search, healthBadge }) {
  const { sortCol, sortDir, toggle } = useSortable('name');
  const getter = (n, col) => {
    if (col === 'name') return n.name || '';
    if (col === 'status') return n.status || '';
    if (col === 'roles') return (n.roles || []).join(', ');
    if (col === 'ip') return n.internalIP || '';
    if (col === 'cpuCap') return n.capacity?.cpu || '';
    if (col === 'memCap') return n.capacity?.memory || '';
    if (col === 'cpuUsage') return n.usage?.cpu || '';
    if (col === 'memUsage') return n.usage?.memory || '';
    if (col === 'pods') return n.namespacePods?.length ?? 0;
    if (col === 'version') return n.kubeletVersion || '';
    return '';
  };
  const getName = (n) => n.name || '';
  const filtered = sortItems(filterBySearch(items, search, getName), sortCol, sortDir, getter);
  if (!filtered.length) return <div className="tickets-empty-list">No nodes found.</div>;
  return (
    <table className="k8s-table">
      <thead>
        <tr>
          <SortHeader label="Node" col="name" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Status" col="status" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Roles" col="roles" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="IP" col="ip" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="CPU Cap" col="cpuCap" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Mem Cap" col="memCap" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="CPU Used" col="cpuUsage" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Mem Used" col="memUsage" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="NS Pods" col="pods" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
          <SortHeader label="Version" col="version" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
        </tr>
      </thead>
      <tbody>
        {filtered.map(n => (
          <tr key={n.name}>
            <td className="k8s-cell-name">{n.name}</td>
            <td><span className={`k8s-badge ${healthBadge(n.status)}`}>{n.status}</span></td>
            <td>{(n.roles || []).join(', ') || '—'}</td>
            <td>{n.internalIP}</td>
            <td>{n.capacity?.cpu || '—'}</td>
            <td>{humanMem(n.capacity?.memory)}</td>
            <td>{humanCpu(n.usage?.cpu)}</td>
            <td>{humanMem(n.usage?.memory)}</td>
            <td title={(n.namespacePods || []).join('\n')}>
              {n.namespacePods?.length ?? 0}
            </td>
            <td>{n.kubeletVersion}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
