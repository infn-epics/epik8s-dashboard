import { useState, useRef, useEffect } from 'react';
import CameraControls from './CameraControls';
import { useCameraPvs } from '../hooks/usePv';

export default function CameraTile({ cameras, client, initialCamera }) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const imgRef = useRef(null);

  const camera = cameras[selectedIdx] || initialCamera || cameras[0];

  // Subscribe to Stream1:EnableCallbacks PV for stream status
  const { streamEnable } = useCameraPvs(client, camera?.pvPrefix);
  const streamEnabled = streamEnable?.value === 1 || streamEnable?.value === '1' || streamEnable?.value === 'Enable';
  if (!camera) {
    return (
      <div className="camera-tile empty">
        <div className="tile-body">
          <p className="no-camera">No cameras available</p>
        </div>
      </div>
    );
  }

  const handleCameraChange = (e) => {
    const idx = parseInt(e.target.value, 10);
    setSwitching(true);
    setSelectedIdx(idx);
    setHasError(false);
  };

  // Clear switching state when new image loads
  useEffect(() => {
    setSwitching(true);
  }, [camera?.pvPrefix]);

  const toggleStream = () => {
    if (!client || !camera?.pvPrefix) return;
    const newVal = streamEnabled ? 0 : 1;
    console.log(`[PVWS] Write ${camera.pvPrefix}:Stream1:EnableCallbacks = ${newVal}`);
    client.put(`${camera.pvPrefix}:Stream1:EnableCallbacks`, newVal);
    setHasError(false);
  };

  const streamSrc = streamEnabled ? camera.streamUrl : undefined;

  return (
    <div className={`camera-tile ${streamEnabled ? 'active' : 'inactive'}`}>
      {/* Header */}
      <div className="tile-header">
        <select
          className="camera-select"
          value={selectedIdx}
          onChange={handleCameraChange}
        >
          {cameras.map((cam, idx) => (
            <option key={`${cam.iocName}-${cam.deviceName}`} value={idx}>
              {cam.iocName} / {cam.deviceName}
            </option>
          ))}
        </select>

        <button
          className={`stream-toggle ${streamEnabled ? 'on' : 'off'}`}
          onClick={toggleStream}
          title={streamEnabled ? 'Disable stream' : 'Enable stream'}
        >
          {streamEnabled ? '🟢' : '🔴'}
        </button>

        <button
          className={`controls-toggle ${controlsOpen ? 'open' : ''}`}
          onClick={() => setControlsOpen((o) => !o)}
          title={controlsOpen ? 'Hide controls' : 'Show controls'}
        >
          ⚙
        </button>
      </div>

      {/* Stream */}
      <div className="tile-body">
        <div className="stream-container">
          {streamEnabled ? (
            hasError ? (
              <div className="stream-error">
                <span>⚠ Stream unavailable</span>
                <button onClick={() => { setHasError(false); setSwitching(false); }}>Retry</button>
              </div>
            ) : switching ? (
              <div className="stream-connecting">Connecting…</div>
            ) : (
              <img
                ref={imgRef}
                className="stream-img"
                src={streamSrc}
                alt={`${camera.deviceName} stream`}
                onLoad={() => setSwitching(false)}
                onError={() => setHasError(true)}
              />
            )
          ) : (
            <div className="stream-disabled">Stream disabled</div>
          )}
          <div className="camera-label">{camera.pvPrefix}</div>
        </div>
      </div>

      {/* Controls Panel */}
      <div className={`controls-panel ${controlsOpen ? 'open' : ''}`}>
        <CameraControls client={client} pvPrefix={camera.pvPrefix} />
      </div>
    </div>
  );
}
