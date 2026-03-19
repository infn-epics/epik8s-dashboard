import { useState, useMemo, lazy, Suspense } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import CameraWidget from '../widgets/CameraWidget.jsx';

/**
 * CameraView - NxM grid of camera streams (original camera array functionality).
 * Renders a simple CSS grid (not react-grid-layout) for the fixed NxM layout.
 */
export default function CameraView() {
  const { cameras, pvwsClient } = useApp();

  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(3);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
              <CameraWidget device={cam} client={pvwsClient} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
