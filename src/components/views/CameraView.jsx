import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useGitStorage } from '../../hooks/useGitStorage.js';
import CameraWidget from '../../widgets/types/CameraWidget.jsx';
import { deviceToWidgetConfig } from '../../models/dashboard.js';
import {
  buildCameraConfigSnapshot,
  loadCameraConfigPreset,
  loadCurrentCameraConfig,
  normalizeCameraConfigName,
  resolveCameraConfigSnapshot,
  saveCameraConfigPreset,
  saveCurrentCameraConfig,
  listCameraConfigPresets,
} from '../../services/cameraConfigStorage.js';

/**
 * CameraView - NxM grid of camera streams (original camera array functionality).
 * Renders a simple CSS grid (not react-grid-layout) for the fixed NxM layout.
 */
export default function CameraView() {
  const { cameras, pvwsClient, gitConfig, refreshConfig } = useApp();
  const { token } = useAuth();
  const { gitStorage, canSync, canWrite } = useGitStorage();
  const initialCameraConfig = loadCurrentCameraConfig();

  const [rows, setRows] = useState(initialCameraConfig?.rows || 2);
  const [cols, setCols] = useState(initialCameraConfig?.cols || 3);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [configName, setConfigName] = useState(initialCameraConfig?.name || '');
  const [savedConfigs, setSavedConfigs] = useState([]);
  const [selectedConfig, setSelectedConfig] = useState('');
  const [configStatus, setConfigStatus] = useState('');
  const [configBusy, setConfigBusy] = useState(false);
  const [configRefs, setConfigRefs] = useState({});
  const [restorePending, setRestorePending] = useState(initialCameraConfig);
  const [capturePath, setCapturePath] = useState('');
  const [captureCount, setCaptureCount] = useState(1);
  const [captureFileNumber, setCaptureFileNumber] = useState(1);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureStatus, setCaptureStatus] = useState('');

  const totalTiles = rows * cols;

  // Per-tile camera selection
  const [selections, setSelections] = useState({});

  const getCamera = (tileIdx) => {
    if (selections[tileIdx] !== undefined) {
      return cameras[selections[tileIdx]];
    }
    return cameras[tileIdx % cameras.length];
  };

  const setTileCamera = (tileIdx, camIdx) => {
    setSelections((prev) => ({ ...prev, [tileIdx]: camIdx }));
  };

  const applyCameraConfig = (snapshot) => {
    const resolved = resolveCameraConfigSnapshot(snapshot, cameras);
    setRows(resolved.rows);
    setCols(resolved.cols);
    setSelections(resolved.selections);
    if (snapshot?.name) {
      setConfigName(snapshot.name);
    }
  };

  const refreshSavedConfigs = async () => {
    const locals = listCameraConfigPresets().map((name) => ({
      id: `local:${name}`,
      name,
      source: 'local',
    }));

    let remotes = [];
    if (canSync && gitStorage) {
      try {
        const remoteList = await gitStorage.listCameraConfigs();
        remotes = remoteList.map((item) => ({
          id: `git:${item.name}`,
          name: item.name,
          source: 'git',
        }));
      } catch (err) {
        setConfigStatus(`Git list unavailable: ${err.message}`);
      }
    }

    setSavedConfigs([...locals, ...remotes]);
  };

  useEffect(() => {
    if (restorePending && cameras.length) {
      applyCameraConfig(restorePending);
      setRestorePending(null);
    }
  }, [restorePending, cameras]);

  useEffect(() => {
    if (!cameras.length) return;
    const snapshot = buildCameraConfigSnapshot({ name: configName, rows, cols, selections, cameras });
    saveCurrentCameraConfig(snapshot);
  }, [rows, cols, selections, cameras, configName]);

  useEffect(() => {
    if (settingsOpen) {
      refreshSavedConfigs();
    }
  }, [settingsOpen, gitStorage, canSync]);

  const handleSaveLocalConfig = () => {
    try {
      const name = normalizeCameraConfigName(configName || `camera-grid-${rows}x${cols}`);
      if (!name) return;
      const snapshot = buildCameraConfigSnapshot({ name, rows, cols, selections, cameras });
      saveCameraConfigPreset(name, snapshot);
      saveCurrentCameraConfig(snapshot);
      setConfigName(name);
      setSelectedConfig(`local:${name}`);
      setConfigStatus(`Saved locally: ${name}`);
      refreshSavedConfigs();
    } catch (err) {
      setConfigStatus(`Local save failed: ${err.message}`);
    }
  };

  const handleLoadSelectedConfig = async () => {
    if (!selectedConfig) return;
    const [source, name] = selectedConfig.split(':');
    try {
      if (source === 'git') {
        if (!gitStorage) throw new Error('Git storage is not configured');
        const { data, ref } = await gitStorage.loadCameraConfig(name);
        applyCameraConfig(data);
        setConfigRefs((prev) => ({ ...prev, [name]: ref }));
      } else {
        const data = loadCameraConfigPreset(name);
        if (!data) throw new Error('Local preset not found');
        applyCameraConfig(data);
      }
      setConfigStatus(`Loaded ${source} config: ${name}`);
    } catch (err) {
      setConfigStatus(`Load failed: ${err.message}`);
    }
  };

  const handleSaveGitConfig = async () => {
    if (!gitStorage) {
      setConfigStatus('Set a beamline git repository first');
      return;
    }
    if (!canWrite) {
      setConfigStatus('Login with a token to write camera configs to git');
      return;
    }

    const name = normalizeCameraConfigName(configName || `camera-grid-${rows}x${cols}`);
    if (!name) return;

    setConfigBusy(true);
    try {
      const snapshot = buildCameraConfigSnapshot({ name, rows, cols, selections, cameras });
      saveCameraConfigPreset(name, snapshot);
      saveCurrentCameraConfig(snapshot);

      const check = await gitStorage.checkCameraConfigConflict(name, configRefs[name]);
      if (check.conflict) {
        const overwrite = window.confirm(`Remote camera config "${name}" changed. Overwrite it with the current one?`);
        if (!overwrite) {
          setConfigStatus('Git save cancelled');
          return;
        }
      }

      const message = window.prompt('Commit message:', `Update camera config: ${name}`);
      if (!message) {
        setConfigStatus('Git save cancelled');
        return;
      }

      const result = await gitStorage.saveCameraConfig(name, snapshot, message, check.remoteRef || configRefs[name]);
      const ref = result?.content?.sha || result?.file_path || check.remoteRef || null;
      setConfigRefs((prev) => ({ ...prev, [name]: ref }));
      setConfigName(name);
      setSelectedConfig(`git:${name}`);
      setConfigStatus(`Saved to git: ${name}`);
      await refreshSavedConfigs();
    } catch (err) {
      setConfigStatus(`Git save failed: ${err.message}`);
    } finally {
      setConfigBusy(false);
    }
  };

  const handleSync = async () => {
    if (!gitConfig?.giturl || syncing) return;
    setSyncing(true);
    setSyncStatus('Syncing from git…');
    try {
      const result = await refreshConfig({ token: token || null });
      setSelections({});
      setSyncStatus(`Synced ${result.cameras.length} camera(s)`);
    } catch (err) {
      setSyncStatus(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleStartGlobalCapture = () => {
    if (!pvwsClient || !capturePath) return;
    setCaptureBusy(true);
    setCaptureStatus('');
    // Collect unique PV prefixes from all displayed cameras
    const prefixes = [...new Set(
      Array.from({ length: totalTiles }, (_, i) => getCamera(i))
        .filter(Boolean)
        .map(cam => {
          const cfg = deviceToWidgetConfig(cam);
          return cfg.pvPrefix || null;
        })
        .filter(Boolean)
    )];
    if (prefixes.length === 0) {
      setCaptureStatus('No cameras configured');
      setCaptureBusy(false);
      return;
    }
    const dir = capturePath.replace(/\/$/, '') + '/';
    const createDirectoryDepth = 1;
    for (const pvPrefix of prefixes) {
      pvwsClient.put(`${pvPrefix}:TIFF1:CreateDirectory`, createDirectoryDepth);
      pvwsClient.put(`${pvPrefix}:TIFF1:FilePath`, dir);
      pvwsClient.put(`${pvPrefix}:TIFF1:NumCapture`, Number(captureCount));
      pvwsClient.put(`${pvPrefix}:TIFF1:FileNumber`, Number(captureFileNumber));
      pvwsClient.put(`${pvPrefix}:TIFF1:Capture`, 1);
    }
    setCaptureStatus(`Started capture on ${prefixes.length} camera(s)`);
    setCaptureBusy(false);
  };

  if (cameras.length === 0) {
    return (
      <div className="view-empty">
        <p>No cameras with <code>stream_enable: true</code> found in configuration.</p>
      </div>
    );
  }

  return (
    <div className="camera-view">
      {/* Controls bar */}
      <div className="view-toolbar">
        <span className="view-toolbar-title">Camera Array</span>
        <div className="toolbar-controls">
          <div className="camera-save-controls">
            <label className="camera-save-field">
              <span>Directory</span>
              <input
                type="text"
                className="camera-save-input"
                placeholder="/nfs/data/capture/"
                value={capturePath}
                onChange={(e) => setCapturePath(e.target.value)}
              />
            </label>
            <label className="camera-save-field camera-save-field--narrow">
              <span>Images</span>
              <input
                type="number"
                min={1}
                step={1}
                className="camera-save-input"
                value={captureCount}
                onChange={(e) => setCaptureCount(e.target.value)}
              />
            </label>
            <label className="camera-save-field camera-save-field--narrow">
              <span>File #</span>
              <input
                type="number"
                min={0}
                step={1}
                className="camera-save-input"
                value={captureFileNumber}
                onChange={(e) => setCaptureFileNumber(e.target.value)}
              />
            </label>
            <button className="toolbar-btn" onClick={handleStartGlobalCapture} disabled={captureBusy}>
              {captureBusy ? 'Starting…' : 'Start Acquire'}
            </button>
          </div>
          <button className="toolbar-btn" onClick={() => setSettingsOpen((o) => !o)}>
            ⚙ Cameras {rows}×{cols}
          </button>
          <button
            className="toolbar-btn"
            onClick={handleSync}
            disabled={!gitConfig?.giturl || syncing}
            title={gitConfig?.giturl ? `Sync camera configuration from ${gitConfig.gitbranch || 'main'}` : 'Configure a beamline repository in Settings first'}
          >
            {syncing ? '⟳ Syncing…' : '⇅ Sync Git'}
          </button>
          {settingsOpen && (
            <div className="toolbar-dropdown camera-config-panel">
              <label>
                Rows
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={rows}
                  onChange={(e) => setRows(Math.max(1, Math.min(10, +e.target.value)))}
                />
              </label>
              <label>
                Cols
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={cols}
                  onChange={(e) => setCols(Math.max(1, Math.min(10, +e.target.value)))}
                />
              </label>
              <label className="camera-config-field">
                <span>Saved</span>
                <select
                  className="camera-config-select"
                  value={selectedConfig}
                  onChange={(e) => setSelectedConfig(e.target.value)}
                >
                  <option value="">Select configuration…</option>
                  {savedConfigs.map((cfg) => (
                    <option key={cfg.id} value={cfg.id}>
                      {cfg.source === 'git' ? `🌐 ${cfg.name}` : `💾 ${cfg.name}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="camera-config-field">
                <span>Name</span>
                <input
                  type="text"
                  className="camera-config-input"
                  value={configName}
                  placeholder="operator-view"
                  onChange={(e) => setConfigName(e.target.value)}
                />
              </label>
              <div className="camera-config-actions">
                <button className="toolbar-btn toolbar-btn--small" onClick={handleLoadSelectedConfig} disabled={!selectedConfig || configBusy}>
                  Load
                </button>
                <button className="toolbar-btn toolbar-btn--small" onClick={handleSaveLocalConfig} disabled={configBusy}>
                  Save Local
                </button>
                <button className="toolbar-btn toolbar-btn--small" onClick={handleSaveGitConfig} disabled={!canSync || configBusy}>
                  {configBusy ? 'Saving…' : 'Save Git'}
                </button>
              </div>
              <span className="cam-count">{cameras.length} camera(s)</span>
              {configStatus && <span className="cam-count">{configStatus}</span>}
            </div>
          )}
          {syncStatus && <span className="cam-count">{syncStatus}</span>}
          {captureStatus && <span className="cam-count">{captureStatus}</span>}
        </div>
      </div>

      {/* Grid */}
      <div
        className="camera-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(280px, 1fr))`,
          gridAutoRows: 'minmax(360px, auto)',
          alignContent: 'start',
        }}
      >
        {Array.from({ length: totalTiles }, (_, i) => {
          const cam = getCamera(i);
          if (!cam) {
            return (
              <div key={i} className="camera-tile empty">
                <span className="no-camera">No camera</span>
              </div>
            );
          }

          return (
            <div key={i} className="camera-grid-cell">
              {/* Camera selector */}
              <div className="cell-header">
                <select
                  className="camera-select"
                  value={selections[i] ?? (i % cameras.length)}
                  onChange={(e) => setTileCamera(i, parseInt(e.target.value, 10))}
                >
                  {cameras.map((c, idx) => (
                    <option key={c.id} value={idx}>
                      {c.iocName} / {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <CameraWidget config={deviceToWidgetConfig(cam)} client={pvwsClient} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
