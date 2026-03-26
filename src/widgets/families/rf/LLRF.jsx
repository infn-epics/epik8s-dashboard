import { useState } from 'react';
import { usePv } from '../../../hooks/usePv.js';
import { PvDisplay, PvInput } from '../../../components/common/PvControls.jsx';

/**
 * LLRFWidget — Libera Low-Level RF control panel.
 *
 * Essential: RF on/off, interlock status, amplitude/phase setpoints & readbacks,
 *            forward/reflected power for one channel.
 * Detail:    Per-channel readbacks (ch1-ch8), PI controller gains, feedback loop
 *            status, trigger source, conditioning status, VSWR.
 *
 * Config: { pvPrefix (= LLRF_NAME macro), viewMode, channel, precision }
 *
 * PV naming convention: $(pvPrefix):app:rf_ctrl, $(pvPrefix):vm:dsp:pi_amp:kp, etc.
 */
export default function LLRFWidget({ config, client }) {
  const pvPrefix = config.pvPrefix;
  const viewMode = config.viewMode || 'essential';
  const numberFormat = config.format || 'decimal';
  const showUnits = config.showUnits !== false;

  if (viewMode === 'detail') {
    return <LLRFDetail pvPrefix={pvPrefix} client={client} config={config} numberFormat={numberFormat} showUnits={showUnits} />;
  }
  return <LLRFEssential pvPrefix={pvPrefix} client={client} config={config} numberFormat={numberFormat} showUnits={showUnits} />;
}

/* ============================================================
   Essential view — compact LLRF overview
   ============================================================ */
function LLRFEssential({ pvPrefix, client, config, numberFormat, showUnits }) {
  const precision = config.precision ?? 2;
  const ch = config.channel || 'ch1';

  const rfCtrl = usePv(client, pvPrefix ? `${pvPrefix}:app:rf_ctrl` : null);
  const intlk = usePv(client, pvPrefix ? `${pvPrefix}:app:interlock:state` : null);
  const ampLoop = usePv(client, pvPrefix ? `${pvPrefix}:vm:dsp:pi_amp:loop_closed` : null);
  const phLoop = usePv(client, pvPrefix ? `${pvPrefix}:vm:dsp:pi_ph:loop_closed` : null);

  const rfOn = rfCtrl?.value === 1 || rfCtrl?.value === 'ON';
  const intlkOk = intlk?.value === 0 || intlk?.value === 'OK';

  const toggleRF = () => {
    if (client && pvPrefix) client.put(`${pvPrefix}:app:rf_ctrl`, rfOn ? 0 : 1);
  };

  return (
    <div className="llrf-widget-body llrf-essential">
      {/* Status bar */}
      <div className="llrf-status-bar">
        <button className={`widget-action-btn ${rfOn ? 'on' : 'off'}`} onClick={toggleRF}>
          {rfOn ? '🟢 RF ON' : '🔴 RF OFF'}
        </button>
        <span className={`llrf-intlk-badge ${intlkOk ? 'ok' : 'trip'}`}>
          {intlkOk ? '✓ Interlock OK' : '⚠ INTERLOCK'}
        </span>
      </div>

      {/* Feedback loop indicators */}
      <div className="llrf-loop-row">
        <span className={`llrf-loop-led ${ampLoop?.value ? 'closed' : 'open'}`}>
          Amp loop: {ampLoop?.value ? 'CLOSED' : 'OPEN'}
        </span>
        <span className={`llrf-loop-led ${phLoop?.value ? 'closed' : 'open'}`}>
          Phase loop: {phLoop?.value ? 'CLOSED' : 'OPEN'}
        </span>
      </div>

      {/* Setpoints */}
      <div className="llrf-section">
        <div className="llrf-field-row">
          <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:vm:dsp:sp_amp:power` : ''} label="Amp SP" precision={precision} format={numberFormat} showUnit={showUnits} unit="μW" />
          <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:vm:dsp:sp_ph:phase` : ''} label="Phase SP" precision={precision} format={numberFormat} showUnit={showUnits} unit="°" />
        </div>
      </div>

      {/* Channel readbacks */}
      <div className="llrf-section">
        <div className="llrf-section-title">Channel {ch}</div>
        <div className="llrf-field-row">
          <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:${ch}:power_remote.POWER` : ''} label="Power" precision={precision} format={numberFormat} showUnit={showUnits} unit="W" />
          <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:${ch}:amp_phase.PHASE_REMOTE` : ''} label="Phase" precision={precision} format={numberFormat} showUnit={showUnits} unit="°" />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Detail view — full tabbed LLRF panel
   ============================================================ */
function LLRFDetail({ pvPrefix, client, config, numberFormat, showUnits }) {
  const [tab, setTab] = useState('overview');
  const precision = config.precision ?? 3;

  const rfCtrl = usePv(client, pvPrefix ? `${pvPrefix}:app:rf_ctrl` : null);
  const intlk = usePv(client, pvPrefix ? `${pvPrefix}:app:interlock:state` : null);
  const rfOn = rfCtrl?.value === 1 || rfCtrl?.value === 'ON';
  const intlkOk = intlk?.value === 0 || intlk?.value === 'OK';

  const toggleRF = () => {
    if (client && pvPrefix) client.put(`${pvPrefix}:app:rf_ctrl`, rfOn ? 0 : 1);
  };

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'channels', label: 'Channels' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'conditioning', label: 'Conditioning' },
  ];

  return (
    <div className="llrf-widget-body llrf-detail">
      {/* Status bar */}
      <div className="llrf-status-bar">
        <button className={`widget-action-btn ${rfOn ? 'on' : 'off'}`} onClick={toggleRF}>
          {rfOn ? '🟢 RF ON' : '🔴 RF OFF'}
        </button>
        <span className={`llrf-intlk-badge ${intlkOk ? 'ok' : 'trip'}`}>
          {intlkOk ? '✓ Interlock OK' : '⚠ INTERLOCK'}
        </span>
      </div>

      {/* Tabs */}
      <div className="motor-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`motor-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab pvPrefix={pvPrefix} client={client} precision={precision} numberFormat={numberFormat} showUnits={showUnits} />}
      {tab === 'channels' && <ChannelsTab pvPrefix={pvPrefix} client={client} precision={precision} numberFormat={numberFormat} showUnits={showUnits} />}
      {tab === 'feedback' && <FeedbackTab pvPrefix={pvPrefix} client={client} precision={precision} numberFormat={numberFormat} showUnits={showUnits} />}
      {tab === 'conditioning' && <ConditioningTab pvPrefix={pvPrefix} client={client} config={config} precision={precision} numberFormat={numberFormat} showUnits={showUnits} />}
    </div>
  );
}

/* ── Detail sub-tabs ─────────────────────────────────────────── */

function OverviewTab({ pvPrefix, client, precision, numberFormat, showUnits }) {
  return (
    <div className="llrf-tab-body">
      <div className="llrf-section-title">Setpoints</div>
      <div className="llrf-field-row">
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:vm:dsp:sp_amp:power` : ''} label="Amp SP (μW)" step={0.1} />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:vm:dsp:sp_ph:phase` : ''} label="Phase SP (°)" step={0.1} />
      </div>

      <div className="llrf-section-title">Trigger</div>
      <div className="llrf-field-row">
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:tcm:trig:source` : ''} label="Trigger Src" />
      </div>

      <div className="llrf-section-title">Averaging</div>
      <div className="llrf-field-row">
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:ad1:markers:avg_dur` : ''} label="Avg Duration (μs)" step={1} />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:ad1:markers:offset` : ''} label="Offset (μs)" step={1} />
      </div>
    </div>
  );
}

function ChannelsTab({ pvPrefix, client, precision, numberFormat, showUnits }) {
  const channels = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7', 'ch8'];
  return (
    <div className="llrf-tab-body">
      <table className="llrf-ch-table">
        <thead>
          <tr><th>Ch</th><th>Power (W)</th><th>Phase (°)</th><th>Amp Avg (V²)</th></tr>
        </thead>
        <tbody>
          {channels.map(ch => (
            <tr key={ch}>
              <td className="llrf-ch-name">{ch}</td>
              <td><PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:${ch}:power_remote.POWER` : ''} precision={precision} format={numberFormat} showUnit={showUnits} /></td>
              <td><PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:${ch}:amp_phase.PHASE_REMOTE` : ''} precision={precision} format={numberFormat} showUnit={showUnits} /></td>
              <td><PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:${ch}:amp_average_s.AVERAGE` : ''} precision={precision} format={numberFormat} showUnit={showUnits} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeedbackTab({ pvPrefix, client, precision, numberFormat, showUnits }) {
  return (
    <div className="llrf-tab-body">
      <div className="llrf-section-title">Amplitude PI Controller</div>
      <div className="llrf-field-row">
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:vm:dsp:pi_amp:loop_closed` : ''} label="Loop" />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:vm:dsp:pi_amp:kp` : ''} label="Kp" step={0.001} />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:vm:dsp:pi_amp:ki` : ''} label="Ki" step={0.001} />
      </div>

      <div className="llrf-section-title">Phase PI Controller</div>
      <div className="llrf-field-row">
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:vm:dsp:pi_ph:loop_closed` : ''} label="Loop" />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:vm:dsp:pi_ph:kp` : ''} label="Kp" step={0.001} />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:vm:dsp:pi_ph:ki` : ''} label="Ki" step={0.001} />
      </div>

      <div className="llrf-section-title">Amplitude Loop Channel Mask</div>
      <div className="llrf-field-row llrf-mask-row">
        {[1,2,3,4,5,6,7,8].map(n => (
          <PvDisplay key={n} client={client} pvName={pvPrefix ? `${pvPrefix}:ad1:ch_mask:amp_loop:ch${n}` : ''} label={`ch${n}`} />
        ))}
      </div>

      <div className="llrf-section-title">Phase Loop Channel Mask</div>
      <div className="llrf-field-row llrf-mask-row">
        {[1,2,3,4,5,6,7,8].map(n => (
          <PvDisplay key={n} client={client} pvName={pvPrefix ? `${pvPrefix}:ad1:ch_mask:ph_loop:ch${n}` : ''} label={`ch${n}`} />
        ))}
      </div>
    </div>
  );
}

function ConditioningTab({ pvPrefix, client, config, precision, numberFormat, showUnits }) {
  const condPv = config.conditioningPrefix || '';
  return (
    <div className="llrf-tab-body">
      {!condPv ? (
        <div className="llrf-placeholder">Set Conditioning Prefix in config to enable.</div>
      ) : (
        <>
          <div className="llrf-section-title">Status</div>
          <div className="llrf-field-row">
            <PvDisplay client={client} pvName={`${condPv}:CONDITIONING_STATUS`} label="Active" />
            <PvDisplay client={client} pvName={`${condPv}:CONDITIONING_TARGET`} label="Target" unit="kW" precision={precision} format={numberFormat} showUnit={showUnits} />
          </div>

          <div className="llrf-section-title">Power Raise</div>
          <div className="llrf-field-row">
            <PvDisplay client={client} pvName={`${condPv}:POWER_RAISE_STATUS`} label="Raising" />
            <PvDisplay client={client} pvName={`${condPv}:POWER_RAISE_STEP`} label="Step" unit="kW" />
            <PvDisplay client={client} pvName={`${condPv}:POWER_RAISE_WAIT`} label="Wait" unit="min" />
            <PvDisplay client={client} pvName={`${condPv}:RAISE_COUNT`} label="Count" precision={0} format={numberFormat} showUnit={showUnits} />
          </div>

          <div className="llrf-section-title">Last Interlock</div>
          <div className="llrf-field-row">
            <PvDisplay client={client} pvName={`${condPv}:LAST_INTLK_DATETIME`} label="Time" />
            <PvDisplay client={client} pvName={`${condPv}:LAST_INTLK_SOURCE`} label="Source" />
          </div>
        </>
      )}
    </div>
  );
}
