import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import CameraWidget from '../../widgets/types/CameraWidget.jsx';
import { deviceToWidgetConfig } from '../../models/dashboard.js';

/**
 * CameraView - NxM grid of camera streams (original camera array functionality).
 * Renders a simple CSS grid (not react-grid-layout) for the fixed NxM layout.
 */
export default function CameraView() {
  const { cameras, pvwsClient, gitConfig, refreshConfig } = useApp();
  const { token } = useAuth();

  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(3);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');

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
          <button className="toolbar-btn" onClick={() => setSettingsOpen((o) => !o)}>
            ⚙ Grid {rows}×{cols}
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
            <div className="toolbar-dropdown">
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
              <span className="cam-count">{cameras.length} camera(s)</span>
            </div>
          )}
          {syncStatus && <span className="cam-count">{syncStatus}</span>}
        </div>
      </div>

      {/* Grid */}
      <div
        className="camera-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
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
