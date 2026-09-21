import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../../context/AppContext.jsx';
import { useLivePvs } from '../../../hooks/useLivePvs.js';
import { pvNumber, pvStateLabel } from '../../../services/pvEnum.js';
import { STATE_COMMANDS, applyBulk, createPvIo } from '../../../services/magnetProcedures.js';
import {
  ProcedureFrame, StatusBox, StateCell, NumberInput, useMagnets, fmt,
} from './MagnetParts.jsx';

const unique = (values) => [...new Set(values.filter(Boolean))].sort();

/** Direction of a supply, like the off / neg / pos icons of mag_channel_dante.bob. */
function polarity(stateRb, readback) {
  if (stateRb === null) return { glyph: '·', cls: '', title: 'no value' };
  if (stateRb === 'OFF' || stateRb === 'STANDBY') return { glyph: '⏻', cls: 'off', title: stateRb };
  if (stateRb !== 'ON') return { glyph: '!', cls: 'bad', title: stateRb };
  if (readback === null || readback === 0) return { glyph: '0', cls: 'zero', title: 'ON, zero current' };
  return readback < 0
    ? { glyph: '−', cls: 'neg', title: 'ON, negative current' }
    : { glyph: '+', cls: 'pos', title: 'ON, positive current' };
}

/** Set current: shows the live CURRENT_SP, Enter writes the typed value, Escape or leaving drops it. */
function SetpointCell({ pv, onCommit }) {
  const [draft, setDraft] = useState(null);
  const live = pvNumber(pv);

  const commit = (input) => {
    const value = Number(draft);
    if (draft !== null && draft.trim() !== '' && Number.isFinite(value)) onCommit(value);
    setDraft(null);
    input.blur();
  };

  return (
    <input
      className="mag-proc-input"
      type="number"
      step="any"
      style={{ width: 92 }}
      placeholder="---"
      title="Enter to set CURRENT_SP"
      value={draft ?? (live === null ? '' : String(+live.toFixed(4)))}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget);
        else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/**
 * Array — every magnet power supply as a row, filtered by zone / type / model, with
 * per-magnet set current and ON / OFF / RESET, and the same on the selected ones.
 * Same as mag_dynamic.bob (mag_array.bob + mag_channel_dante.bob) in unimag-opi.
 */
export default function MagnetArrayView() {
  const { pvwsClient } = useApp();
  const magnets = useMagnets();

  const zones = useMemo(() => unique(magnets.flatMap((m) => m.zones)), [magnets]);
  const funcs = useMemo(() => unique(magnets.map((m) => m.func)), [magnets]);
  const models = useMemo(() => unique(magnets.map((m) => m.model)), [magnets]);

  const [zone, setZone] = useState('ALL');
  const [func, setFunc] = useState('ALL');
  const [model, setModel] = useState('ALL');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [step, setStep] = useState('1');
  const [message, setMessage] = useState(null);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return magnets.filter((m) => (zone === 'ALL' || m.zones.includes(zone))
      && (func === 'ALL' || m.func === func)
      && (model === 'ALL' || m.model === model)
      && (!needle || m.base.toLowerCase().includes(needle)));
  }, [magnets, zone, func, model, filter]);

  const pvNames = useMemo(
    () => visible.flatMap((m) => [
      `${m.base}:CURRENT_SP`, `${m.base}:CURRENT_RB`, `${m.base}:STATE_RB`, `${m.base}:STATE_SP`,
    ]),
    [visible],
  );
  const live = useLivePvs(pvwsClient, pvNames);
  const io = createPvIo(live.get, pvwsClient);

  // Only what is shown is acted on: it is what the operator sees and selected.
  const chosen = visible.filter((m) => selected.has(m.base));
  const allSelected = visible.length > 0 && chosen.length === visible.length;

  const toggle = (base) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(base)) next.delete(base); else next.add(base);
    return next;
  });
  const toggleAll = (checked) => setSelected((prev) => {
    const next = new Set(prev);
    for (const m of visible) {
      if (checked) next.add(m.base); else next.delete(m.base);
    }
    return next;
  });

  const bulk = (action, label, confirmIt) => {
    if (!chosen.length) {
      setMessage({ tone: 'warn', text: 'No magnet selected.' });
      return;
    }
    if (action.type === 'step' && !(Math.abs(Number(step)) > 0)) {
      setMessage({ tone: 'warn', text: 'Enter the quantity (A) to add or subtract.' });
      return;
    }
    if (confirmIt && !window.confirm(`${label} ${chosen.length} selected magnets?`)) return;

    const { done, errors } = applyBulk(action, chosen.map((m) => m.base), io);
    if (errors.length) {
      setMessage({
        tone: 'warn',
        text: `${label}: ${done.length} of ${chosen.length} magnets.\n\nErrors:\n${errors.slice(0, 10).join('\n')}`,
      });
    } else {
      // "-" / "+" are meant to be clicked repeatedly: only problems are reported
      setMessage(action.type === 'step' ? null : { tone: 'ok', text: `${label}: ${done.length} magnets.` });
    }
  };

  const setCurrent = (base, value) => pvwsClient?.put(`${base}:CURRENT_SP`, value);
  const setState = (base, state) => pvwsClient?.put(`${base}:STATE_SP`, state);

  return (
    <ProcedureFrame
      title="Magnet array"
      subtitle="All the magnet power supplies: set current and state of each one, or of the selected ones."
    >
      {!pvwsClient && <StatusBox message={{ tone: 'error', text: 'PVWS is not configured: no live values.' }} />}

      <div className="mag-proc-toolbar">
        <label className="mag-proc-field">
          Zone
          <select className="mag-proc-input" value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="ALL">ALL</option>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <label className="mag-proc-field" title="Function of the magnet: corrector, quadrupole, dipole...">
          Type
          <select className="mag-proc-input" value={func} onChange={(e) => setFunc(e.target.value)}>
            <option value="ALL">ALL</option>
            {funcs.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="mag-proc-field" title="Power supply model (devtype)">
          Model
          <select className="mag-proc-input" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="ALL">ALL</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="mag-proc-field">
          Filter
          <input
            className="mag-proc-input"
            type="search"
            placeholder="name..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <span className="mag-proc-spacer" />
        <Link className="mag-proc-btn" to="/tools/magnets/save" title="Save a snapshot of the selected magnets">Save Snapshot</Link>
        <Link className="mag-proc-btn" to="/tools/magnets/restore" title="Load a snapshot or dataset and restore it">Restore Snapshot</Link>
        <Link className="mag-proc-btn" to="/tools/magnets/pretune" title="Walk the magnets to a dataset in steps">Pretune</Link>
      </div>

      <div className="mag-proc-toolbar">
        <span className="mag-proc-count">Selected: {chosen.length} / {visible.length}</span>
        <button type="button" className="mag-proc-btn" disabled={!pvwsClient}
          title="Turn ON all selected magnets" onClick={() => bulk({ type: 'state', state: 'ON' }, 'ON', true)}>
          ON
        </button>
        <button type="button" className="mag-proc-btn" disabled={!pvwsClient}
          title="Turn OFF all selected magnets" onClick={() => bulk({ type: 'state', state: 'OFF' }, 'OFF', true)}>
          OFF
        </button>
        <button type="button" className="mag-proc-btn" disabled={!pvwsClient}
          title="Send RESET to all selected magnets" onClick={() => bulk({ type: 'state', state: 'RESET' }, 'RESET', true)}>
          RESET
        </button>
        <button type="button" className="mag-proc-btn" disabled={!pvwsClient}
          title="Set CURRENT_SP to 0 for all selected magnets" onClick={() => bulk({ type: 'zero' }, 'ZERO', true)}>
          ZERO
        </button>
        <span className="mag-proc-spacer" />
        <label className="mag-proc-field" title="Quantity (A) added or subtracted from CURRENT_SP of the selected magnets by - and +">
          dI
          <NumberInput value={step} onChange={setStep} width={70} min="0" />
        </label>
        <button type="button" className="mag-proc-btn" disabled={!pvwsClient}
          title="Subtract dI from CURRENT_SP of all selected magnets"
          onClick={() => bulk({ type: 'step', step: Number(step), sign: -1 }, '−dI')}>
          −
        </button>
        <button type="button" className="mag-proc-btn" disabled={!pvwsClient}
          title="Add dI to CURRENT_SP of all selected magnets"
          onClick={() => bulk({ type: 'step', step: Number(step), sign: 1 }, '+dI')}>
          +
        </button>
      </div>

      <StatusBox message={message} />

      {magnets.length === 0 ? (
        <p className="mag-proc-empty">No magnet power supplies (devgroup "mag") in the configuration.</p>
      ) : (
        <div className="mag-proc-table-wrap">
          <table className="mag-proc-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                    aria-label="select all shown"
                  />
                </th>
                <th>Element</th>
                <th>Zone</th>
                <th>Type</th>
                <th className="num">Current</th>
                <th />
                <th>State</th>
                <th className="num">I set</th>
                <th>Command</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const rb = pvNumber(live.get(`${m.base}:CURRENT_RB`));
                const statePv = live.get(`${m.base}:STATE_RB`);
                const stateRb = pvStateLabel(statePv);
                const pol = polarity(stateRb, rb);
                const reached = { ON: stateRb === 'ON', OFF: stateRb === 'OFF' || stateRb === 'STANDBY' };
                return (
                  <tr key={m.base} className={selected.has(m.base) ? 'selected' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(m.base)}
                        onChange={() => toggle(m.base)}
                        aria-label={`select ${m.name}`}
                      />
                    </td>
                    <td title={m.base}>{m.name}</td>
                    <td>{m.zones.join(', ')}</td>
                    <td title={m.model}>{m.func}</td>
                    <td className="num">{fmt(rb)}</td>
                    <td><span className={`mag-pol ${pol.cls}`} title={pol.title}>{pol.glyph}</span></td>
                    <td><StateCell pv={statePv} /></td>
                    <td className="num">
                      <SetpointCell
                        pv={live.get(`${m.base}:CURRENT_SP`)}
                        onCommit={(value) => setCurrent(m.base, value)}
                      />
                    </td>
                    <td>
                      <span className="mag-array-cmds">
                        {STATE_COMMANDS.map((state) => (
                          <button
                            key={state}
                            type="button"
                            className={`mag-proc-btn mag-proc-btn--sm ${reached[state] ? 'matched' : ''}`}
                            disabled={!pvwsClient}
                            onClick={() => setState(m.base, state)}
                            title={`STATE_SP = ${state}`}
                          >
                            {state}
                          </button>
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ProcedureFrame>
  );
}
