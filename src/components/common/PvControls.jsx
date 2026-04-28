import { usePv } from '../../hooks/usePv';

function decodeB64ByteString(b64) {
  if (!b64 || typeof b64 !== 'string') return '';
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return text.replace(/\0+$/g, '');
  } catch {
    return '';
  }
}

export function getPvText(pv) {
  const raw = pv?.text ?? (pv?.b64byt ? decodeB64ByteString(pv.b64byt) : pv?.value);
  return pvValueToText(raw);
}

function pvValueToText(value) {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    return value.replace(/\0+$/g, '');
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  // Many EPICS waveform string PVs arrive as byte arrays (char waveform).
  if (Array.isArray(value)) {
    if (value.length && value.every((v) => typeof v === 'number')) {
      const chars = value.filter((v) => v > 0).map((v) => String.fromCharCode(v));
      return chars.join('').replace(/\0+$/g, '');
    }
    return String(value);
  }

  if (ArrayBuffer.isView(value)) {
    const arr = Array.from(value);
    const chars = arr.filter((v) => typeof v === 'number' && v > 0).map((v) => String.fromCharCode(v));
    return chars.join('').replace(/\0+$/g, '');
  }

  if (typeof value === 'object') {
    if ('string' in value) return pvValueToText(value.string);
    if ('text' in value) return pvValueToText(value.text);
  }

  return String(value);
}

async function copyPvToClipboard(pvName) {
  if (!pvName || !navigator?.clipboard?.writeText) return;
  try {
    await navigator.clipboard.writeText(pvName);
  } catch (err) {
    // Silent by design: right-click copy is best-effort and should never break UI interactions.
  }
}

function withPvHint(pvName) {
  return pvName
    ? {
        title: `PV: ${pvName} (right-click to copy)`,
        onContextMenu: (e) => {
          e.preventDefault();
          copyPvToClipboard(pvName);
        },
      }
    : {};
}

/**
 * Read-only PV value display.
 */
export function formatNumericValue(value, format, precision) {
  const p = precision ?? 2;

  switch (format) {
    case 'exponential':
      return value.toExponential(p);
    case 'engineering': {
      if (value === 0) return (0).toFixed(p);
      const sign = value < 0 ? -1 : 1;
      const abs = Math.abs(value);
      const exp = Math.floor(Math.log10(abs));
      const engExp = Math.floor(exp / 3) * 3;
      const scaled = sign * (abs / Math.pow(10, engExp));
      return `${scaled.toFixed(p)}e${engExp >= 0 ? '+' : ''}${engExp}`;
    }
    case 'hex':
      return `0x${Math.round(value).toString(16).toUpperCase()}`;
    case 'string':
      return String(value);
    case 'decimal':
    default:
      return value.toFixed(p);
  }
}

export function formatPvValue(val, format = 'decimal', precision = 2) {
  if (val === null || val === undefined) return '---';
  if (typeof val === 'number') return formatNumericValue(val, format, precision);
  const num = parseFloat(val);
  return !isNaN(num) && format !== 'string'
    ? formatNumericValue(num, format, precision)
    : String(val);
}

export function PvDisplay({
  client,
  pvName,
  label,
  unit,
  precision = 2,
  format = 'decimal',
  showUnit = true,
  className,
}) {
  const pv = usePv(client, pvName);
  const val = pv?.value;
  const severity = pv?.severity || 'NONE';

  let display = '---';
  if (val !== null && val !== undefined) {
    display = formatPvValue(val, format, precision);
  }

  const sevClass = severity !== 'NONE' ? `pv-severity--${severity.toLowerCase()}` : '';

  return (
    <span className={`pv-display ${sevClass} ${className || ''}`} {...withPvHint(pvName)}>
      {label && <span className="pv-label">{label}</span>}
      <span className="pv-value">{display}</span>
      {showUnit && unit && <span className="pv-unit">{unit}</span>}
    </span>
  );
}

/**
 * PV numeric input — writes on Enter or blur.
 *
 * Committing on blur (not just on form submit / Enter) is critical for
 * controls like the motor Tweak field, where users typically type a value
 * and then click an adjacent button (e.g. ◀ / ▶). Without an onBlur write,
 * clicking the button moves focus away and the typed value is lost.
 */
export function PvInput({ client, pvName, label, min, max, step }) {
  const pv = usePv(client, pvName);
  const currentVal = pv?.value ?? '';

  const commit = (rawValue) => {
    if (!client || !pvName) return;
    const val = parseFloat(rawValue);
    if (isNaN(val)) return;
    // Avoid echoing back the value we just received from the PV.
    if (currentVal !== '' && Number(currentVal) === val) return;
    client.put(pvName, val);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    commit(e.target.elements.pvInput.value);
  };

  const handleBlur = (e) => {
    commit(e.target.value);
  };

  return (
    <form className="pv-input-group" onSubmit={handleSubmit} {...withPvHint(pvName)}>
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
        onBlur={handleBlur}
      />
    </form>
  );
}

/**
 * PV text input for string PVs — writes on Enter or blur.
 */
export function PvTextInput({ client, pvName, label, placeholder = '' }) {
  const pv = usePv(client, pvName);
  const currentVal = getPvText(pv);

  const commit = (val) => {
    if (!client || !pvName) return;
    if (val === currentVal) return;
    client.put(pvName, val);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    commit(e.target.elements.pvTextInput.value);
  };

  const handleBlur = (e) => {
    commit(e.target.value);
  };

  return (
    <form className="pv-input-group" onSubmit={handleSubmit} {...withPvHint(pvName)}>
      {label && <label className="pv-label">{label}</label>}
      <input
        name="pvTextInput"
        type="text"
        className="pv-input"
        defaultValue={currentVal}
        key={currentVal}
        placeholder={placeholder}
        onBlur={handleBlur}
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
    <div className="pv-slider-group" {...withPvHint(pvName)}>
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
    <span className={`status-indicator status-indicator--${severity}`} {...withPvHint(pvName)}>
      <span className="status-dot" />
      {label && <span className="status-label">{label}</span>}
      {val !== null && val !== undefined && <span className="status-value">{String(val)}</span>}
    </span>
  );
}
