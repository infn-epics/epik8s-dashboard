import { usePv } from '../../hooks/usePv';

/**
 * Read-only PV value display.
 */
export function PvDisplay({ client, pvName, label, unit, precision = 2, className }) {
  const pv = usePv(client, pvName);
  const val = pv?.value;
  const severity = pv?.severity || 'NONE';

  let display = '---';
  if (val !== null && val !== undefined) {
    display = typeof val === 'number' ? val.toFixed(precision) : String(val);
  }

  const sevClass = severity !== 'NONE' ? `pv-severity--${severity.toLowerCase()}` : '';

  return (
    <span className={`pv-display ${sevClass} ${className || ''}`}>
      {label && <span className="pv-label">{label}</span>}
      <span className="pv-value">{display}</span>
      {unit && <span className="pv-unit">{unit}</span>}
    </span>
  );
}

/**
 * PV numeric input — writes on Enter or blur.
 */
export function PvInput({ client, pvName, label, min, max, step }) {
  const pv = usePv(client, pvName);
  const currentVal = pv?.value ?? '';

  const handleSubmit = (e) => {
    e.preventDefault();
    const input = e.target.elements.pvInput;
    const val = parseFloat(input.value);
    if (!isNaN(val) && client && pvName) {
      client.put(pvName, val);
    }
  };

  return (
    <form className="pv-input-group" onSubmit={handleSubmit}>
      {label && <label className="pv-label">{label}</label>}
      <input
        name="pvInput"
        type="number"
        className="pv-input"
        defaultValue={currentVal}
        key={currentVal} // reset when PV changes externally
        min={min}
        max={max}
        step={step}
      />
    </form>
  );
}

/**
 * PV slider control.
 */
export function PvSlider({ client, pvName, label, min = 0, max = 100, step = 1 }) {
  const pv = usePv(client, pvName);
  const val = pv?.value ?? min;

  const handleChange = (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && client && pvName) {
      client.put(pvName, v);
    }
  };

  return (
    <div className="pv-slider-group">
      {label && <span className="pv-label">{label}</span>}
      <input
        type="range"
        className="pv-slider"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={handleChange}
      />
      <span className="pv-value">{typeof val === 'number' ? val.toFixed(step < 1 ? 3 : 0) : val}</span>
    </div>
  );
}

/**
 * Status indicator (alarm-aware dot + label).
 */
export function StatusIndicator({ client, pvName, label }) {
  const pv = usePv(client, pvName);
  const severity = (pv?.severity || 'NONE').toLowerCase();
  const val = pv?.value;

  return (
    <span className={`status-indicator status-indicator--${severity}`}>
      <span className="status-dot" />
      {label && <span className="status-label">{label}</span>}
      {val !== null && val !== undefined && <span className="status-value">{String(val)}</span>}
    </span>
  );
}
