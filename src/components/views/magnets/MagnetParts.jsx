import { useMemo, useRef } from 'react';
import { useApp } from '../../../context/AppContext.jsx';
import { magnetDevices } from '../../../services/magnetProcedures.js';
import { alarmLevel, resolveEnumLabel } from '../../../services/pvEnum.js';

/** Magnet power supplies of the loaded configuration. */
export function useMagnets() {
  const { devices } = useApp();
  return useMemo(() => magnetDevices(devices), [devices]);
}

export function fmt(value, precision = 3) {
  return value === null || value === undefined ? '---' : value.toFixed(precision);
}

/** Save `text` as a file through the browser. */
export function downloadText(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Page frame shared by the three procedures. */
export function ProcedureFrame({ title, subtitle, children }) {
  return (
    <div className="mag-proc">
      <header className="mag-proc-head">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {children}
    </div>
  );
}

/** Button opening the browser file chooser; no extension filter (datasets may have none). */
export function FilePicker({ onFile, label = 'Choose file...', disabled }) {
  const inputRef = useRef(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // picking the same file again reloads it
          if (file) onFile(file);
        }}
      />
      <button type="button" className="mag-proc-btn" disabled={disabled} onClick={() => inputRef.current?.click()}>
        {label}
      </button>
    </>
  );
}

/** tone: 'info' | 'ok' | 'warn' | 'error' */
export function StatusBox({ message, busy }) {
  if (!message && !busy) return null;
  const tone = busy ? 'info' : (message?.tone || 'info');
  return (
    <pre className={`mag-proc-status mag-proc-status--${tone}`} role="status">
      {busy ? `${busy}` : message.text}
    </pre>
  );
}

/** STATE_RB label boxed like the PS widget: red = MAJOR, yellow = MINOR/WARNING. */
export function StateCell({ pv, matched }) {
  const level = alarmLevel(pv);
  const cls = level ? `alarm-${level}` : matched ? 'matched' : '';
  return <span className={`mag-proc-state ${cls}`}>{pv ? resolveEnumLabel(pv) : '---'}</span>;
}

/** Tolerance check colouring, like the OPI delta cells: green within, red outside, none unknown. */
export function DeltaCell({ delta, tolerance }) {
  if (delta === null || delta === undefined || Number.isNaN(delta)) {
    return <span className="mag-proc-delta">---</span>;
  }
  const ok = Math.abs(delta) <= tolerance;
  return <span className={`mag-proc-delta ${ok ? 'ok' : 'bad'}`}>{fmt(delta)}</span>;
}

/** reached: true / false / null (unknown yet). */
export function Led({ reached, title }) {
  const cls = reached === null ? 'unknown' : reached ? 'ok' : 'bad';
  return <span className={`mag-proc-led ${cls}`} title={title} />;
}

export function NumberInput({ value, onChange, width = 84, ...rest }) {
  return (
    <input
      className="mag-proc-input"
      type="number"
      step="any"
      style={{ width }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
}
