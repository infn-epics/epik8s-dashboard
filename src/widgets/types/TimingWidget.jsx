import { useState } from 'react';
import { usePv } from '../../hooks/usePv.js';
import { PvDisplay, PvInput, getPvText } from '../../components/common/PvControls.jsx';

/**
 * TimingWidget — MRF Timing system (EVG + EVR) control panel.
 *
 * Essential: EVG enable, PLL lock, event clock freq, EVR link status,
 *            delay generator summary table (label, delay, width, event).
 * Detail:    Full EVG config (clock, MXC prescalers, trigger events, AC trigger),
 *            EVR delay generators (all DG0-DG11), outputs, SFP diagnostics.
 *
 * Config: { pvPrefix (= $(P) base prefix e.g. "MRF01:EVG"),
 *           evrPrefix (e.g. "MRF01:EVR" for the first EVR),
 *           numDelayGens (default 9), viewMode, precision }
 *
 * PV conventions from mrfioc2: $(P):EvtClkFrequency-RB, $(P):DlyGen0Delay-SP, etc.
 */
export default function TimingWidget({ config, client }) {
  const viewMode = config.viewMode || 'essential';

  if (viewMode === 'detail') {
    return <TimingDetail config={config} client={client} />;
  }
  return <TimingEssential config={config} client={client} />;
}

/* ============================================================
   Essential view — compact timing overview
   ============================================================ */
function TimingEssential({ config, client }) {
  const evgPrefix = config.pvPrefix;
  const evrPrefix = config.evrPrefix || '';
  const numDG = config.numDelayGens ?? 9;
  const precision = config.precision ?? 2;

  const evgEnable = usePv(client, evgPrefix ? `${evgPrefix}:Enable-Sel` : null);
  const evgPll = usePv(client, evgPrefix ? `${evgPrefix}:EvtClkPll-Sts` : null);
  const evtClkFreq = usePv(client, evgPrefix ? `${evgPrefix}:EvtClkFrequency-RB` : null);
  const evrLink = usePv(client, evrPrefix ? `${evrPrefix}:Link-Sts` : null);
  const evrPll = usePv(client, evrPrefix ? `${evrPrefix}:Pll-Sts` : null);

  const evgOn = evgEnable?.value === 1 || evgEnable?.value === 'Enabled';
  const pllOk = evgPll?.value === 0 || String(evgPll?.value).includes('Lock');
  const linkOk = evrLink?.value === 1 || String(evrLink?.value).includes('Link');

  return (
    <div className="timing-widget-body timing-essential">
      {/* Status row */}
      <div className="timing-status-bar">
        <span className={`timing-status-led ${evgOn ? 'ok' : 'off'}`}>
          EVG: {evgOn ? '● Enabled' : '○ Disabled'}
        </span>
        <span className={`timing-status-led ${pllOk ? 'ok' : 'err'}`}>
          PLL: {pllOk ? '● Lock' : '○ Unlock'}
        </span>
        {evrPrefix && (
          <span className={`timing-status-led ${linkOk ? 'ok' : 'err'}`}>
            EVR: {linkOk ? '● Link' : '○ No Link'}
          </span>
        )}
      </div>

      {/* Clock */}
      <div className="timing-field-row">
        <PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:EvtClkFrequency-RB` : ''} label="Evt Clk" precision={3} unit="MHz" />
      </div>

      {/* Delay generator summary table */}
      {evrPrefix && (
        <div className="timing-section">
          <div className="timing-section-title">Delay Generators</div>
          <table className="timing-dg-table">
            <thead>
              <tr><th>#</th><th>Label</th><th>Delay</th><th>Width</th><th>Evt</th></tr>
            </thead>
            <tbody>
              {Array.from({ length: numDG }, (_, i) => (
                <DGRowEssential key={i} idx={i} evrPrefix={evrPrefix} client={client} precision={precision} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DGRowEssential({ idx, evrPrefix, client, precision }) {
  const label = usePv(client, `${evrPrefix}:DlyGen${idx}Label-I`);
  const delay = usePv(client, `${evrPrefix}:DlyGen${idx}Delay-SP`);
  const width = usePv(client, `${evrPrefix}:DlyGen${idx}Width-SP`);
  const evt = usePv(client, `${evrPrefix}:DlyGen${idx}EvtTrig0-SP`);

  return (
    <tr>
      <td className="timing-dg-idx">DG{idx}</td>
      <td className="timing-dg-label">{getPvText(label) || '—'}</td>
      <td>{delay?.value != null ? Number(delay.value).toFixed(precision) : '—'}</td>
      <td>{width?.value != null ? Number(width.value).toFixed(precision) : '—'}</td>
      <td>{evt?.value ?? '—'}</td>
    </tr>
  );
}

/* ============================================================
   Detail view — full tabbed timing panel
   ============================================================ */
function TimingDetail({ config, client }) {
  const [tab, setTab] = useState('evg');
  const evgPrefix = config.pvPrefix;
  const evrPrefix = config.evrPrefix || '';
  const numDG = config.numDelayGens ?? 9;
  const precision = config.precision ?? 3;

  const TABS = [
    { id: 'evg', label: 'EVG Clock' },
    { id: 'mxc', label: 'MXC' },
    { id: 'trigevt', label: 'Trig Events' },
    { id: 'dlygen', label: 'Delay Gens' },
    { id: 'outputs', label: 'Outputs' },
    { id: 'sfp', label: 'SFP/Link' },
  ];

  return (
    <div className="timing-widget-body timing-detail">
      {/* Tabs */}
      <div className="motor-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`motor-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'evg' && <EvgClockTab evgPrefix={evgPrefix} client={client} precision={precision} />}
      {tab === 'mxc' && <MxcTab evgPrefix={evgPrefix} client={client} />}
      {tab === 'trigevt' && <TrigEvtTab evgPrefix={evgPrefix} client={client} />}
      {tab === 'dlygen' && <DlyGenTab evrPrefix={evrPrefix} client={client} numDG={numDG} precision={precision} />}
      {tab === 'outputs' && <OutputsTab evrPrefix={evrPrefix} client={client} />}
      {tab === 'sfp' && <SfpTab evgPrefix={evgPrefix} evrPrefix={evrPrefix} client={client} />}
    </div>
  );
}

/* ── Detail sub-tabs ─────────────────────────────────────────── */

function EvgClockTab({ evgPrefix, client, precision }) {
  return (
    <div className="timing-tab-body">
      <div className="timing-section-title">Event Clock</div>
      <div className="timing-field-row">
        <PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:EvtClkFrequency-RB` : ''} label="Frequency" precision={precision} unit="MHz" />
        <PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:EvtClkPll-Sts` : ''} label="PLL Status" />
      </div>
      <div className="timing-field-row">
        <PvInput client={client} pvName={evgPrefix ? `${evgPrefix}:EvtClkRFFreq-SP` : ''} label="RF Input (MHz)" step={0.001} />
        <PvInput client={client} pvName={evgPrefix ? `${evgPrefix}:EvtClkRFDiv-SP` : ''} label="RF Divider" step={1} />
      </div>
      <div className="timing-field-row">
        <PvInput client={client} pvName={evgPrefix ? `${evgPrefix}:EvtClkFracSynFreq-SP` : ''} label="Frac Synth (MHz)" step={0.001} />
        <PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:EvtClkSource-Sel` : ''} label="Clock Source" />
      </div>

      <div className="timing-section-title">AC Trigger</div>
      <div className="timing-field-row">
        <PvInput client={client} pvName={evgPrefix ? `${evgPrefix}:AcTrigDivider-SP` : ''} label="Divider" step={1} />
        <PvInput client={client} pvName={evgPrefix ? `${evgPrefix}:AcTrigPhase-SP` : ''} label="Phase" step={0.1} />
        <PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:AcTrigBypass-Sel` : ''} label="Bypass" />
        <PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:AcTrigSyncSrc-Sel` : ''} label="Sync Src" />
      </div>

      <div className="timing-section-title">General</div>
      <div className="timing-field-row">
        <PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:Enable-Sel` : ''} label="EVG Enable" />
        <PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:PpsInp-Sel` : ''} label="PPS Input" />
        <PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:Timestamp-RB` : ''} label="Timestamp" />
      </div>
    </div>
  );
}

function MxcTab({ evgPrefix, client }) {
  const mxcs = [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <div className="timing-tab-body">
      <div className="timing-section-title">Multiplexed Counters</div>
      <table className="timing-dg-table">
        <thead>
          <tr><th>MXC</th><th>Prescaler</th><th>Frequency (Hz)</th></tr>
        </thead>
        <tbody>
          {mxcs.map(n => (
            <tr key={n}>
              <td>Mxc{n}</td>
              <td><PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:Mxc${n}Prescaler-SP` : ''} precision={0} /></td>
              <td><PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:Mxc${n}Frequency-RB` : ''} precision={3} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrigEvtTab({ evgPrefix, client }) {
  const events = [0, 1, 2, 3];
  return (
    <div className="timing-tab-body">
      <div className="timing-section-title">Trigger Events</div>
      <table className="timing-dg-table">
        <thead>
          <tr><th>Event</th><th>Event Code</th><th>Trigger Source</th></tr>
        </thead>
        <tbody>
          {events.map(n => (
            <tr key={n}>
              <td>TrigEvt{n}</td>
              <td><PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:TrigEvt${n}EvtCode-SP` : ''} precision={0} /></td>
              <td><PvDisplay client={client} pvName={evgPrefix ? `${evgPrefix}:TrigEvt${n}TrigSrc-Sel` : ''} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DlyGenTab({ evrPrefix, client, numDG, precision }) {
  if (!evrPrefix) return <div className="timing-placeholder">Set EVR Prefix to see delay generators.</div>;

  return (
    <div className="timing-tab-body">
      <div className="timing-section-title">EVR Delay Generators</div>
      <table className="timing-dg-table timing-dg-detail">
        <thead>
          <tr><th>#</th><th>Label</th><th>Delay</th><th>Width</th><th>Polarity</th><th>Enabled</th><th>Evt Trig0</th></tr>
        </thead>
        <tbody>
          {Array.from({ length: numDG }, (_, i) => (
            <DGRowDetail key={i} idx={i} evrPrefix={evrPrefix} client={client} precision={precision} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DGRowDetail({ idx, evrPrefix, client, precision }) {
  const label = usePv(client, `${evrPrefix}:DlyGen${idx}Label-I`);
  const polarity = usePv(client, `${evrPrefix}:DlyGen${idx}Polarity-Sel`);
  const enabled = usePv(client, `${evrPrefix}:DlyGen${idx}Ena-Sel`);

  return (
    <tr>
      <td className="timing-dg-idx">DG{idx}</td>
      <td className="timing-dg-label">{getPvText(label) || '—'}</td>
      <td><PvInput client={client} pvName={`${evrPrefix}:DlyGen${idx}Delay-SP`} step={0.01} /></td>
      <td><PvInput client={client} pvName={`${evrPrefix}:DlyGen${idx}Width-SP`} step={1} /></td>
      <td>{polarity?.value ?? '—'}</td>
      <td>{enabled?.value != null ? (enabled.value ? '✓' : '—') : '—'}</td>
      <td><PvDisplay client={client} pvName={`${evrPrefix}:DlyGen${idx}EvtTrig0-SP`} precision={0} /></td>
    </tr>
  );
}

function OutputsTab({ evrPrefix, client }) {
  if (!evrPrefix) return <div className="timing-placeholder">Set EVR Prefix to see outputs.</div>;

  // Front Panel outputs (FP0-FP3) and Front Panel Universal (FPUV0-FPUV3)
  const fpOutputs = [
    { name: 'OutFP0', label: 'FP Out 0' },
    { name: 'OutFP1', label: 'FP Out 1' },
    { name: 'OutFP2', label: 'FP Out 2' },
    { name: 'OutFP3', label: 'FP Out 3' },
    { name: 'OutFPUV0', label: 'FPUV Out 0' },
    { name: 'OutFPUV1', label: 'FPUV Out 1' },
    { name: 'OutFPUV2', label: 'FPUV Out 2' },
    { name: 'OutFPUV3', label: 'FPUV Out 3' },
  ];

  return (
    <div className="timing-tab-body">
      <div className="timing-section-title">EVR Outputs</div>
      <table className="timing-dg-table">
        <thead>
          <tr><th>Output</th><th>Label</th><th>Pulse Source</th></tr>
        </thead>
        <tbody>
          {fpOutputs.map(o => (
            <OutputRow key={o.name} outName={o.name} outLabel={o.label} evrPrefix={evrPrefix} client={client} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutputRow({ outName, outLabel, evrPrefix, client }) {
  const label = usePv(client, `${evrPrefix}:${outName}Label-I`);
  const src = usePv(client, `${evrPrefix}:${outName}SrcPulse-SP`);

  return (
    <tr>
      <td>{outLabel}</td>
      <td className="timing-dg-label">{getPvText(label) || '—'}</td>
      <td>{src?.value ?? '—'}</td>
    </tr>
  );
}

function SfpTab({ evgPrefix, evrPrefix, client }) {
  return (
    <div className="timing-tab-body">
      {evgPrefix && (
        <>
          <div className="timing-section-title">EVG Status</div>
          <div className="timing-field-row">
            <PvDisplay client={client} pvName={`${evgPrefix}:EvtClkPll-Sts`} label="PLL" />
            <PvDisplay client={client} pvName={`${evgPrefix}:DbusStatus-RB`} label="DBUS" />
          </div>
        </>
      )}

      {evrPrefix && (
        <>
          <div className="timing-section-title">EVR Link</div>
          <div className="timing-field-row">
            <PvDisplay client={client} pvName={`${evrPrefix}:Link-Sts`} label="Link" />
            <PvDisplay client={client} pvName={`${evrPrefix}:Pll-Sts`} label="PLL" />
            <PvDisplay client={client} pvName={`${evrPrefix}:LinkClk-I`} label="Link Clk" unit="MHz" precision={3} />
          </div>
          <div className="timing-field-row">
            <PvDisplay client={client} pvName={`${evrPrefix}:CntRxErr-I`} label="RX Err" precision={0} />
            <PvDisplay client={client} pvName={`${evrPrefix}:CntLinkTimo-I`} label="Timeouts" precision={0} />
            <PvDisplay client={client} pvName={`${evrPrefix}:Time-I`} label="Time" />
          </div>

          <div className="timing-section-title">EVR SFP</div>
          <div className="timing-field-row">
            <PvDisplay client={client} pvName={`${evrPrefix}:SFPPwrRX-I`} label="RX Power" unit="mW" precision={3} />
            <PvDisplay client={client} pvName={`${evrPrefix}:SFPPwrTX-I`} label="TX Power" unit="mW" precision={3} />
            <PvDisplay client={client} pvName={`${evrPrefix}:SFPT-I`} label="Temp" unit="°C" precision={1} />
          </div>
          <div className="timing-field-row">
            <PvDisplay client={client} pvName={`${evrPrefix}:SFPVendor-I`} label="Vendor" />
            <PvDisplay client={client} pvName={`${evrPrefix}:SFPPart-I`} label="Part" />
            <PvDisplay client={client} pvName={`${evrPrefix}:SFPSerial-I`} label="Serial" />
          </div>
        </>
      )}
    </div>
  );
}
