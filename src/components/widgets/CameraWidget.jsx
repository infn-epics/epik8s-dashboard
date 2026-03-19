import { useState, useRef, useEffect } from 'react';
import Widget from '../layout/Widget.jsx';
import { usePv } from '../../hooks/usePv.js';
import { PvSlider, PvDisplay } from '../common/PvControls.jsx';

/**
 * CameraWidget - MJPEG stream with PV controls for acquire/exposure/gain.
 */
export default function CameraWidget({ device, client, onHide }) {
  const [hasError, setHasError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef(null);

  const streamEnablePv = usePv(client, `${device.pvPrefix}:Stream1:EnableCallbacks`);
  const acquirePv = usePv(client, `${device.pvPrefix}:Acquire`);
  const streamEnabled =
    streamEnablePv?.value === 1 || streamEnablePv?.value === '1' || streamEnablePv?.value === 'Enable';
  const isAcquiring = acquirePv?.value === 1 || acquirePv?.value === 'Acquire';

  // Reset error state on stream toggle
  useEffect(() => {
    setHasError(false);
    setImgLoaded(false);
  }, [streamEnabled, device.pvPrefix]);

  const toggleStream = () => {
    if (!client) return;
    client.put(`${device.pvPrefix}:Stream1:EnableCallbacks`, streamEnabled ? 0 : 1);
    setHasError(false);
  };

  const toggleAcquire = () => {
    if (!client) return;
    client.put(`${device.pvPrefix}:Acquire`, isAcquiring ? 0 : 1);
  };

  const status = hasError ? 'error' : streamEnabled ? 'ok' : 'warning';

  const detailContent = (
    <div className="camera-detail">
      <div className="camera-detail-stream">
        {streamEnabled && device.streamUrl ? (
          <img src={device.streamUrl} alt={device.name} className="stream-img" />
        ) : (
          <div className="stream-disabled">Stream disabled</div>
        )}
      </div>
      <div className="camera-detail-controls">
        <PvDisplay client={client} pvName={`${device.pvPrefix}:ArrayRate_RBV`} label="FPS" />
        <PvDisplay client={client} pvName={`${device.pvPrefix}:ArrayCounter_RBV`} label="Frames" precision={0} />
        <PvSlider client={client} pvName={`${device.pvPrefix}:AcquireTime`} label="Exposure" min={0.001} max={10} step={0.001} />
        <PvSlider client={client} pvName={`${device.pvPrefix}:Gain`} label="Gain" min={0} max={500} step={1} />
      </div>
    </div>
  );

  return (
    <Widget
      title={device.name}
      subtitle={device.iocName}
      icon="📷"
      status={status}
      onHide={onHide}
      detailContent={detailContent}
    >
      <div className="camera-widget-body">
        {/* Stream image area */}
        <div className="camera-stream-area">
          {streamEnabled && device.streamUrl ? (
            hasError ? (
              <div className="stream-error">
                <span>⚠ Unavailable</span>
                <button onClick={() => setHasError(false)}>Retry</button>
              </div>
            ) : (
              <>
                {!imgLoaded && <div className="stream-connecting">Connecting…</div>}
                <img
                  ref={imgRef}
                  className="stream-img"
                  src={device.streamUrl}
                  alt={device.name}
                  style={imgLoaded ? {} : { visibility: 'hidden', position: 'absolute' }}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setHasError(true)}
                />
              </>
            )
          ) : (
            <div className="stream-disabled">Stream off</div>
          )}
        </div>

        {/* Quick controls */}
        <div className="camera-quick-controls">
          <button className={`widget-action-btn ${streamEnabled ? 'on' : 'off'}`} onClick={toggleStream}>
            {streamEnabled ? '🟢 Stream' : '🔴 Stream'}
          </button>
          <button className={`widget-action-btn ${isAcquiring ? 'on' : 'off'}`} onClick={toggleAcquire}>
            {isAcquiring ? '⏹ Stop' : '▶ Acquire'}
          </button>
        </div>
      </div>
    </Widget>
  );
}
