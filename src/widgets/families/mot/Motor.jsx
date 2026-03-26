import { useEffect, useState } from 'react';
import { usePv } from '../../../hooks/usePv.js';
import { PvDisplay, PvInput } from '../../../components/common/PvControls.jsx';

function resolveEnumChoices(pvMsg) {
  if (!pvMsg) return [];
  const c = pvMsg.choices || pvMsg.enumStrings || pvMsg.enum_strs || pvMsg.labels;
  return Array.isArray(c) ? c.map((v) => String(v)) : [];
}

function PoiControls({ pvPrefix, client }) {
  const [openMenu, setOpenMenu] = useState(false);
  const poiSelPv = usePv(client, pvPrefix ? `${pvPrefix}:POI_SEL` : null);
  const poiCurrPv = usePv(client, pvPrefix ? `${pvPrefix}:POI_CURR` : null);
  const liveChoices = resolveEnumChoices(poiSelPv);
  const [cachedChoices, setCachedChoices] = useState([]);
  useEffect(() => {
    if (liveChoices.length) setCachedChoices(liveChoices);
  }, [liveChoices]);
  const choices = liveChoices.length ? liveChoices : cachedChoices;
  const poiCurr = (poiCurrPv?.text ?? poiCurrPv?.value ?? '').toString().trim();
  const rawSel = poiSelPv?.value;
  const selIdx = (() => {
    if (typeof rawSel === 'number' && Number.isInteger(rawSel)) return rawSel;
    if (typeof rawSel === 'string') {
      const parsed = parseInt(rawSel, 10);
      if (Number.isInteger(parsed)) return parsed;
      const byLabel = choices.findIndex((c) => c === rawSel);
      if (byLabel >= 0) return byLabel;
    }
    return null;
  })();
  const hasPoiSel = choices.length > 0 || Number.isInteger(selIdx);
  const hasPoiCurr = poiCurr.length > 0;

  if (!hasPoiSel && !hasPoiCurr) return null;

  const currentIdx = Number.isInteger(selIdx) ? selIdx : 0;
  const putSel = (idx) => {
    if (!client?.put || !pvPrefix) return;
    client.put(`${pvPrefix}:POI_SEL`, idx);
  };

  const goPoi = () => {
    if (!client?.put || !pvPrefix) return;
    client.put(`${pvPrefix}:POI_GO`, 1);
  };

  return (
    <>
      <div className="motor-poi-panel">
        <span className="motor-poi-title">POI</span>
        {hasPoiSel && (
          <select
            className="pv-input motor-poi-select"
            value={currentIdx}
            onChange={(e) => putSel(parseInt(e.target.value, 10))}
            title={pvPrefix ? `${pvPrefix}:POI_SEL` : 'POI_SEL'}
          >
            {(choices.length ? choices : [String(currentIdx)]).map((label, idx) => (
              <option key={`${idx}-${label}`} value={idx}>{label}</option>
            ))}
          </select>
        )}
        {hasPoiSel && (
          <button
            type="button"
            className="widget-action-btn"
            onClick={goPoi}
            title={pvPrefix ? `${pvPrefix}:POI_GO` : 'POI_GO'}
          >
            Go
          </button>
        )}
        {hasPoiSel && (
          <button
            type="button"
            className="widget-action-btn"
            onClick={() => {
              goPoi();
              setOpenMenu(true);
            }}
            title="Open POI panel"
          >
            Poi..
          </button>
        )}
        {hasPoiCurr && <span className="motor-poi-curr">{poiCurr}</span>}
      </div>

      {openMenu && (
        <div className="bpm-wave-modal-backdrop" onClick={() => setOpenMenu(false)}>
          <div className="bpm-wave-modal motor-poi-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bpm-wave-modal-head">
              <strong>POI Menu</strong>
              <button type="button" className="bpm-wave-modal-close" onClick={() => setOpenMenu(false)}>Close</button>
            </div>
            <div className="motor-poi-modal-body">
              {hasPoiSel && (
                <>
                  <label className="pv-label">Selected POI</label>
                  <select
                    className="pv-input"
                    value={currentIdx}
                    onChange={(e) => putSel(parseInt(e.target.value, 10))}
                    title={pvPrefix ? `${pvPrefix}:POI_SEL` : 'POI_SEL'}
                  >
                    {(choices.length ? choices : [String(currentIdx)]).map((label, idx) => (
                      <option key={`modal-${idx}-${label}`} value={idx}>{label}</option>
                    ))}
                  </select>
                  <button type="button" className="widget-action-btn accent" onClick={goPoi}>Go Selected</button>
                </>
              )}
              {hasPoiCurr && (
                <>
                  <label className="pv-label">Current POI</label>
                  <div className="motor-poi-curr">{poiCurr}</div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * MotorWidget — Motor control panel with essential/detail views.
 *
 * Essential: readback, setpoint, relative move, tweak, home, stop.
 * Detail:    Full Phoebus Motor_TabExpert (Drive, Status, Dynamics, Resolution).
 *
 * Config: { pvPrefix, precision, showExpert, viewMode, title }
 */
export default function MotorWidget({ config, client }) {
  const pvPrefix = config.pvPrefix;
  const precision = config.precision ?? 4;
  const numberFormat = config.format || 'decimal';
  const showUnits = config.showUnits !== false;
  const viewMode = config.viewMode || 'essential';

  if (viewMode === 'detail') {
    return <MotorDetail pvPrefix={pvPrefix} client={client} precision={precision} numberFormat={numberFormat} showUnits={showUnits} />;
  }
  return <MotorEssential pvPrefix={pvPrefix} client={client} precision={precision} numberFormat={numberFormat} showUnits={showUnits} />;
}

/* ============================================================
   Essential view — compact motor controls
   ============================================================ */
function MotorEssential({ pvPrefix, client, precision, numberFormat, showUnits }) {
  const rbvPv = usePv(client, pvPrefix ? `${pvPrefix}.RBV` : null);
  const dmovPv = usePv(client, pvPrefix ? `${pvPrefix}.DMOV` : null);
  const hlsPv = usePv(client, pvPrefix ? `${pvPrefix}.HLS` : null);
  const llsPv = usePv(client, pvPrefix ? `${pvPrefix}.LLS` : null);
  const twvPv = usePv(client, pvPrefix ? `${pvPrefix}.TWV` : null);
  const moving = dmovPv?.value === 0;
  const highLimit = hlsPv?.value === 1;
  const lowLimit = llsPv?.value === 1;

  const put = (suffix, val) => { if (client && pvPrefix) client.put(`${pvPrefix}${suffix}`, val); };

  return (
    <div className="motor-widget-body motor-essential">
      {/* Readback bar */}
      <div className="motor-readback-bar">
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}.RBV` : ''} label="Pos" precision={precision} format={numberFormat} showUnit={showUnits} />
        {moving && <span className="motor-moving-badge">MOVING</span>}
        {highLimit && <span className="motor-limit-badge high">HI</span>}
        {lowLimit && <span className="motor-limit-badge low">LO</span>}
      </div>

      {/* Setpoint */}
      <div className="motor-essential-row">
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}.VAL` : ''} label="Set" step={0.0001} />
      </div>

      {/* Relative move */}
      <div className="motor-essential-row">
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}.RLV` : ''} label="Relative" step={0.01} />
      </div>

      {/* Tweak */}
      <div className="motor-essential-row motor-tweak-row">
        <button className="widget-action-btn" onClick={() => put('.TWR', 1)} title="Tweak Reverse">◀</button>
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}.TWV` : ''} label="Tweak" step={0.001} />
        <button className="widget-action-btn" onClick={() => put('.TWF', 1)} title="Tweak Forward">▶</button>
      </div>

      {/* Action buttons */}
      <div className="motor-essential-actions">
        <button className="widget-action-btn" onClick={() => put('.HOMF', 1)} title="Home Forward">🏠 Home</button>
        <button className="widget-action-btn motor-stop-btn" onClick={() => put('.STOP', 1)}>⏹ STOP</button>
      </div>

      <PoiControls pvPrefix={pvPrefix} client={client} />
    </div>
  );
}

/* ============================================================
   Detail view — full 4-tab expert panel (unchanged from before)
   ============================================================ */
function MotorDetail({ pvPrefix, client, precision, numberFormat, showUnits }) {
  const [tab, setTab] = useState('drive');

  const dmovPv = usePv(client, pvPrefix ? `${pvPrefix}.DMOV` : null);
  const hlsPv = usePv(client, pvPrefix ? `${pvPrefix}.HLS` : null);
  const llsPv = usePv(client, pvPrefix ? `${pvPrefix}.LLS` : null);
  const moving = dmovPv?.value === 0;
  const highLimit = hlsPv?.value === 1;
  const lowLimit = llsPv?.value === 1;

  const put = (suffix, val) => { if (client && pvPrefix) client.put(`${pvPrefix}${suffix}`, val); };

  const TABS = [
    { id: 'drive', label: 'Drive' },
    { id: 'status', label: 'Status' },
    { id: 'dynamics', label: 'Dynamics' },
    { id: 'resolution', label: 'Resolution' },
  ];

  return (
    <div className="motor-widget-body">
      <div className="motor-readback-bar">
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}.RBV` : ''} label="Pos" precision={precision} format={numberFormat} showUnit={showUnits} />
        {moving && <span className="motor-moving-badge">MOVING</span>}
        {highLimit && <span className="motor-limit-badge high">HI LIM</span>}
        {lowLimit && <span className="motor-limit-badge low">LO LIM</span>}
      </div>

      <div className="motor-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`motor-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="motor-tab-content">
        {tab === 'drive' && <DriveTab pvPrefix={pvPrefix} client={client} precision={precision} numberFormat={numberFormat} showUnits={showUnits} put={put} />}
        {tab === 'status' && <StatusTab pvPrefix={pvPrefix} client={client} numberFormat={numberFormat} showUnits={showUnits} put={put} />}
        {tab === 'dynamics' && <DynamicsTab pvPrefix={pvPrefix} client={client} numberFormat={numberFormat} showUnits={showUnits} put={put} />}
        {tab === 'resolution' && <ResolutionTab pvPrefix={pvPrefix} client={client} numberFormat={numberFormat} showUnits={showUnits} put={put} />}
      </div>
    </div>
  );
}

/** Motor record field row: label + read-only display + optional write input */
function FieldRow({ client, pvPrefix, suffix, label, precision = 4, format = 'decimal', showUnit = true, editable = false }) {
  return (
    <div className="motor-field-row">
      <span className="motor-field-label">{label}</span>
      <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}${suffix}` : ''} precision={precision} format={format} showUnit={showUnit} />
      {editable && (
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}${suffix}` : ''} step={0.0001} />
      )}
    </div>
  );
}

/* === Drive Tab === */
function DriveTab({ pvPrefix, client, precision, numberFormat, showUnits, put }) {
  return (
    <div className="motor-drive-tab">
      {/* Position readback & setpoint grid */}
      <div className="motor-section-title">Position</div>
      <div className="motor-grid-3">
        <span className="motor-col-header" />
        <span className="motor-col-header">User</span>
        <span className="motor-col-header">Dial</span>
        <span className="motor-col-header">Raw</span>

        <span className="motor-row-label">High Limit</span>
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}.HLM` : ''} step={0.01} />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}.DHLM` : ''} step={0.01} />
        <span className="motor-field-na">—</span>

        <span className="motor-row-label">Readback</span>
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}.RBV` : ''} precision={precision} format={numberFormat} showUnit={showUnits} />
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}.DRBV` : ''} precision={precision} format={numberFormat} showUnit={showUnits} />
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}.RRBV` : ''} precision={0} format={numberFormat} showUnit={showUnits} />

        <span className="motor-row-label">Setpoint</span>
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}.VAL` : ''} step={0.0001} />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}.DVAL` : ''} step={0.0001} />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}.RVAL` : ''} step={1} />

        <span className="motor-row-label">Low Limit</span>
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}.LLM` : ''} step={0.01} />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}.DLLM` : ''} step={0.01} />
        <span className="motor-field-na">—</span>
      </div>

      {/* Move controls */}
      <div className="motor-section-title">Move Controls</div>
      <div className="motor-move-controls">
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}.RLV` : ''} label="Relative" step={0.01} />
        <div className="motor-buttons">
          <button className="widget-action-btn" onClick={() => put('.JOGR', 1)}>◀ JogR</button>
          <button className="widget-action-btn" onClick={() => put('.JOGF', 1)}>JogF ▶</button>
          <button className="widget-action-btn" onClick={() => put('.HOMR', 1)}>🏠 HomR</button>
          <button className="widget-action-btn" onClick={() => put('.HOMF', 1)}>HomF 🏠</button>
          <button className="widget-action-btn motor-stop-btn" onClick={() => put('.STOP', 1)}>⏹ STOP</button>
        </div>
      </div>

      <div className="motor-section-title">POI</div>
      <PoiControls pvPrefix={pvPrefix} client={client} />
    </div>
  );
}

/* === Status Tab === */
function StatusTab({ pvPrefix, client, numberFormat, showUnits, put }) {
  const dmovPv = usePv(client, pvPrefix ? `${pvPrefix}.DMOV` : null);
  const mstaPv = usePv(client, pvPrefix ? `${pvPrefix}.MSTA` : null);
  const statPv = usePv(client, pvPrefix ? `${pvPrefix}.STAT` : null);
  const hlsPv = usePv(client, pvPrefix ? `${pvPrefix}.HLS` : null);
  const llsPv = usePv(client, pvPrefix ? `${pvPrefix}.LLS` : null);
  const spmgPv = usePv(client, pvPrefix ? `${pvPrefix}.SPMG` : null);
  const ablePv = usePv(client, pvPrefix ? `${pvPrefix}_able.VAL` : null);

  const moving = dmovPv?.value === 0;
  const msta = mstaPv?.value ?? 0;
  const commErr = (msta & 0x40) !== 0;   // bit 6: comm failure
  const ctrlErr = (msta & 0x200) !== 0;  // bit 9: controller error
  const initDone = (msta & 0x4000) !== 0; // bit 14: EA_HOME
  const highLimit = hlsPv?.value === 1;
  const lowLimit = llsPv?.value === 1;

  return (
    <div className="motor-status-tab">
      <div className="motor-section-title">Indicators</div>
      <div className="motor-status-grid">
        <StatusLed label="Moving" on={moving} color="#4f8ff7" />
        <StatusLed label="High Limit" on={highLimit} color="#ef4444" />
        <StatusLed label="Low Limit" on={lowLimit} color="#ef4444" />
        <StatusLed label="Comm Failure" on={commErr} color="#ef4444" />
        <StatusLed label="Controller Error" on={ctrlErr} color="#ef4444" />
        <StatusLed label="Homed" on={initDone} color="#34d399" />
      </div>

      <div className="motor-section-title">State</div>
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".STAT" label="Status" format={numberFormat} showUnit={showUnits} />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".SEVR" label="Severity" format={numberFormat} showUnit={showUnits} />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".MSTA" label="MSTA (hex)" format={numberFormat} showUnit={showUnits} />

      <div className="motor-section-title">Control</div>
      <div className="motor-control-row">
        <span className="motor-field-label">Enable</span>
        <div className="motor-choice-btns">
          <button className={`motor-choice-btn ${ablePv?.value === 0 ? 'active' : ''}`} onClick={() => put('_able.VAL', 0)}>Enable</button>
          <button className={`motor-choice-btn ${ablePv?.value === 1 ? 'active' : ''}`} onClick={() => put('_able.VAL', 1)}>Disable</button>
        </div>
      </div>
      <div className="motor-control-row">
        <span className="motor-field-label">SPMG</span>
        <div className="motor-choice-btns">
          {['Stop', 'Pause', 'Move', 'Go'].map((lbl, i) => (
            <button key={lbl} className={`motor-choice-btn ${spmgPv?.value === i ? 'active' : ''}`} onClick={() => put('.SPMG', i)}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Small inline status LED */
function StatusLed({ label, on, color }) {
  return (
    <div className="motor-status-led">
      <span className="motor-led-dot" style={{ background: on ? color : '#444', boxShadow: on ? `0 0 6px ${color}` : 'none' }} />
      <span className="motor-led-label">{label}</span>
    </div>
  );
}

/* === Dynamics Tab === */
function DynamicsTab({ pvPrefix, client, numberFormat, showUnits, put }) {
  return (
    <div className="motor-dynamics-tab">
      <div className="motor-section-title">Speed</div>
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".VELO" label="Velocity" format={numberFormat} showUnit={showUnits} editable />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".VMAX" label="Max Velocity" format={numberFormat} showUnit={showUnits} editable />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".VBAS" label="Base Velocity" format={numberFormat} showUnit={showUnits} editable />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".ACCL" label="Accel Time (s)" format={numberFormat} showUnit={showUnits} editable />

      <div className="motor-section-title">Backlash</div>
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".BDST" label="Distance" format={numberFormat} showUnit={showUnits} editable />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".BVEL" label="Velocity" format={numberFormat} showUnit={showUnits} editable />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".BACC" label="Accel Time" format={numberFormat} showUnit={showUnits} editable />

      <div className="motor-section-title">Jog</div>
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".JVEL" label="Jog Velocity" format={numberFormat} showUnit={showUnits} editable />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".JAR" label="Jog Accel" format={numberFormat} showUnit={showUnits} editable />

      <div className="motor-section-title">Homing</div>
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".HVEL" label="Home Velocity" format={numberFormat} showUnit={showUnits} editable />
    </div>
  );
}

/* === Resolution Tab === */
function ResolutionTab({ pvPrefix, client, numberFormat, showUnits, put }) {
  return (
    <div className="motor-resolution-tab">
      <div className="motor-section-title">Resolution</div>
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".MRES" label="Motor Step Size" format={numberFormat} showUnit={showUnits} editable />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".ERES" label="Encoder Step Size" format={numberFormat} showUnit={showUnits} editable />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".RRES" label="Readback Step Size" format={numberFormat} showUnit={showUnits} editable />

      <div className="motor-section-title">Offset & Direction</div>
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".OFF" label="User Offset" format={numberFormat} showUnit={showUnits} editable />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".DIR" label="Direction" format={numberFormat} showUnit={showUnits} />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".FOFF" label="Freeze Offset" format={numberFormat} showUnit={showUnits} />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".SET" label="Set/Use" format={numberFormat} showUnit={showUnits} />

      <div className="motor-section-title">Steps</div>
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".SREV" label="Steps/Revolution" format={numberFormat} showUnit={showUnits} editable />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".UREV" label="EGU/Revolution" format={numberFormat} showUnit={showUnits} editable />
      <FieldRow client={client} pvPrefix={pvPrefix} suffix=".EGU" label="Engineering Units" format={numberFormat} showUnit={showUnits} />
    </div>
  );
}
