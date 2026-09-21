import { useMemo, useState } from 'react';
import { useApp } from '../../../context/AppContext.jsx';
import { useLivePvs } from '../../../hooks/useLivePvs.js';
import { pvNumber, pvStateLabel } from '../../../services/pvEnum.js';
import { snapshotToCsv } from '../../../services/magnetProcedures.js';
import {
  ProcedureFrame, StatusBox, StateCell, useMagnets, fmt, downloadText,
} from './MagnetParts.jsx';

function defaultFileName(zone, simple) {
  if (simple) return `unimag-${zone}.csv`;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return `mag_snapshot${zone === 'ALL' ? '' : `_${zone}`}_${stamp}.csv`;
}

/**
 * Save — snapshot of the selected magnet power supplies (CURRENT_SP + STATE_RB)
 * into a Name,Prefix,Current,State csv, the file Restore and Pretune load.
 * Same as SaveDynamic.py in unimag-opi.
 *
 * simple: the "Save Dataset" of unimag.bob (saveDialog.bob, SaveSelected.py): the
 * same file, but with the readback (CURRENT_RB) instead of the set current.
 */
export default function MagnetSaveView({ simple = false }) {
  const currentPv = simple ? 'CURRENT_RB' : 'CURRENT_SP';
  const { pvwsClient } = useApp();
  const magnets = useMagnets();

  const zones = useMemo(() => [...new Set(magnets.flatMap((m) => m.zones))].sort(), [magnets]);
  const [zone, setZone] = useState('ALL');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [fileName, setFileName] = useState(() => defaultFileName('ALL', simple));
  const [message, setMessage] = useState(null);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return magnets.filter((m) => (zone === 'ALL' || m.zones.includes(zone))
      && (!needle || m.base.toLowerCase().includes(needle)));
  }, [magnets, zone, filter]);

  const pvNames = useMemo(
    () => visible.flatMap((m) => [`${m.base}:CURRENT_SP`, `${m.base}:CURRENT_RB`, `${m.base}:STATE_RB`]),
    [visible],
  );
  const live = useLivePvs(pvwsClient, pvNames);

  // Only what is shown is saved: its values are the ones on screen.
  const chosen = visible.filter((m) => selected.has(m.base));

  const toggle = (base) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(base)) next.delete(base); else next.add(base);
    return next;
  });
  const selectShown = () => setSelected((prev) => new Set([...prev, ...visible.map((m) => m.base)]));
  const clearShown = () => setSelected((prev) => {
    const hidden = new Set(visible.map((m) => m.base));
    return new Set([...prev].filter((b) => !hidden.has(b)));
  });

  const changeZone = (value) => {
    setZone(value);
    setFileName(defaultFileName(value, simple));
  };

  const save = () => {
    const rows = [];
    const errors = [];
    for (const m of chosen) {
      const current = pvNumber(live.get(`${m.base}:${currentPv}`));
      const state = pvStateLabel(live.get(`${m.base}:STATE_RB`));
      if (current === null || state === null) {
        errors.push(`${m.base}: no value for ${current === null ? currentPv : 'STATE_RB'}`);
        continue;
      }
      rows.push({ name: m.name, prefix: m.prefix, current, state });
    }

    if (!rows.length) {
      setMessage({
        tone: 'warn',
        text: errors.length
          ? `Nothing saved, no readable value:\n${errors.slice(0, 8).join('\n')}`
          : 'No selected magnet power supplies.\nTick the ones you want to save.',
      });
      return;
    }

    const name = /\.csv$/i.test(fileName.trim()) ? fileName.trim() : `${fileName.trim() || 'mag_snapshot'}.csv`;
    downloadText(name, snapshotToCsv(rows));
    let text = `Saved ${rows.length} devices as ${name}`;
    if (errors.length) {
      text += `\n\nNot saved, no readable value (${errors.length}):\n${errors.slice(0, 8).join('\n')}`;
    }
    setMessage({ tone: errors.length ? 'warn' : 'ok', text });
  };

  return (
    <ProcedureFrame
      title={simple ? 'Save dataset' : 'Save magnets'}
      subtitle={simple
        ? 'Readback current and state of the selected power supplies into a csv that Load Dataset, Restore and Pretune can load.'
        : 'Snapshot of the selected power supplies (set current and state) into a csv that Restore and Pretune can load.'}
    >
      {!pvwsClient && <StatusBox message={{ tone: 'error', text: 'PVWS is not configured: no live values.' }} />}

      <div className="mag-proc-toolbar">
        <label className="mag-proc-field">
          Zone
          <select className="mag-proc-input" value={zone} onChange={(e) => changeZone(e.target.value)}>
            <option value="ALL">ALL</option>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
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
        <button type="button" className="mag-proc-btn" onClick={selectShown}>Select shown</button>
        <button type="button" className="mag-proc-btn" onClick={clearShown}>Clear shown</button>
        <span className="mag-proc-spacer" />
        <label className="mag-proc-field">
          File
          <input
            className="mag-proc-input"
            style={{ width: 280 }}
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="mag-proc-btn mag-proc-btn--primary"
          disabled={!chosen.length}
          onClick={save}
        >
          Save {chosen.length} selected
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
                <th />
                <th>Element</th>
                <th>Zone</th>
                <th className="num">I set</th>
                <th className="num">I read</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
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
                  <td className="num">{fmt(pvNumber(live.get(`${m.base}:CURRENT_SP`)))}</td>
                  <td className="num">{fmt(pvNumber(live.get(`${m.base}:CURRENT_RB`)))}</td>
                  <td><StateCell pv={live.get(`${m.base}:STATE_RB`)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ProcedureFrame>
  );
}
