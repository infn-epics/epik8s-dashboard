/**
 * BeamlineControllerView — Interface to monitor/control beamline controller tasks.
 *
 * Features:
 *   - Real-time task status via PVWS subscriptions
 *   - Enable/disable and trigger controls
 *   - Input/output PV monitors
 *   - Task configuration viewer
 *   - Wizard to create new tasks (opens TaskJobWizard)
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import yaml from 'js-yaml';
import { useApp } from '../../context/AppContext.jsx';
import { usePv } from '../../hooks/usePv.js';
import {
  findControllerInConfig,
  buildControllerApiUrl,
  getControllerConfig,
  setControllerConfig,
  fetchControllerConfig,
  setControllerConfigUrl,
  buildTaskPvName,
  getBuiltinPvNames,
  statusLabel,
  statusColor,
  deployPlugin,
  restartPlugin,
  fetchControllerHealth,
  listControllerTasks,
  listControllerJobs,
  fetchControllerTaskStartup,
  fetchControllerJobStartup,
  runControllerJob,
  getControllerPlugin,
  removeControllerPlugin,
  generateFullConfigYaml,
  generateTaskPython,
} from '../../services/beamlineControllerApi.js';
import { parseGitUrl, commitFile } from '../../services/gitApi.js';
import TaskJobWizard from '../common/TaskJobWizard.jsx';
import ImportTaskDialog from '../common/ImportTaskDialog.jsx';
import JobContextMenu from '../JobContextMenu.jsx';

export default function BeamlineControllerView() {
  const { config, pvwsClient } = useApp();

  // Controller info from values.yaml
  const controllerInfo = useMemo(() => findControllerInConfig(config), [config]);
  const defaultPrefix = controllerInfo?.prefix || 'BEAMLINE:CONTROL';
  const defaultGitUrl = config?.giturl || '';

  // State
  const [controllerConfig, setCtrlConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [configUrl, setConfigUrl] = useState('');
  const [manualYaml, setManualYaml] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [controllerApiUrl, setApiUrl] = useState('');
  const [serviceState, setServiceState] = useState({
    loading: false,
    error: null,
    health: null,
    tasks: [],
    jobs: [],
    updatedAt: null,
  });
  const [taskSources, setTaskSources] = useState({});
  const [showRunFromGit, setShowRunFromGit] = useState(false);

  // Try to load config on mount
  useEffect(() => {
    const existing = getControllerConfig();
    if (existing) setCtrlConfig(existing);
  }, []);

  useEffect(() => {
    if (controllerApiUrl) return;
    const autoUrl = buildControllerApiUrl(config);
    if (autoUrl) setApiUrl(autoUrl);
  }, [config, controllerApiUrl]);

  const refreshControllerService = useCallback(async () => {
    if (!controllerApiUrl) {
      setServiceState((prev) => ({
        ...prev,
        loading: false,
        error: null,
        health: null,
        tasks: [],
        jobs: [],
      }));
      return;
    }

    setServiceState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [health, tasksResp, jobsResp] = await Promise.all([
        fetchControllerHealth(controllerApiUrl),
        listControllerTasks(controllerApiUrl),
        listControllerJobs(controllerApiUrl),
      ]);
      setServiceState({
        loading: false,
        error: null,
        health,
        tasks: tasksResp?.plugins || [],
        jobs: jobsResp?.plugins || [],
        updatedAt: new Date(),
      });
    } catch (err) {
      setServiceState((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to load controller service status',
      }));
    }
  }, [controllerApiUrl]);

  useEffect(() => {
    let intervalId = null;
    refreshControllerService();
    if (controllerApiUrl) {
      intervalId = window.setInterval(refreshControllerService, 10000);
    }
    return () => {
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [controllerApiUrl, refreshControllerService]);

  const handleFetchConfig = useCallback(async () => {
    if (!configUrl) return;
    setLoading(true);
    setError(null);
    try {
      setControllerConfigUrl(configUrl);
      const cfg = await fetchControllerConfig();
      setCtrlConfig(cfg);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [configUrl]);

  const handlePasteConfig = useCallback(() => {
    if (!manualYaml.trim()) return;
    setError(null);
    try {
      const raw = yaml.load(manualYaml);
      const cfg = setControllerConfig(raw);
      setCtrlConfig(cfg);
      setShowConfigPanel(false);
    } catch (err) {
      setError(`Invalid YAML: ${err.message}`);
    }
  }, [manualYaml]);

  const prefix = controllerConfig?.prefix || defaultPrefix;
  const tasks = controllerConfig?.tasks || [];

  return (
    <div className="bc-view">
      <div className="view-toolbar">
        <span className="view-toolbar-title">🎛 Beamline Controller</span>
        <span className="bc-prefix-badge">PV Prefix: {prefix}</span>
        <div className="bc-toolbar-actions">
          <button
            className={`toolbar-btn ${showConfigPanel ? 'active' : ''}`}
            onClick={() => setShowConfigPanel((s) => !s)}
          >
            ⚙ Config
          </button>
          <button className="toolbar-btn" onClick={() => setShowImport(true)}>
            📂 Import Task
          </button>
          <button className="toolbar-btn" onClick={() => setShowRunFromGit(true)}>
            🔗 Run from Git
          </button>
          <button className="toolbar-btn active" onClick={() => setShowWizard(true)}>
            ✨ New Task
          </button>
        </div>
      </div>

      {error && <div className="bc-error">{error}</div>}

      <ControllerServicePanel
        serviceState={serviceState}
        apiUrl={controllerApiUrl}
        controllerApiUrl={controllerApiUrl}
        configuredTaskCount={tasks.length}
        pvwsClient={pvwsClient}
        onRefresh={refreshControllerService}
      />

      {/* Config panel */}
      {showConfigPanel && (
        <div className="bc-config-panel">
          <h4>Load Controller Configuration</h4>
          <div className="bc-config-row">
            <label>Config URL:</label>
            <input
              type="text"
              value={configUrl}
              onChange={(e) => setConfigUrl(e.target.value)}
              placeholder="https://host/controller-config.yaml"
            />
            <button className="toolbar-btn" onClick={handleFetchConfig} disabled={loading}>
              {loading ? '⏳' : '📥'} Fetch
            </button>
          </div>
          <div className="bc-config-row">
            <label>Controller API:</label>
            <input
              type="text"
              value={controllerApiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://beamline-controller:8080"
            />
          </div>
          <div className="bc-config-divider">— or paste YAML —</div>
          <textarea
            className="bc-config-textarea"
            value={manualYaml}
            onChange={(e) => setManualYaml(e.target.value)}
            rows={10}
            placeholder={`prefix: SPARC:CONTROL\ntasks:\n  - name: "my_task"\n    module: "my_task"\n    parameters:\n      update_rate: 1.0\n    pvs:\n      inputs: ...\n      outputs: ...`}
          />
          <button className="toolbar-btn active" onClick={handlePasteConfig}>
            📋 Load YAML
          </button>
        </div>
      )}

      {/* Task list */}
      {tasks.length === 0 && !showConfigPanel && (
        <div className="bc-empty">
          <p>No tasks configured.</p>
          <p>Load a controller configuration using the ⚙ Config button, or create a new task with ✨ New Task.</p>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="bc-task-grid">
          {tasks.map((task) => (
            <TaskCard
              key={task.name}
              task={task}
              prefix={prefix}
              pvwsClient={pvwsClient}
              selected={selectedTask === task.name}
              onSelect={() =>
                setSelectedTask((prev) => (prev === task.name ? null : task.name))
              }
            />
          ))}
        </div>
      )}

      {/* Task detail panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={tasks.find((t) => t.name === selectedTask)}
          prefix={prefix}
          pvwsClient={pvwsClient}
          taskSources={taskSources}
          setTaskSources={setTaskSources}
          controllerApiUrl={controllerApiUrl}
          defaultGitUrl={defaultGitUrl}
        />
      )}

      {/* Wizard modal */}
      {showWizard && (
        <TaskJobWizard
          prefix={prefix}
          controllerApiUrl={controllerApiUrl}
          defaultGitUrl={defaultGitUrl}
          onClose={() => setShowWizard(false)}
          onCreated={(taskDef) => {
            // Add to local config
            const newTasks = [...tasks, taskDef];
            const cfg = { prefix, tasks: newTasks, raw: controllerConfig?.raw };
            setControllerConfig({ prefix, tasks: newTasks });
            setCtrlConfig({ prefix, tasks: newTasks, raw: cfg.raw });
            setShowWizard(false);
          }}
        />
      )}

      {/* Import dialog */}
      {showImport && (
        <ImportTaskDialog
          onClose={() => setShowImport(false)}
          onImport={(taskDef, parsedConfig, sources) => {
            const newTasks = [...tasks, taskDef];
            setControllerConfig({ prefix, tasks: newTasks });
            setCtrlConfig({ prefix, tasks: newTasks, raw: controllerConfig?.raw });
            if (sources) {
              setTaskSources(prev => ({
                ...prev,
                [taskDef.name]: { configYaml: sources.configYaml || '', pythonCode: sources.pythonCode || '', git: {} }
              }));
            }
          }}
        />
      )}

      {/* Run from Git dialog */}
      {showRunFromGit && (
        <RunFromGitDialog
          controllerApiUrl={controllerApiUrl}
          defaultGitUrl={defaultGitUrl}
          onClose={() => setShowRunFromGit(false)}
          onDeployed={() => setShowRunFromGit(false)}
        />
      )}
    </div>
  );
}

function ControllerServicePanel({ serviceState, apiUrl, controllerApiUrl, configuredTaskCount, pvwsClient, onRefresh }) {
  const taskRunningCount = (serviceState.tasks || []).filter((t) => t.running).length;
  const taskAvailableCount = (serviceState.tasks || []).filter((t) => t.status === 'available').length;
  const taskInvalidCount = (serviceState.tasks || []).filter((t) => t.status === 'invalid').length;
  const jobAvailableCount = (serviceState.jobs || []).filter((j) => j.status === 'available').length;
  const jobInvalidCount = (serviceState.jobs || []).filter((j) => j.status === 'invalid').length;
  const healthOk = serviceState.health?.status === 'ok';
  const [selectedPlugin, setSelectedPlugin] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [pendingAction, setPendingAction] = useState('');

  useEffect(() => {
    if (!selectedPlugin) return;
    const pool = selectedPlugin.type === 'task' ? serviceState.tasks : serviceState.jobs;
    const exists = (pool || []).some((p) => p.name === selectedPlugin.name);
    if (!exists) {
      setSelectedPlugin(null);
    }
  }, [selectedPlugin, serviceState.tasks, serviceState.jobs]);

  const selectedData = useMemo(() => {
    if (!selectedPlugin) return null;
    const pool = selectedPlugin.type === 'task' ? serviceState.tasks : serviceState.jobs;
    return (pool || []).find((p) => p.name === selectedPlugin.name) || null;
  }, [selectedPlugin, serviceState.tasks, serviceState.jobs]);

  const handleContextMenu = useCallback((e, pluginType, name) => {
    e.preventDefault();
    const pool = pluginType === 'task' ? serviceState.tasks : serviceState.jobs;
    const plugin = (pool || []).find((p) => p.name === name);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      item: { 
        type: pluginType, 
        name, 
        status: plugin?.status || 'loaded',
        running: plugin?.running || false,
      },
    });
  }, [serviceState.tasks, serviceState.jobs]);

  const handleViewDetails = useCallback((name) => {
    const pool = contextMenu.item.type === 'task' ? serviceState.tasks : serviceState.jobs;
    const plugin = (pool || []).find((p) => p.name === name);
    if (plugin) {
      setSelectedPlugin({ type: contextMenu.item.type, name });
    }
  }, [contextMenu, serviceState.tasks, serviceState.jobs]);

  const handleRemovePlugin = useCallback(async (name) => {
    if (!controllerApiUrl) return;
    setPendingAction(`Removing ${name}...`);
    try {
      await removeControllerPlugin(controllerApiUrl, name);
      setPendingAction(`Removed ${name}`);
      setTimeout(() => onRefresh(), 500);
    } catch (err) {
      setPendingAction(`Failed to remove: ${err.message}`);
    }
  }, [controllerApiUrl, onRefresh]);

  const handleRunPlugin = useCallback(async (name) => {
    if (!controllerApiUrl) return;
    setPendingAction(`Running ${name}...`);
    try {
      const result = await runControllerJob(controllerApiUrl, name);
      setPendingAction(`Run completed: ${result?.result?.message || 'success'}`);
    } catch (err) {
      setPendingAction(`Run failed: ${err.message}`);
    }
  }, [controllerApiUrl]);

  const handleDeployPlugin = useCallback(async (name) => {
    if (!controllerApiUrl) return;
    setPendingAction(`Deploying ${name}...`);
    try {
      // Get plugin details first to find git_url, branch, etc.
      const pluginDetails = await getControllerPlugin(controllerApiUrl, name);
      const deployParams = {
        name,
        git_url: pluginDetails.git_url || '',
        branch: pluginDetails.branch || 'main',
        path: pluginDetails.path || '',
        auto_start: true,
      };
      
      // First deployment call
      const result = await deployPlugin(controllerApiUrl, deployParams);
      
      // Give it a moment to process, then verify it actually loaded
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      try {
        const statusCheck = await getControllerPlugin(controllerApiUrl, name);
        // If still available (not loaded), make the load call again
        if (statusCheck?.status === 'available') {
          setPendingAction(`Loading ${name} into service...`);
          await deployPlugin(controllerApiUrl, deployParams);
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      } catch (err) {
        // Status check failed, assume it's loading
      }
      
      const finalStatus = await getControllerPlugin(controllerApiUrl, name);
      if (finalStatus?.status === 'available') {
        throw new Error(`Controller kept ${name} in available state`);
      }

      setPendingAction(`✓ ${name} deployed and loaded successfully`);
      setTimeout(() => onRefresh(), 1000);
    } catch (err) {
      setPendingAction(`Deploy failed: ${err.message}`);
    }
  }, [controllerApiUrl, onRefresh]);

  const handleRestartPlugin = useCallback(async (name) => {
    if (!controllerApiUrl) return;
    setPendingAction(`Restarting ${name}...`);
    try {
      const result = await restartPlugin(controllerApiUrl, name);
      setPendingAction(`Restarted ${name} successfully`);
      setTimeout(() => onRefresh(), 800);
    } catch (err) {
      setPendingAction(`Restart failed: ${err.message}`);
    }
  }, [controllerApiUrl, onRefresh]);

  return (
    <div className="bc-service-panel">
      <div className="bc-service-header">
        <h4>Controller Service</h4>
        <div className="bc-service-actions">
          <span className={`bc-service-health ${healthOk ? 'ok' : 'down'}`}>
            {healthOk ? 'ONLINE' : apiUrl ? 'UNREACHABLE' : 'NOT CONFIGURED'}
          </span>
          <button className="toolbar-btn" onClick={onRefresh} disabled={serviceState.loading}>
            {serviceState.loading ? '⏳' : '↻'} Refresh
          </button>
        </div>
      </div>

      <div className="bc-service-url">{apiUrl || 'Set Controller API URL in Config panel'}</div>

      {serviceState.error && <div className="bc-error">{serviceState.error}</div>}

      <div className="bc-service-stats">
        <div className="bc-service-stat"><span>Configured tasks (UI)</span><strong>{configuredTaskCount}</strong></div>
        <div className="bc-service-stat"><span>Loaded tasks (service)</span><strong>{serviceState.tasks.length}</strong></div>
        <div className="bc-service-stat"><span>Running tasks</span><strong>{taskRunningCount}</strong></div>
        <div className="bc-service-stat"><span>Available tasks (disk)</span><strong>{taskAvailableCount}</strong></div>
        <div className="bc-service-stat"><span>Invalid tasks (disk)</span><strong>{taskInvalidCount}</strong></div>
        <div className="bc-service-stat"><span>Loaded jobs</span><strong>{serviceState.jobs.length}</strong></div>
        <div className="bc-service-stat"><span>Available jobs (disk)</span><strong>{jobAvailableCount}</strong></div>
        <div className="bc-service-stat"><span>Invalid jobs (disk)</span><strong>{jobInvalidCount}</strong></div>
        <div className="bc-service-stat"><span>Service version</span><strong>{serviceState.health?.version || '—'}</strong></div>
      </div>

      <div className="bc-service-lists">
        <div className="bc-service-list">
          <h5>Tasks in Service</h5>
          {(serviceState.tasks || []).length === 0 ? (
            <div className="bc-service-empty">No tasks loaded</div>
          ) : (
            <ul>
              {serviceState.tasks.map((t) => (
                <li key={t.name}>
                  <button
                    className={`bc-service-item ${selectedPlugin?.type === 'task' && selectedPlugin?.name === t.name ? 'active' : ''}`}
                    onClick={() => setSelectedPlugin({ type: 'task', name: t.name })}
                    onContextMenu={(e) => handleContextMenu(e, 'task', t.name)}
                  >
                    <span className="name">{t.name}</span>
                    <span className={`status ${serviceStatusClass(t)}`}>{serviceStatusLabel(t)}</span>
                    <span className="meta">{t.status || 'loaded'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bc-service-list">
          <h5>Jobs in Service</h5>
          {(serviceState.jobs || []).length === 0 ? (
            <div className="bc-service-empty">No jobs loaded</div>
          ) : (
            <ul>
              {serviceState.jobs.map((j) => (
                <li key={j.name}>
                  <button
                    className={`bc-service-item ${selectedPlugin?.type === 'job' && selectedPlugin?.name === j.name ? 'active' : ''}`}
                    onClick={() => setSelectedPlugin({ type: 'job', name: j.name })}
                    onContextMenu={(e) => handleContextMenu(e, 'job', j.name)}
                  >
                    <span className="name">{j.name}</span>
                    <span className={`status ${serviceStatusClass(j)}`}>{serviceStatusLabel(j)}</span>
                    <span className="meta">{j.status || 'loaded'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {selectedData && (
        <ServicePluginDetailPanel
          plugin={selectedData}
          pluginType={selectedPlugin?.type || selectedData.plugin_type}
          pvwsClient={pvwsClient}
          controllerApiUrl={controllerApiUrl}
        />
      )}

      {pendingAction && (
        <div className="bc-service-msg">{pendingAction}</div>
      )}

      {contextMenu && (
        <JobContextMenu
          item={contextMenu.item}
          x={contextMenu.x}
          y={contextMenu.y}
          onViewDetails={handleViewDetails}
          onDeploy={handleDeployPlugin}
          onRestart={handleRestartPlugin}
          onRun={handleRunPlugin}
          onRemove={handleRemovePlugin}
          onClose={() => setContextMenu(null)}
        />
      )}

      {serviceState.updatedAt && (
        <div className="bc-service-updated">Updated: {serviceState.updatedAt.toLocaleTimeString()}</div>
      )}
    </div>
  );
}

function buildServicePvName(pvPrefix, pvName) {
  if (!pvPrefix || !pvName) return null;
  return `${pvPrefix}:${pvName}`;
}

async function copyPvToClipboard(pvName) {
  if (!pvName || !navigator?.clipboard?.writeText) return;
  try {
    await navigator.clipboard.writeText(pvName);
  } catch (err) {
    // Best-effort copy only.
  }
}

function pvHintProps(pvName) {
  return pvName
    ? {
        title: `PV: ${pvName} (right-click to copy)`,
        onContextMenu: (e) => {
          e.preventDefault();
          copyPvToClipboard(pvName);
        },
      }
    : {};
}

function serviceStatusLabel(plugin) {
  if (!plugin) return 'UNKNOWN';
  if (plugin.running) return 'RUNNING';
  if (plugin.status === 'available') return 'AVAILABLE';
  if (plugin.status === 'invalid') return 'INVALID';
  if (plugin.status === 'error') return 'ERROR';
  if (plugin.status === 'stopped') return 'STOPPED';
  return 'LOADED';
}

function serviceStatusClass(plugin) {
  const label = serviceStatusLabel(plugin);
  if (label === 'RUNNING') return 'run';
  if (label === 'AVAILABLE') return 'avail';
  if (label === 'INVALID' || label === 'ERROR') return 'err';
  if (label === 'STOPPED') return 'stop';
  return 'idle';
}

const BASE_CONTROL_PV_TYPES = {
  ENABLE: 'bool',
  STATUS: 'int',
  MESSAGE: 'string',
  CYCLE_COUNT: 'int',
  RUN: 'bool',
};

function defaultBaseControls(pluginType, mode) {
  if (pluginType === 'task') {
    const controls = ['ENABLE', 'STATUS', 'MESSAGE'];
    controls.push(mode === 'triggered' ? 'RUN' : 'CYCLE_COUNT');
    return controls;
  }
  return ['STATUS', 'MESSAGE'];
}

function ServicePluginDetailPanel({ plugin, pluginType, pvwsClient, controllerApiUrl }) {
  const [startupInfo, setStartupInfo] = useState(null);
  const [startupError, setStartupError] = useState('');
  const [jobRunStatus, setJobRunStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadStartup() {
      if (!controllerApiUrl || !plugin?.name) {
        setStartupInfo(null);
        setStartupError('');
        return;
      }
      const hasInlineStartup = plugin.start_parameters || plugin.pv_definitions || plugin.built_pvs;
      if (hasInlineStartup) {
        setStartupInfo(null);
        setStartupError('');
        return;
      }
      try {
        const data = pluginType === 'job'
          ? await fetchControllerJobStartup(controllerApiUrl, plugin.name)
          : await fetchControllerTaskStartup(controllerApiUrl, plugin.name);
        if (!cancelled) {
          setStartupInfo(data);
          setStartupError('');
        }
      } catch (err) {
        if (!cancelled) {
          setStartupInfo(null);
          setStartupError(err.message || 'Unable to load startup metadata');
        }
      }
    }
    loadStartup();
    return () => {
      cancelled = true;
    };
  }, [controllerApiUrl, plugin?.name, plugin?.built_pvs, plugin?.pv_definitions, plugin?.start_parameters, pluginType]);

  const merged = startupInfo || plugin;
  const mode = merged.mode || merged.start_parameters?.mode || 'continuous';
  const baseControls = merged.base_control_pvs || defaultBaseControls(pluginType, mode);
  const pvPrefix = merged.pv_prefix || plugin.pv_prefix;
  const inputDefs = merged.pv_definitions?.inputs || {};
  const outputDefs = merged.pv_definitions?.outputs || {};
  const params = merged.start_parameters || {};

  const handleRunJob = async () => {
    if (!controllerApiUrl) {
      setJobRunStatus('Controller API URL not configured');
      return;
    }
    setJobRunStatus('Running...');
    try {
      const result = await runControllerJob(controllerApiUrl, plugin.name);
      setJobRunStatus(result?.result?.message || 'Run completed');
    } catch (err) {
      setJobRunStatus(err.message || 'Run failed');
    }
  };

  return (
    <div className="bc-service-detail">
      <div className="bc-service-detail-head">
        <h5>{pluginType === 'job' ? 'Job' : 'Task'} Details: {plugin.name}</h5>
        {pluginType === 'job' && (
          <button className="bc-pv-btn" onClick={handleRunJob}>Run Job</button>
        )}
      </div>

      {jobRunStatus && <div className="bc-service-msg">{jobRunStatus}</div>}
      {startupError && <div className="bc-service-msg bc-service-msg--error">{startupError}</div>}

      <div className="bc-service-config-grid">
        <div><span className="k">Class</span><span className="v">{plugin.class_name || '—'}</span></div>
        <div><span className="k">Branch</span><span className="v">{plugin.branch || 'main'}</span></div>
        <div><span className="k">Plugin Path</span><span className="v">{plugin.path || '(root)'}</span></div>
        <div><span className="k">Plugin Prefix</span><span className="v">{merged.plugin_prefix || plugin.plugin_prefix || '—'}</span></div>
        <div><span className="k">PV Prefix</span><span className="v">{pvPrefix || '—'}</span></div>
        <div><span className="k">State</span><span className="v">{serviceStatusLabel(plugin)}</span></div>
      </div>

      {plugin.validation?.errors?.length > 0 && (
        <div className="bc-detail-section">
          <h4>Validation Errors</h4>
          <div className="bc-service-validation-list">
            {plugin.validation.errors.map((err, idx) => (
              <div key={`${plugin.name}-validation-${idx}`} className="bc-service-validation-item">
                {err}
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(params).length > 0 && (
        <div className="bc-detail-section">
          <h4>Start Parameters</h4>
          <div className="bc-detail-grid">
            {Object.entries(params).map(([k, v]) => (
              <div key={k} className="bc-detail-row">
                <span className="bc-detail-key">{k}</span>
                <span className="bc-detail-val">{JSON.stringify(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {pvPrefix && baseControls.length > 0 && (
        <div className="bc-detail-section">
          <h4>Base Control PVs</h4>
          <div className="bc-pv-list">
            {baseControls.map((pvName) => {
              const fullName = buildServicePvName(pvPrefix, pvName);
              const writable = pluginType === 'task' && (pvName === 'ENABLE' || pvName === 'RUN');
              return (
                <ServicePvRow
                  key={pvName}
                  pvName={pvName}
                  fullPvName={fullName}
                  pvwsClient={pvwsClient}
                  writable={writable}
                  type={BASE_CONTROL_PV_TYPES[pvName] || 'int'}
                />
              );
            })}
          </div>
        </div>
      )}

      {pvPrefix && Object.keys(inputDefs).length > 0 && (
        <div className="bc-detail-section">
          <h4>Task/Job Input PVs</h4>
          <div className="bc-pv-list">
            {Object.entries(inputDefs).map(([pvName, cfg]) => (
              <ServicePvRow
                key={pvName}
                pvName={pvName}
                fullPvName={buildServicePvName(pvPrefix, pvName)}
                pvwsClient={pvwsClient}
                writable={true}
                type={cfg?.type || 'float'}
                unit={cfg?.unit}
              />
            ))}
          </div>
        </div>
      )}

      {pvPrefix && Object.keys(outputDefs).length > 0 && (
        <div className="bc-detail-section">
          <h4>Task/Job Output PVs</h4>
          <div className="bc-pv-list">
            {Object.entries(outputDefs).map(([pvName, cfg]) => (
              <ServicePvRow
                key={pvName}
                pvName={pvName}
                fullPvName={buildServicePvName(pvPrefix, pvName)}
                pvwsClient={pvwsClient}
                writable={false}
                type={cfg?.type || 'float'}
                unit={cfg?.unit}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ServicePvRow({ pvName, fullPvName, pvwsClient, writable, type, unit }) {
  const pvData = usePv(pvwsClient, fullPvName);
  const value = pvData?.value ?? '—';
  const statusCode = pvName === 'STATUS' && value !== '—' ? Number(value) : null;
  const valueText = statusCode !== null && Number.isFinite(statusCode)
    ? `${statusCode} (${statusLabel(statusCode)})`
    : String(value);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const handleToggle = () => {
    if (!pvwsClient || !writable || !fullPvName) return;
    pvwsClient.put(fullPvName, value === 1 ? 0 : 1);
  };

  const handleWrite = () => {
    if (!pvwsClient || !writable || !fullPvName) return;
    let v = editValue;
    if (type === 'float') v = parseFloat(v);
    else if (type === 'int' || type === 'bool') v = parseInt(v, 10);
    pvwsClient.put(fullPvName, v);
    setEditing(false);
  };

  return (
    <div className="bc-pv-row" {...pvHintProps(fullPvName)}>
      <span className="bc-pv-name" title={fullPvName || ''}>
        {pvName}
        <span className="bc-pv-type">{type || 'float'}</span>
      </span>
      <span className="bc-pv-value">{valueText}</span>
      {unit && <span className="bc-pv-unit">{unit}</span>}

      {writable && (type === 'bool' || pvName === 'RUN' || pvName === 'ENABLE') && (
        <button className="bc-pv-btn" onClick={handleToggle}>
          {value === 1 ? '⏸' : '▶'}
        </button>
      )}

      {writable && type !== 'bool' && pvName !== 'RUN' && pvName !== 'ENABLE' && (
        editing ? (
          <span className="bc-pv-edit">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleWrite()}
              autoFocus
            />
            <button className="bc-pv-btn" onClick={handleWrite}>✓</button>
            <button className="bc-pv-btn" onClick={() => setEditing(false)}>✗</button>
          </span>
        ) : (
          <button
            className="bc-pv-btn"
            onClick={() => {
              setEditValue(String(value === '—' ? '' : value));
              setEditing(true);
            }}
          >
            ✏
          </button>
        )
      )}
    </div>
  );
}

/* ────────────────────────────────────────────
   TaskCard — compact card with live PV status
   ──────────────────────────────────────────── */

function TaskCard({ task, prefix, pvwsClient, selected, onSelect }) {
  const pvSeg = task.prefix || task.name;
  const statusPv = usePv(pvwsClient, buildTaskPvName(prefix, pvSeg, 'STATUS'));
  const messagePv = usePv(pvwsClient, buildTaskPvName(prefix, pvSeg, 'MESSAGE'));
  const enablePv = usePv(pvwsClient, buildTaskPvName(prefix, pvSeg, 'ENABLE'));
  const cyclePv = usePv(
    pvwsClient,
    task.mode === 'continuous'
      ? buildTaskPvName(prefix, pvSeg, 'CYCLE_COUNT')
      : null
  );

  const statusVal = statusPv?.value ?? -1;
  const statusText = statusVal >= 0 ? statusLabel(statusVal) : '—';
  const statusClr = statusVal >= 0 ? statusColor(statusVal) : '#6c757d';
  const messageText = messagePv?.value ?? '';
  const enabled = enablePv?.value ?? -1;
  const cycleCount = cyclePv?.value ?? '';

  const handleEnable = (e) => {
    e.stopPropagation();
    if (!pvwsClient) return;
    const newVal = enabled === 1 ? 0 : 1;
    pvwsClient.put(buildTaskPvName(prefix, pvSeg, 'ENABLE'), newVal);
  };

  const handleTrigger = (e) => {
    e.stopPropagation();
    if (!pvwsClient || task.mode !== 'triggered') return;
    pvwsClient.put(buildTaskPvName(prefix, pvSeg, 'RUN'), 1);
  };

  return (
    <div
      className={`bc-task-card ${selected ? 'bc-task-card--selected' : ''}`}
      onClick={onSelect}
    >
      <div className="bc-card-header">
        <span className="bc-card-name">{task.displayName || task.name}</span>
        <span
          className="bc-card-status"
          style={{ backgroundColor: statusClr }}
          title={statusText}
        >
          {statusText}
        </span>
      </div>

      <div className="bc-card-meta">
        <span className="bc-card-mode">{task.mode === 'triggered' ? '⚡ triggered' : '🔄 continuous'}</span>
        <span className="bc-card-module">{task.module}</span>
        {task.prefix && <span className="bc-card-prefix" title="PV prefix segment">{task.prefix}</span>}
      </div>

      {task.description && (
        <div className="bc-card-desc">{task.description}</div>
      )}

      {messageText && (
        <div className="bc-card-message" title={messageText}>
          {messageText}
        </div>
      )}

      <div className="bc-card-controls">
        <button
          className={`bc-btn ${enabled === 1 ? 'bc-btn--enabled' : 'bc-btn--disabled'}`}
          onClick={handleEnable}
          title={enabled === 1 ? 'Disable' : 'Enable'}
        >
          {enabled === 1 ? '⏸ Disable' : '▶ Enable'}
        </button>

        {task.mode === 'triggered' && (
          <button
            className="bc-btn bc-btn--trigger"
            onClick={handleTrigger}
            title="Trigger execution"
          >
            ⚡ Trigger
          </button>
        )}

        {task.mode === 'continuous' && cycleCount !== '' && (
          <span className="bc-card-cycles">Cycles: {cycleCount}</span>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   TaskDetailPanel — expanded view with all PVs
   ──────────────────────────────────────────── */

function TaskDetailPanel({ task, prefix, pvwsClient, taskSources, setTaskSources, controllerApiUrl, defaultGitUrl }) {
  const [activeAction, setActiveAction] = useState(null);
  const [editTab, setEditTab] = useState('yaml');
  const [gitStatus, setGitStatus] = useState(null);
  const [deployStatus, setDeployStatus] = useState(null);

  if (!task) return null;

  const pvSeg = task.prefix || task.name;
  const builtins = getBuiltinPvNames(prefix, pvSeg, task.mode);
  const inputEntries = Object.entries(task.inputs || {});
  const outputEntries = Object.entries(task.outputs || {});
  const paramEntries = Object.entries(task.parameters || {});

  return (
    <div className="bc-detail-panel">
      <h3>📋 {task.displayName || task.name}{task.prefix ? <span className="bc-detail-prefix"> ({task.prefix})</span> : null}</h3>
      {task.description && <p className="bc-detail-desc">{task.description}</p>}

      {/* Action Bar */}
      <div className="bc-action-bar">
        <button className={`bc-action-btn ${activeAction === 'edit' ? 'active' : ''}`} onClick={() => { setActiveAction(a => a === 'edit' ? null : 'edit'); setGitStatus(null); setDeployStatus(null); }}>✏ Edit</button>
        <button className={`bc-action-btn ${activeAction === 'git' ? 'active' : ''}`} onClick={() => { setActiveAction(a => a === 'git' ? null : 'git'); setGitStatus(null); setDeployStatus(null); }}>🔗 Git</button>
        <button className={`bc-action-btn ${activeAction === 'deploy' ? 'active' : ''}`} onClick={() => { setActiveAction(a => a === 'deploy' ? null : 'deploy'); setGitStatus(null); setDeployStatus(null); }}>🚀 Deploy</button>
      </div>

      {/* Editor Section */}
      {activeAction === 'edit' && (
        <TaskEditorSection task={task} prefix={prefix} editTab={editTab} setEditTab={setEditTab} taskSources={taskSources} setTaskSources={setTaskSources} />
      )}

      {/* Git Section */}
      {activeAction === 'git' && (
        <TaskGitSection task={task} taskSources={taskSources} setTaskSources={setTaskSources} defaultGitUrl={defaultGitUrl} gitStatus={gitStatus} setGitStatus={setGitStatus} />
      )}

      {/* Deploy Section */}
      {activeAction === 'deploy' && (
        <TaskDeploySection task={task} taskSources={taskSources} controllerApiUrl={controllerApiUrl} deployStatus={deployStatus} setDeployStatus={setDeployStatus} />
      )}

      {/* Parameters */}
      {paramEntries.length > 0 && (
        <div className="bc-detail-section">
          <h4>Parameters</h4>
          <div className="bc-detail-grid">
            {paramEntries.map(([k, v]) => (
              <div key={k} className="bc-detail-row">
                <span className="bc-detail-key">{k}</span>
                <span className="bc-detail-val">{JSON.stringify(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Built-in PVs */}
      <div className="bc-detail-section">
        <h4>Control PVs</h4>
        <div className="bc-pv-list">
          {builtins.map((pv) => (
            <PvMonitorRow key={pv.key} pv={pv} pvwsClient={pvwsClient} prefix={prefix} taskName={task.name} />
          ))}
        </div>
      </div>

      {/* Input PVs */}
      {inputEntries.length > 0 && (
        <div className="bc-detail-section">
          <h4>Inputs</h4>
          <div className="bc-pv-list">
            {inputEntries.map(([name, cfg]) => (
              <TaskPvRow
                key={name}
                name={name}
                config={cfg}
                prefix={prefix}
                taskName={pvSeg}
                pvwsClient={pvwsClient}
                writable={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* Output PVs */}
      {outputEntries.length > 0 && (
        <div className="bc-detail-section">
          <h4>Outputs</h4>
          <div className="bc-pv-list">
            {outputEntries.map(([name, cfg]) => (
              <TaskPvRow
                key={name}
                name={name}
                config={cfg}
                prefix={prefix}
                taskName={pvSeg}
                pvwsClient={pvwsClient}
                writable={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── PV monitor row for built-in PVs ── */

function PvMonitorRow({ pv, pvwsClient, prefix, taskName }) {
  const pvData = usePv(pvwsClient, pv.name);
  const value = pvData?.value ?? '—';
  const displayValue = pv.key === 'STATUS' ? statusLabel(value) : String(value);
  const sevColor =
    pv.key === 'STATUS' && typeof value === 'number' ? statusColor(value) : undefined;

  const handleWrite = () => {
    if (!pvwsClient || !pv.writable) return;
    if (pv.type === 'bool') {
      pvwsClient.put(pv.name, value === 1 ? 0 : 1);
    }
  };

  return (
    <div className="bc-pv-row" {...pvHintProps(pv.name)}>
      <span className="bc-pv-name" title={pv.name}>
        {pv.key}
      </span>
      <span
        className="bc-pv-value"
        style={sevColor ? { color: sevColor, fontWeight: 'bold' } : undefined}
      >
        {displayValue}
      </span>
      {pv.writable && pv.type === 'bool' && (
        <button className="bc-pv-btn" onClick={handleWrite}>
          {value === 1 ? '⏸' : '▶'}
        </button>
      )}
    </div>
  );
}

/* ── PV monitor row for task inputs/outputs ── */

function TaskPvRow({ name, config, prefix, taskName, pvwsClient, writable }) {
  const fullPvName = buildTaskPvName(prefix, taskName, name);
  const pvData = usePv(pvwsClient, fullPvName);
  const value = pvData?.value ?? '—';
  const [editValue, setEditValue] = useState('');
  const [editing, setEditing] = useState(false);

  const handleWrite = () => {
    if (!pvwsClient) return;
    let v = editValue;
    if (config.type === 'float') v = parseFloat(v);
    else if (config.type === 'int' || config.type === 'bool') v = parseInt(v, 10);
    pvwsClient.put(fullPvName, v);
    setEditing(false);
  };

  return (
    <div className="bc-pv-row" {...pvHintProps(fullPvName)}>
      <span className="bc-pv-name" title={fullPvName}>
        {name}
        <span className="bc-pv-type">{config.type || 'float'}</span>
      </span>
      <span className="bc-pv-value">{String(value)}</span>
      {config.unit && <span className="bc-pv-unit">{config.unit}</span>}
      {writable && (
        <>
          {editing ? (
            <span className="bc-pv-edit">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleWrite()}
                autoFocus
              />
              <button className="bc-pv-btn" onClick={handleWrite}>✓</button>
              <button className="bc-pv-btn" onClick={() => setEditing(false)}>✗</button>
            </span>
          ) : (
            <button
              className="bc-pv-btn"
              onClick={() => {
                setEditValue(String(value === '—' ? '' : value));
                setEditing(true);
              }}
            >
              ✏
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────
   Task Editor Section — inline config/python editor
   ──────────────────────────────────────────── */

function TaskEditorSection({ task, prefix, editTab, setEditTab, taskSources, setTaskSources }) {
  const sources = taskSources?.[task.name] || {};

  const updateSource = (field, value) => {
    setTaskSources?.(prev => ({
      ...prev,
      [task.name]: { ...(prev[task.name] || {}), [field]: value }
    }));
  };

  return (
    <div className="bc-editor-section">
      <div className="bc-editor-tabs">
        <button className={`bc-action-btn ${editTab === 'yaml' ? 'active' : ''}`} onClick={() => setEditTab('yaml')}>📄 config.yaml</button>
        <button className={`bc-action-btn ${editTab === 'python' ? 'active' : ''}`} onClick={() => setEditTab('python')}>🐍 {task.module}.py</button>
      </div>
      {editTab === 'yaml' ? (
        <textarea
          className="bc-editor-textarea"
          value={sources.configYaml || generateFullConfigYaml(task, prefix)}
          onChange={(e) => updateSource('configYaml', e.target.value)}
          rows={16}
          spellCheck={false}
        />
      ) : (
        <textarea
          className="bc-editor-textarea"
          value={sources.pythonCode || generateTaskPython(task)}
          onChange={(e) => updateSource('pythonCode', e.target.value)}
          rows={16}
          spellCheck={false}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────
   Task Git Section — commit & push to git repo
   ──────────────────────────────────────────── */

function TaskGitSection({ task, taskSources, setTaskSources, gitStatus, setGitStatus }) {
  const sources = taskSources?.[task.name] || {};
  const git = sources.git || {};

  const updateGit = (field, value) => {
    setTaskSources?.(prev => ({
      ...prev,
      [task.name]: {
        ...(prev[task.name] || {}),
        git: { ...(prev[task.name]?.git || {}), [field]: value }
      }
    }));
  };

  const handleCommitPush = async () => {
    if (!git.url || !git.pat) { setGitStatus('❌ Git URL and PAT are required'); return; }
    const repoInfo = parseGitUrl(git.url);
    if (!repoInfo) { setGitStatus('❌ Invalid git URL'); return; }
    const branch = git.branch || 'main';
    const basePath = git.path || `config/iocs/beamline-controller/${task.module}`;
    setGitStatus('⏳ Committing...');
    try {
      if (sources.configYaml) {
        await commitFile(repoInfo, `${basePath}/config.yaml`, branch, sources.configYaml, `Update ${task.displayName || task.name} config.yaml`, git.pat);
      }
      if (sources.pythonCode) {
        await commitFile(repoInfo, `${basePath}/${task.module}.py`, branch, sources.pythonCode, `Update ${task.displayName || task.name} ${task.module}.py`, git.pat);
      }
      setGitStatus('✅ Committed and pushed');
    } catch (e) {
      setGitStatus(`❌ ${e.message}`);
    }
  };

  return (
    <div className="bc-git-section">
      <div className="bc-git-field">
        <label>Git URL</label>
        <input type="text" value={git.url || ''} onChange={(e) => updateGit('url', e.target.value)} placeholder="https://gitlab.infn.it/org/beamline-project.git" />
      </div>
      <div className="bc-git-row">
        <div className="bc-git-field">
          <label>Branch</label>
          <input type="text" value={git.branch || ''} onChange={(e) => updateGit('branch', e.target.value)} placeholder="main" />
        </div>
        <div className="bc-git-field">
          <label>Path in repo</label>
          <input type="text" value={git.path || ''} onChange={(e) => updateGit('path', e.target.value)} placeholder={`config/iocs/beamline-controller/${task.module}`} />
        </div>
        <div className="bc-git-field">
          <label>PAT</label>
          <input type="password" value={git.pat || ''} onChange={(e) => updateGit('pat', e.target.value)} placeholder="glpat-xxxx…" />
        </div>
      </div>
      <div className="bc-git-actions">
        <button className="toolbar-btn active" onClick={handleCommitPush} disabled={!git.url || !git.pat || (!sources.configYaml && !sources.pythonCode)}>📤 Commit & Push</button>
        {!sources.configYaml && !sources.pythonCode && <span className="bc-git-hint">Edit config or Python first to enable commit</span>}
      </div>
      {gitStatus && <div className={`bc-status-msg ${gitStatus.startsWith('✅') ? 'bc-status--ok' : gitStatus.startsWith('❌') ? 'bc-status--error' : ''}`}>{gitStatus}</div>}
    </div>
  );
}

/* ────────────────────────────────────────────
   Task Deploy Section — deploy / restart via controller API
   ──────────────────────────────────────────── */

function TaskDeploySection({ task, taskSources, controllerApiUrl, deployStatus, setDeployStatus }) {
  const git = taskSources?.[task.name]?.git || {};

  const handleDeploy = async () => {
    if (!controllerApiUrl) { setDeployStatus('❌ Set Controller API URL in ⚙ Config panel'); return; }
    if (!git.url) { setDeployStatus('❌ Configure Git URL in 🔗 Git section first'); return; }
    setDeployStatus('⏳ Deploying...');
    try {
      const result = await deployPlugin(controllerApiUrl, {
        name: task.module,
        git_url: git.url,
        path: git.path || '',
        pat: git.pat || undefined,
        branch: git.branch || 'main',
      });
      setDeployStatus(`✅ ${result.message || 'Deployed'}`);
    } catch (e) {
      setDeployStatus(`❌ ${e.message}`);
    }
  };

  const handleRestart = async () => {
    if (!controllerApiUrl) { setDeployStatus('❌ Set Controller API URL in ⚙ Config panel'); return; }
    setDeployStatus('⏳ Restarting...');
    try {
      const result = await restartPlugin(controllerApiUrl, task.module);
      setDeployStatus(`✅ ${result.message || 'Restarted'}`);
    } catch (e) {
      setDeployStatus(`❌ ${e.message}`);
    }
  };

  return (
    <div className="bc-deploy-section">
      <p className="bc-deploy-hint">
        Deploy or restart this task on the running controller. The controller will clone the git repo and start the plugin.
        {!controllerApiUrl && <><br /><strong>⚠ Set Controller API URL in ⚙ Config panel first.</strong></>}
      </p>
      <div className="bc-deploy-actions">
        <button className="toolbar-btn active" onClick={handleDeploy} disabled={!controllerApiUrl || !git.url}>🚀 Deploy</button>
        <button className="toolbar-btn" onClick={handleRestart} disabled={!controllerApiUrl}>🔄 Restart</button>
      </div>
      {deployStatus && <div className={`bc-status-msg ${deployStatus.startsWith('✅') ? 'bc-status--ok' : deployStatus.startsWith('❌') ? 'bc-status--error' : ''}`}>{deployStatus}</div>}
    </div>
  );
}

/* ────────────────────────────────────────────
   Run From Git Dialog — deploy existing task from a git repo
   ──────────────────────────────────────────── */

function RunFromGitDialog({ controllerApiUrl, defaultGitUrl, onClose, onDeployed }) {
  const [name, setName] = useState('');
  const [gitUrl, setGitUrl] = useState(defaultGitUrl || '');
  const [gitPath, setGitPath] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [gitPat, setGitPat] = useState('');
  const [status, setStatus] = useState(null);

  const handleDeploy = async () => {
    if (!name.trim()) { setStatus('❌ Plugin name is required'); return; }
    if (!gitUrl.trim()) { setStatus('❌ Git URL is required'); return; }
    if (!controllerApiUrl) { setStatus('❌ Controller API URL not set — configure in ⚙ Config panel'); return; }
    setStatus('⏳ Deploying...');
    try {
      const result = await deployPlugin(controllerApiUrl, {
        name: name.trim(),
        git_url: gitUrl.trim(),
        path: gitPath.trim(),
        pat: gitPat.trim() || undefined,
        branch: gitBranch.trim() || 'main',
      });
      setStatus(`✅ ${result.message || 'Deployed successfully'}`);
      onDeployed?.(result);
    } catch (e) {
      setStatus(`❌ ${e.message}`);
    }
  };

  return (
    <div className="wiz-overlay" onClick={onClose}>
      <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="import-dialog-header">
          <h3>🔗 Run Task from Git</h3>
          <button className="toolbar-btn" onClick={onClose}>✕</button>
        </div>
        <div className="import-dialog-body">
          <p className="import-hint">
            Deploy a task directly from a git repository to the running controller.
            The controller will clone the repo, validate the plugin, and start it.
          </p>
          <div className="bc-git-field">
            <label>Plugin Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))} placeholder="check_motor_movement" />
          </div>
          <div className="bc-git-field">
            <label>Git URL</label>
            <input type="text" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://gitlab.infn.it/org/beamline-tasks.git" />
          </div>
          <div className="bc-git-row">
            <div className="bc-git-field">
              <label>Path in repo</label>
              <input type="text" value={gitPath} onChange={(e) => setGitPath(e.target.value)} placeholder="(root)" />
            </div>
            <div className="bc-git-field">
              <label>Branch</label>
              <input type="text" value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} placeholder="main" />
            </div>
            <div className="bc-git-field">
              <label>PAT</label>
              <input type="password" value={gitPat} onChange={(e) => setGitPat(e.target.value)} placeholder="glpat-xxxx…" />
            </div>
          </div>
          {status && <div className={`bc-status-msg ${status.startsWith('✅') ? 'bc-status--ok' : status.startsWith('❌') ? 'bc-status--error' : ''}`}>{status}</div>}
        </div>
        <div className="import-dialog-footer">
          <button className="toolbar-btn" onClick={onClose}>Cancel</button>
          <button className="toolbar-btn active" onClick={handleDeploy} disabled={!name || !gitUrl}>🚀 Deploy to Controller</button>
        </div>
      </div>
    </div>
  );
}
