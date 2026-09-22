import { useMemo, useState } from 'react';
import { useApp } from '../../../context/AppContext.jsx';
import { useLivePvs } from '../../../hooks/useLivePvs.js';
import { pvNumber, pvStateLabel } from '../../../services/pvEnum.js';
import {
  DEFAULT_TOLERANCE, RESTORABLE_STATES, SIMPLE_TOLERANCE, applyMagnets, createPvIo,
  currentReached, parseMagnetFile, stateReached, summarizeApply,
} from '../../../services/magnetProcedures.js';
import {
  ProcedureFrame, FilePicker, StatusBox, StateCell, DeltaCell, Led, NumberInput,
  useMagnets, fmt,
} from './MagnetParts.jsx';
import SaveAndRestoreBrowser from './SaveAndRestoreBrowser.jsx';

const toNumber = (text) => (text.trim() === '' ? NaN : Number(text));

/**
 * Restore — load a snapshot (.csv from Save) or a dataset (.dat, e.g. BTF_RUN.dat),
 * optionally edit the values, then push them to the selected power supplies:
 * STATE first, then CURRENT. Same as restore/ in unimag-opi.
 *
 * simple: the "Load Dataset" of unimag.bob (loadMagnets.bob): no per-row selection,
 * Retry or tolerance (fixed at 0.5 A), one Apply that pushes every row of the file.
 */
export default function MagnetRestoreView({ simple = false }) {
  const { pvwsClient } = useApp();
  const magnets = useMagnets();

  const [rows, setRows] = useState([]); // { base, name, prefix, sp: string, state, enabled }
  const [fileName, setFileName] = useState('');
  const [tolerance, setTolerance] = useState(String(DEFAULT_TOLERANCE));
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [sarOpen, setSarOpen] = useState(false);

  const tol = simple ? SIMPLE_TOLERANCE
    : Number.isFinite(Number(tolerance)) && tolerance.trim() !== '' && Number(tolerance) >= 0
      ? Number(tolerance)
      : DEFAULT_TOLERANCE;

  const pvNames = useMemo(
    () => rows.flatMap((r) => [
      `${r.base}:CURRENT_SP`, `${r.base}:CURRENT_RB`, `${r.base}:STATE_RB`, `${r.base}:STATE_SP`,
    ]),
    [rows],
  );
  const live = useLivePvs(pvwsClient, pvNames);

  const update = (base, patch) => setRows((rs) => rs.map((r) => (r.base === base ? { ...r, ...patch } : r)));
  const setAll = (enabled) => setRows((rs) => rs.map((r) => ({ ...r, enabled })));

  const loadFile = async (file) => {
    try {
      const { rows: parsed, skipped } = parseMagnetFile(file.name, await file.text(), magnets);
      const skippedText = skipped.length
        ? `   SKIPPED ${skipped.length}: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', ...' : ''}`
        : '';
      if (!parsed.length) {
        setMessage({ tone: 'warn', text: `No devices found in ${file.name}${skippedText}` });
        return;
      }
      setRows(parsed.map((r) => ({
        base: r.base, name: r.name, prefix: r.prefix, sp: String(r.current), state: r.state, enabled: true,
      })));
      setFileName(file.name);
      setMessage({ tone: skipped.length ? 'warn' : 'info', text: `Loaded ${parsed.length} devices from ${file.name}${skippedText}` });
    } catch (err) {
      setMessage({ tone: 'error', text: `Cannot load ${file.name}: ${err.message || err}` });
    }
  };

  // save-and-restore rows may carry only current or only state (a snapshot commonly holds one
  // config's worth of PVs, e.g. BTF's separate MAGNET_SP / MAGNET_STATE): '' for sp leaves the
  // field empty rather than showing the text "null", same as a freshly typed blank value.
  const loadFromSaveAndRestore = (srRows, skipped, label) => {
    setRows(srRows.map((r) => ({
      base: r.base, name: r.name, prefix: r.prefix,
      sp: r.current === null ? '' : String(r.current), state: r.state, enabled: true,
    })));
    setFileName(`save-and-restore: ${label}`);
    setSarOpen(false);
    const skippedText = skipped.length ? `   Ignored ${skipped.length} unrelated PV(s).` : '';
    setMessage({ tone: 'info', text: `Loaded ${srRows.length} devices from "${label}"${skippedText}` });
  };

  const view = rows.map((r) => {
    const nowSet = pvNumber(live.get(`${r.base}:CURRENT_SP`));
    const rb = pvNumber(live.get(`${r.base}:CURRENT_RB`));
    const statePv = live.get(`${r.base}:STATE_RB`);
    const stateRb = pvStateLabel(statePv);
    const sp = toNumber(r.sp);
    const stateOk = stateRb === null ? null : stateReached(r.state, stateRb);
    return {
      r, nowSet, rb, statePv, sp,
      delta: Number.isFinite(sp) && nowSet !== null ? sp - nowSet : null,
      stateDiff: r.state === '' ? null : stateOk,
      reached: stateOk === null || rb === null || !Number.isFinite(sp)
        ? null
        : stateOk && currentReached(r.state, sp, rb, tol),
    };
  });
  const checked = view.filter((v) => v.r.enabled);
  const atTarget = checked.filter((v) => v.reached).length;

  const run = async (retry) => {
    const devices = [];
    const errors = [];
    for (const { r, sp } of checked) {
      if (!Number.isFinite(sp)) errors.push(`${r.base}: bad restore value "${r.sp}"`);
      else devices.push({ base: r.base, current: sp, state: r.state });
    }
    if (!devices.length && !errors.length) {
      setMessage({ tone: 'warn', text: 'No power supply selected: load a file and check at least one row.' });
      return;
    }
    if (!retry && !window.confirm(`${simple ? 'Apply' : 'Restore'} ${devices.length} power supplies?`)) return;

    setMessage(null);
    setBusy('Setting states...');
    try {
      const result = await applyMagnets(devices, createPvIo(live.get, pvwsClient), {
        tolerance: tol, retry, forceCurrent: retry, onProgress: setBusy,
      });
      result.errors.unshift(...errors);
      setMessage({
        tone: result.errors.length || result.stateTimeout.length ? 'warn' : 'ok',
        text: `${retry ? 'Retry' : simple ? 'Apply' : 'Restore'} complete. ${summarizeApply(result, devices.length + errors.length)}`,
      });
    } catch (err) {
      setMessage({ tone: 'error', text: String(err.message || err) });
    } finally {
      setBusy('');
    }
  };

  const canAct = !!pvwsClient && !busy && rows.length > 0;

  return (
    <ProcedureFrame
      title={simple ? 'Load dataset' : 'Restore magnets'}
      subtitle={simple
        ? 'Load a snapshot (.csv) or a dataset (.dat) and apply it to all its power supplies.'
        : 'Load a snapshot (.csv from Save) or a dataset (.dat), then push the state and current of the checked power supplies.'}
    >
      {!pvwsClient && <StatusBox message={{ tone: 'error', text: 'PVWS is not configured: cannot read or write PVs.' }} />}

      <div className="mag-proc-toolbar">
        <FilePicker onFile={loadFile} disabled={!!busy} label="Choose snapshot / dataset..." />
        {!simple && (
          <button type="button" className="mag-proc-btn" disabled={!!busy} onClick={() => setSarOpen((o) => !o)}
            title="Browse the save-and-restore service and load a saved snapshot">
            Load from Save &amp; Restore...
          </button>
        )}
        <span className="mag-proc-filename">{fileName || 'no file loaded'}</span>
        <span className="mag-proc-spacer" />
        {!simple && (
          <label className="mag-proc-field" title="Current tolerance (A): the delta is green and the OK led green when within +/- this value">
            Tolerance
            <NumberInput value={tolerance} onChange={setTolerance} width={70} min="0" />
          </label>
        )}
        {rows.length > 0 && (
          <span className="mag-proc-count" title="Checked power supplies whose state and current reached the restore values">
            {atTarget}/{checked.length} at target
          </span>
        )}
        {!simple && (
          <button type="button" className="mag-proc-btn" disabled={!canAct} onClick={() => run(true)}
            title="Redo the restore, state first then current, for the checked power supplies whose led is not green">
            Retry
          </button>
        )}
        <button type="button" className="mag-proc-btn mag-proc-btn--primary" disabled={!canAct} onClick={() => run(false)}
          title={simple
            ? 'Push the set and state of every power supply of the file (STATE first, then CURRENT)'
            : 'Push the restore set and state of every checked power supply (STATE first, then CURRENT)'}>
          {simple ? 'Apply' : 'Restore Selected'}
        </button>
      </div>

      {sarOpen && !simple && (
        <SaveAndRestoreBrowser onLoad={loadFromSaveAndRestore} onClose={() => setSarOpen(false)} />
      )}

      <StatusBox message={message} busy={busy} />

      {rows.length > 0 && (
        <div className="mag-proc-table-wrap">
          <table className="mag-proc-table">
            <thead>
              <tr>
                {!simple && (
                  <th>
                    <input
                      type="checkbox"
                      checked={checked.length === rows.length}
                      onChange={(e) => setAll(e.target.checked)}
                      aria-label="select all"
                    />
                  </th>
                )}
                <th>Element</th>
                <th className="num">Now set</th>
                <th className="num">Readback</th>
                <th className="num">Restore</th>
                <th className="num">Delta</th>
                <th>State</th>
                <th>Restore st.</th>
                <th>St. diff</th>
                <th>OK</th>
              </tr>
            </thead>
            <tbody>
              {view.map(({ r, nowSet, rb, statePv, sp, delta, stateDiff, reached }) => (
                <tr key={r.base} className={r.enabled ? '' : 'disabled'}>
                  {!simple && (
                    <td>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => update(r.base, { enabled: e.target.checked })}
                        aria-label={`restore ${r.name}`}
                      />
                    </td>
                  )}
                  <td title={r.base}>{r.name}</td>
                  <td className="num">{fmt(nowSet)}</td>
                  <td className="num">{fmt(rb)}</td>
                  <td className="num">
                    <NumberInput
                      value={r.sp}
                      onChange={(text) => update(r.base, { sp: text })}
                      aria-invalid={!Number.isFinite(sp)}
                    />
                  </td>
                  <td className="num"><DeltaCell delta={delta} tolerance={tol} /></td>
                  <td><StateCell pv={statePv} /></td>
                  <td>
                    <select
                      className="mag-proc-input"
                      value={r.state}
                      onChange={(e) => update(r.base, { state: e.target.value })}
                    >
                      <option value="">(keep)</option>
                      {RESTORABLE_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    {stateDiff === null
                      ? <span className="mag-proc-delta">---</span>
                      : <span className={`mag-proc-delta ${stateDiff ? 'ok' : 'bad'}`}>{stateDiff ? 'OK' : 'DIFF'}</span>}
                  </td>
                  <td><Led reached={reached} title={reached === null ? 'waiting for values' : reached ? 'at restore values' : 'not at restore values'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ProcedureFrame>
  );
}
