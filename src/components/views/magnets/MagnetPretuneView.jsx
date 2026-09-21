import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../../context/AppContext.jsx';
import { useLivePvs } from '../../../hooks/useLivePvs.js';
import { pvNumber, pvStateLabel } from '../../../services/pvEnum.js';
import {
  DEFAULT_TOLERANCE, RESTORABLE_STATES, applyMagnets, createPvIo, effectiveSteps,
  parseMagnetFile, pretuneRow, stateReached, summarizeApply,
} from '../../../services/magnetProcedures.js';
import {
  ProcedureFrame, FilePicker, StatusBox, StateCell, DeltaCell, NumberInput,
  useMagnets, fmt,
} from './MagnetParts.jsx';

const toNumber = (text) => (text.trim() === '' ? NaN : Number(text));

/**
 * Pretune — bring the magnets from where they are (I0) to a dataset (I1) in n
 * steps. Each step pushes STATE first, then CURRENT, of the checked power supplies.
 * Same as pretune/ in unimag-opi.
 *
 * I0 is captured once (when the file is loaded, nsteps changes or "Restart" is
 * pressed) and stays fixed: the steps must not follow the readback while the
 * supplies ramp.
 */
export default function MagnetPretuneView() {
  const { pvwsClient } = useApp();
  const magnets = useMagnets();

  const [rows, setRows] = useState([]); // { base, name, prefix, target: string, state, enabled }
  const [fileName, setFileName] = useState('');
  const [nsteps, setNsteps] = useState('0');
  const [counter, setCounter] = useState(0);
  const [baselines, setBaselines] = useState({}); // base -> I0
  const [tolerance, setTolerance] = useState(String(DEFAULT_TOLERANCE));
  const [filterDiff, setFilterDiff] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  const tol = Number.isFinite(Number(tolerance)) && tolerance.trim() !== '' && Number(tolerance) >= 0
    ? Number(tolerance)
    : DEFAULT_TOLERANCE;
  const n = effectiveSteps(nsteps);

  const pvNames = useMemo(
    () => rows.flatMap((r) => [
      `${r.base}:CURRENT_SP`, `${r.base}:CURRENT_RB`, `${r.base}:STATE_RB`, `${r.base}:STATE_SP`,
    ]),
    [rows],
  );
  const live = useLivePvs(pvwsClient, pvNames);

  // Capture I0 of the rows that have none yet, as soon as their readback is known.
  useEffect(() => {
    const found = {};
    for (const r of rows) {
      if (baselines[r.base] !== undefined) continue;
      const rb = pvNumber(live.get(`${r.base}:CURRENT_RB`));
      if (rb !== null) found[r.base] = rb;
    }
    if (Object.keys(found).length) setBaselines((b) => ({ ...b, ...found }));
  }, [live.version, live.get, rows, baselines]);

  const update = (base, patch) => setRows((rs) => rs.map((r) => (r.base === base ? { ...r, ...patch } : r)));
  const setAll = (enabled) => setRows((rs) => rs.map((r) => ({ ...r, enabled })));

  const restart = () => {
    setCounter(0);
    setBaselines({});
  };

  const changeSteps = (value) => {
    setNsteps(value);
    restart();
  };

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
        base: r.base, name: r.name, prefix: r.prefix, target: String(r.current), state: r.state, enabled: true,
      })));
      restart();
      setFileName(file.name);
      setMessage({ tone: skipped.length ? 'warn' : 'info', text: `Loaded ${parsed.length} devices from ${file.name}${skippedText}` });
    } catch (err) {
      setMessage({ tone: 'error', text: `Cannot load ${file.name}: ${err.message || err}` });
    }
  };

  const view = rows.map((r) => {
    const i0 = baselines[r.base];
    const i1 = toNumber(r.target);
    const rb = pvNumber(live.get(`${r.base}:CURRENT_RB`));
    const statePv = live.get(`${r.base}:STATE_RB`);
    const stateRb = pvStateLabel(statePv);
    const steps = i0 !== undefined && Number.isFinite(i1) ? pretuneRow(i0, i1, nsteps, counter) : null;
    return {
      r, i0, i1, rb, statePv, steps,
      delta: Number.isFinite(i1) && rb !== null ? i1 - rb : null,
      stepDelta: steps && rb !== null ? steps.set - rb : null,
      stateOk: r.state === '' || stateRb === null ? null : stateReached(r.state, stateRb),
    };
  });
  const shown = filterDiff
    ? view.filter((v) => v.delta === null || Math.abs(v.delta) > tol || v.stateOk === false)
    : view;
  const checkedCount = view.filter((v) => v.r.enabled).length;

  const runStep = async (kind, { delta = 0, retry = false } = {}) => {
    const devices = [];
    const errors = [];
    for (const v of view) {
      if (!v.r.enabled) continue;
      if (!v.steps) {
        errors.push(`${v.r.base}: ${v.i0 === undefined ? 'no I0 yet (readback not received)' : `bad I1 "${v.r.target}"`}`);
        continue;
      }
      devices.push({ base: v.r.base, current: v.steps[kind], state: v.r.state });
    }
    if (!devices.length) {
      setMessage({
        tone: 'warn',
        text: errors.length
          ? `Nothing applied:\n${errors.slice(0, 10).join('\n')}`
          : 'No power supply selected: load a file and check at least one row.',
      });
      return;
    }

    const label = retry ? `Retry of step ${counter}` : delta > 0 ? `Step ${counter + 1}` : `Back to step ${counter - 1}`;
    setMessage(null);
    setBusy('Setting states...');
    try {
      const result = await applyMagnets(devices, createPvIo(live.get, pvwsClient), {
        tolerance: tol, retry, forceCurrent: true, onProgress: setBusy,
      });
      result.errors.unshift(...errors);
      setMessage({
        tone: result.errors.length || result.stateTimeout.length ? 'warn' : 'ok',
        text: `${label}. ${summarizeApply(result, devices.length + errors.length)}`,
      });
      if (delta) setCounter((c) => c + delta);
    } catch (err) {
      setMessage({ tone: 'error', text: String(err.message || err) });
    } finally {
      setBusy('');
    }
  };

  // States only: rows without a state to restore are left alone.
  const setStates = () => {
    let done = 0;
    let skipped = 0;
    for (const { r } of view) {
      if (!r.enabled) continue;
      if (!RESTORABLE_STATES.includes(r.state)) {
        skipped += 1;
        continue;
      }
      pvwsClient.put(`${r.base}:STATE_SP`, r.state);
      done += 1;
    }
    setMessage({
      tone: done ? 'ok' : 'warn',
      text: `State set on ${done} power supplies${skipped ? `, ${skipped} without a state to restore left alone` : ''}.`,
    });
  };

  const ready = !!pvwsClient && !busy && rows.length > 0;

  return (
    <ProcedureFrame
      title="Pretune magnets"
      subtitle="Load a dataset (.dat) or snapshot (.csv), choose the number of steps and walk the checked power supplies from where they are to the dataset."
    >
      {!pvwsClient && <StatusBox message={{ tone: 'error', text: 'PVWS is not configured: cannot read or write PVs.' }} />}

      <div className="mag-proc-toolbar">
        <FilePicker onFile={loadFile} disabled={!!busy} label="Choose configuration..." />
        <span className="mag-proc-filename">{fileName || 'no file loaded'}</span>
        <span className="mag-proc-spacer" />
        <label className="mag-proc-field" title="0 (or 1) jumps straight from I0 to I1">
          Steps
          <NumberInput value={nsteps} onChange={changeSteps} width={70} min="0" step="1" />
        </label>
        <label className="mag-proc-field" title="Delta / step-delta values within +/- this tolerance are shown green, otherwise red">
          Tolerance
          <NumberInput value={tolerance} onChange={setTolerance} width={70} min="0" />
        </label>
        <label className="mag-proc-field" title="Show only power supplies whose current or state differs from their target">
          <input type="checkbox" checked={filterDiff} onChange={(e) => setFilterDiff(e.target.checked)} />
          Only differences
        </label>
      </div>

      <div className="mag-proc-toolbar">
        <button type="button" className="mag-proc-btn" disabled={!ready || counter <= 0}
          onClick={() => runStep('prev', { delta: -1 })}
          title="Push the previous step (CURRENT PREV SET) of the checked power supplies">
          &lt; Step down
        </button>
        <span className="mag-proc-count">Step {counter} / {n}</span>
        <button type="button" className="mag-proc-btn mag-proc-btn--primary" disabled={!ready || counter >= n}
          onClick={() => runStep('next', { delta: 1 })}
          title="Push the next step (CURRENT NEXT SET) of the checked power supplies">
          Step up &gt;
        </button>
        <button type="button" className="mag-proc-btn" disabled={!ready}
          onClick={() => runStep('set', { retry: true })}
          title="Redo the current step for the checked power supplies that have not reached it: state first, then current">
          Retry
        </button>
        <button type="button" className="mag-proc-btn" disabled={!ready} onClick={restart}
          title="Capture I0 again from the readbacks and go back to step 0">
          Restart
        </button>
        <span className="mag-proc-spacer" />
        <span className="mag-proc-count">{checkedCount}/{rows.length} checked</span>
        <button type="button" className="mag-proc-btn" disabled={!ready} onClick={setStates}
          title="Push the desired state of every checked power supply">
          Set Selected States
        </button>
      </div>

      <StatusBox message={message} busy={busy} />

      {rows.length > 0 && (
        <div className="mag-proc-table-wrap">
          <table className="mag-proc-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={checkedCount === rows.length}
                    onChange={(e) => setAll(e.target.checked)}
                    aria-label="select all"
                  />
                </th>
                <th>Element</th>
                <th className="num">I0</th>
                <th className="num">I1 (target)</th>
                <th>State</th>
                <th className="num">Step calc</th>
                <th className="num">Next set</th>
                <th className="num">Prev set</th>
                <th className="num">Delta</th>
                <th className="num">Step delta</th>
                <th>State SP</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ r, i0, rb, statePv, steps, delta, stepDelta, stateOk }) => (
                <tr key={r.base} className={r.enabled ? '' : 'disabled'}>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => update(r.base, { enabled: e.target.checked })}
                      aria-label={`step ${r.name}`}
                    />
                  </td>
                  <td title={r.base}>{r.name}</td>
                  <td className="num" title={i0 === undefined ? 'baseline not captured yet' : `baseline ${fmt(i0)}`}>{fmt(rb)}</td>
                  <td className="num">
                    <NumberInput
                      value={r.target}
                      onChange={(target) => update(r.base, { target })}
                      aria-invalid={!Number.isFinite(toNumber(r.target))}
                    />
                  </td>
                  <td><StateCell pv={statePv} /></td>
                  <td className="num">{fmt(steps?.calcstep ?? null)}</td>
                  <td className="num">{fmt(steps?.next ?? null)}</td>
                  <td className="num">{fmt(steps?.prev ?? null)}</td>
                  <td className="num"><DeltaCell delta={delta} tolerance={tol} /></td>
                  <td className="num"><DeltaCell delta={stepDelta} tolerance={tol} /></td>
                  <td>
                    {r.state === ''
                      ? <span className="mag-proc-state">---</span>
                      : <span className={`mag-proc-state ${stateOk === null ? '' : stateOk ? 'matched' : 'alarm-major'}`}>{r.state}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ProcedureFrame>
  );
}
