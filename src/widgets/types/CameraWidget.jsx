import { useState, useRef, useEffect } from 'react';
import { usePv } from '../../hooks/usePv.js';
import { PvSlider, PvDisplay, PvInput } from '../../components/common/PvControls.jsx';

/**
 * CameraWidget — AreaDetector camera with essential/detail views.
 *
 * Essential: MJPEG stream + Stream/Acquire toggles + Exposure/Gain sliders.
 * Detail:    Full AreaDetector panels (Setup, Collect, Readout, Plugins, File).
 *
 * Config: { pvPrefix, streamUrl, streamEnabled, viewMode, title }
 */
function pvState(msg, enableLabel) {
  if (!msg) return null;
  const v = msg.value;
  const t = msg.text;
  if (v === undefined && t === undefined) return null;
  if (v === 1 || v === true) return true;
  if (typeof v === 'string' && (v === '1' || v === enableLabel || v === 'Yes' || v === 'true')) return true;
  if (typeof v === 'number' && v > 0) return true;
  if (typeof t === 'string' && (t === enableLabel || t === '1' || t === 'Yes')) return true;
  return false;
}

function formatStatNumber(value, digits = 0) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toFixed(digits);
}

export default function CameraWidget({ config, client }) {
  const viewMode = config.viewMode || 'essential';
  if (viewMode === 'detail') {
    return <CameraDetail config={config} client={client} />;
  }
  return <CameraEssential config={config} client={client} />;
}

/* ============================================================
   Essential view — stream + basic controls (existing behavior)
   ============================================================ */
function CameraEssential({ config, client }) {
  const pvPrefix = config.pvPrefix;
  const [hasError, setHasError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef(null);
  const timerRef = useRef(null);

  const streamEnablePv = usePv(client, pvPrefix ? `${pvPrefix}:Stream1:EnableCallbacks` : null);
  const acquirePv = usePv(client, pvPrefix ? `${pvPrefix}:Acquire` : null);
  const frameCounterPv = usePv(client, pvPrefix ? `${pvPrefix}:ArrayCounter_RBV` : null);
  const streamRatePv = usePv(client, pvPrefix ? `${pvPrefix}:Stream1:ArrayRate_RBV` : null);
  const arrayRatePv = usePv(client, pvPrefix ? `${pvPrefix}:ArrayRate_RBV` : null);

  const streamState = pvState(streamEnablePv, 'Enable');
  const acquireState = pvState(acquirePv, 'Acquire');
  const frameCounter = formatStatNumber(frameCounterPv?.value, 0);
  const frameRate = formatStatNumber(streamRatePv?.value ?? arrayRatePv?.value, 2);

  const showStream = streamState !== false && !!config.streamUrl;
  const streamEnabled = streamState === true;
  const isAcquiring = acquireState === true;

  useEffect(() => {
    setHasError(false);
    setImgLoaded(false);
  }, [streamState, pvPrefix]);

  useEffect(() => {
    if (!showStream || imgLoaded || hasError) {
      clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      if (imgRef.current?.naturalWidth > 0) {
        setImgLoaded(true);
        clearInterval(timerRef.current);
      }
    }, 300);
    return () => clearInterval(timerRef.current);
  }, [showStream, imgLoaded, hasError]);

  const toggleStream = () => {
    if (!client || !pvPrefix) return;
    client.put(`${pvPrefix}:Stream1:EnableCallbacks`, streamEnabled ? 0 : 1);
    setHasError(false);
  };

  const toggleAcquire = () => {
    if (!client || !pvPrefix) return;
    client.put(`${pvPrefix}:Acquire`, isAcquiring ? 0 : 1);
  };

  return (
    <div className="camera-widget-body">
      <div className="camera-stream-area">
        {showStream ? (
          hasError ? (
            <div className="stream-error">
              <span>⚠ Unavailable</span>
              <button onClick={() => setHasError(false)}>Retry</button>
            </div>
          ) : (
            <>
              {!imgLoaded && <div className="stream-connecting">{streamState === null ? 'PV unknown — trying stream…' : 'Connecting…'}</div>}
              <img
                ref={imgRef}
                className="stream-img"
                src={config.streamUrl}
                alt={config.title || pvPrefix}
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

      <div className="camera-quick-controls">
        <button className={`widget-action-btn ${streamEnabled ? 'on' : streamState === null ? 'unknown' : 'off'}`} onClick={toggleStream}>
          {streamEnabled ? '🟢 Stream' : streamState === null ? '⚪ Stream' : '🔴 Stream'}
        </button>
        <button className={`widget-action-btn ${isAcquiring ? 'on' : acquireState === null ? 'unknown' : 'off'}`} onClick={toggleAcquire}>
          {isAcquiring ? '⏹ Stop' : '▶ Acquire'}
        </button>
      </div>

      <div className="camera-stats-bar">
        <div className="camera-stat">
          <span className="camera-stat-label">Frame #</span>
          <span className="camera-stat-value">{frameCounter ?? '---'}</span>
        </div>
        <div className="camera-stat">
          <span className="camera-stat-label">Frame/s</span>
          <span className="camera-stat-value">{frameRate !== null ? `${frameRate} fps` : '--- fps'}</span>
        </div>
      </div>

      <div className="camera-sliders">
        <PvSlider client={client} pvName={pvPrefix ? `${pvPrefix}:AcquireTime` : ''} label="Exposure" min={0.001} max={10} step={0.001} />
        <PvSlider client={client} pvName={pvPrefix ? `${pvPrefix}:Gain` : ''} label="Gain" min={0} max={500} step={1} />
      </div>
    </div>
  );
}

/* ============================================================
   Detail view — Full AreaDetector panels
   (inspired by Phoebus Camera_CamPanel / ADBase / ADCollect)
   ============================================================ */
function CameraDetail({ config, client }) {
  const pvPrefix = config.pvPrefix;
  const [tab, setTab] = useState('collect');
  const [hasError, setHasError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef(null);
  const timerRef = useRef(null);

  const streamEnablePv = usePv(client, pvPrefix ? `${pvPrefix}:Stream1:EnableCallbacks` : null);
  const acquirePv = usePv(client, pvPrefix ? `${pvPrefix}:Acquire` : null);
  const streamState = pvState(streamEnablePv, 'Enable');
  const acquireState = pvState(acquirePv, 'Acquire');
  const showStream = streamState !== false && !!config.streamUrl;
  const streamEnabled = streamState === true;
  const isAcquiring = acquireState === true;

  useEffect(() => { setHasError(false); setImgLoaded(false); }, [streamState, pvPrefix]);
  useEffect(() => {
    if (!showStream || imgLoaded || hasError) { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      if (imgRef.current?.naturalWidth > 0) { setImgLoaded(true); clearInterval(timerRef.current); }
    }, 300);
    return () => clearInterval(timerRef.current);
  }, [showStream, imgLoaded, hasError]);

  const put = (suffix, val) => { if (client && pvPrefix) client.put(`${pvPrefix}${suffix}`, val); };

  const TABS = [
    { id: 'collect', label: 'Collect' },
    { id: 'setup', label: 'Setup' },
    { id: 'readout', label: 'Readout' },
    { id: 'plugins', label: 'Plugins' },
    { id: 'file', label: 'File' },
  ];

  return (
    <div className="camera-widget-body camera-detail">
      {/* Stream preview (compact) */}
      <div className="camera-stream-area camera-stream-compact">
        {showStream && !hasError ? (
          <>
            {!imgLoaded && <div className="stream-connecting">Connecting…</div>}
            <img ref={imgRef} className="stream-img" src={config.streamUrl}
              alt={config.title || pvPrefix}
              style={imgLoaded ? {} : { visibility: 'hidden', position: 'absolute' }}
              onLoad={() => setImgLoaded(true)} onError={() => setHasError(true)} />
          </>
        ) : (
          <div className="stream-disabled">{hasError ? '⚠ Stream unavailable' : 'Stream off'}</div>
        )}
      </div>

      {/* Quick controls bar */}
      <div className="camera-quick-controls">
        <button className={`widget-action-btn ${streamEnabled ? 'on' : 'off'}`}
          onClick={() => put(':Stream1:EnableCallbacks', streamEnabled ? 0 : 1)}>
          {streamEnabled ? '🟢 Stream' : '🔴 Stream'}
        </button>
        <button className={`widget-action-btn ${isAcquiring ? 'on' : 'off'}`}
          onClick={() => put(':Acquire', isAcquiring ? 0 : 1)}>
          {isAcquiring ? '⏹ Stop' : '▶ Acquire'}
        </button>
      </div>

      {/* Tab bar */}
      <div className="camera-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`motor-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div className="camera-tab-content">
        {tab === 'collect' && <CollectTab pvPrefix={pvPrefix} client={client} />}
        {tab === 'setup' && <SetupTab pvPrefix={pvPrefix} client={client} />}
        {tab === 'readout' && <ReadoutTab pvPrefix={pvPrefix} client={client} />}
        {tab === 'plugins' && <PluginsTab pvPrefix={pvPrefix} client={client} />}
        {tab === 'file' && <FileTab pvPrefix={pvPrefix} client={client} />}
      </div>
    </div>
  );
}

/** Reusable row for AD PV fields */
function ADField({ client, pvPrefix, suffix, label, editable = false, step }) {
  return (
    <div className="motor-field-row">
      <span className="motor-field-label">{label}</span>
      <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}${suffix}` : ''} precision={3} />
      {editable && <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}${suffix}` : ''} step={step || 1} />}
    </div>
  );
}

/* --- Collect Tab (ADCollect.bob) --- */
function CollectTab({ pvPrefix, client }) {
  return (
    <div className="camera-panel">
      <div className="motor-section-title">Acquisition</div>
      <ADField client={client} pvPrefix={pvPrefix} suffix=":AcquireTime" label="Exposure (s)" editable step={0.001} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":AcquirePeriod" label="Period (s)" editable step={0.001} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Gain" label="Gain" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":NumImages" label="Num Images" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":NumImagesCounter_RBV" label="Images Done" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ImageMode" label="Image Mode" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":TriggerMode" label="Trigger Mode" editable />

      <div className="motor-section-title">Status</div>
      <ADField client={client} pvPrefix={pvPrefix} suffix=":DetectorState_RBV" label="State" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":TimeRemaining_RBV" label="Time Remaining" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ArrayCounter_RBV" label="Array Counter" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ArrayRate_RBV" label="Frame Rate" />
    </div>
  );
}

/* --- Setup Tab (ADSetup.bob / ADBase) --- */
function SetupTab({ pvPrefix, client }) {
  return (
    <div className="camera-panel">
      <div className="motor-section-title">Detector Info</div>
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Manufacturer_RBV" label="Manufacturer" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Model_RBV" label="Model" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":MaxSizeX_RBV" label="Max Size X" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":MaxSizeY_RBV" label="Max Size Y" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":DataType" label="Data Type" editable />

      <div className="motor-section-title">Image Size</div>
      <ADField client={client} pvPrefix={pvPrefix} suffix=":SizeX" label="Size X" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":SizeY" label="Size Y" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":MinX" label="Min X" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":MinY" label="Min Y" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":BinX" label="Bin X" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":BinY" label="Bin Y" editable step={1} />

      <div className="motor-section-title">Color</div>
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ColorMode" label="Color Mode" editable />
    </div>
  );
}

/* --- Readout Tab --- */
function ReadoutTab({ pvPrefix, client }) {
  return (
    <div className="camera-panel">
      <div className="motor-section-title">Image Info</div>
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ArraySizeX_RBV" label="Array Size X" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ArraySizeY_RBV" label="Array Size Y" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ArraySize_RBV" label="Array Size (bytes)" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ColorMode_RBV" label="Color Mode" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":DataType_RBV" label="Data Type" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":BitsPerPixel_RBV" label="Bits/Pixel" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Codec_RBV" label="Codec" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":NDimensions_RBV" label="Num Dimensions" />
    </div>
  );
}

/* --- Plugins Tab (Stream, ROI, Stats, Proc) --- */
function PluginsTab({ pvPrefix, client }) {
  return (
    <div className="camera-panel">
      <div className="motor-section-title">Stream (MJPEG)</div>
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Stream1:EnableCallbacks" label="Enable" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Stream1:MinCallbackTime" label="Min Time (s)" editable step={0.01} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Stream1:DroppedArrays_RBV" label="Dropped" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Stream1:ArrayRate_RBV" label="Frame Rate" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Stream1:QueueSize" label="Queue Size" editable step={1} />

      <div className="motor-section-title">ROI1</div>
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ROI1:EnableCallbacks" label="Enable" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ROI1:MinX" label="Min X" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ROI1:MinY" label="Min Y" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ROI1:SizeX" label="Size X" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":ROI1:SizeY" label="Size Y" editable step={1} />

      <div className="motor-section-title">Stats1</div>
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Stats1:EnableCallbacks" label="Enable" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Stats1:MeanValue_RBV" label="Mean" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Stats1:SigmaValue_RBV" label="Sigma" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Stats1:MinValue_RBV" label="Min" />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":Stats1:MaxValue_RBV" label="Max" />
    </div>
  );
}

/* --- File Tab (save to disk) --- */
function FileTab({ pvPrefix, client }) {
  return (
    <div className="camera-panel">
      <div className="motor-section-title">File Output</div>
      <ADField client={client} pvPrefix={pvPrefix} suffix=":TIFF1:EnableCallbacks" label="TIFF Enable" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":TIFF1:FilePath" label="File Path" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":TIFF1:FileName" label="File Name" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":TIFF1:FileNumber" label="File Number" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":TIFF1:AutoIncrement" label="Auto Increment" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":TIFF1:AutoSave" label="Auto Save" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":TIFF1:WriteFile" label="Write File" editable />

      <div className="motor-section-title">HDF5</div>
      <ADField client={client} pvPrefix={pvPrefix} suffix=":HDF1:EnableCallbacks" label="HDF5 Enable" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":HDF1:FilePath" label="File Path" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":HDF1:FileName" label="File Name" editable />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":HDF1:NumCapture" label="Num Capture" editable step={1} />
      <ADField client={client} pvPrefix={pvPrefix} suffix=":HDF1:Capture" label="Capture" editable />
    </div>
  );
}
