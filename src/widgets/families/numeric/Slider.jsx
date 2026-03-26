import { usePv } from '../../../hooks/usePv.js';
import { formatPvValue } from '../../../components/common/PvControls.jsx';

/**
 * SliderWidget — Slider control to write a numeric PV.
 * Phoebus equivalent: Slider
 *
 * Config: { pv_name, min, max, step, showValue, showLimits, foreground, fontSize }
 */
export default function SliderWidget({ config, client }) {
  const pv = usePv(client, config.pv_name);
  const val = pv?.value;
  const numVal = typeof val === 'number' ? val : parseFloat(val);
  const min = config.min ?? 0;
  const max = config.max ?? 100;
  const step = config.step ?? 1;
  const precision = config.precision ?? 2;
  const format = config.format || 'decimal';

  const write = (v) => {
    if (client && config.pv_name) client.put(config.pv_name, v);
  };

  return (
    <div className="phoebus-slider">
      {config.showLimits !== false && (
        <span className="slider-limit slider-limit--min">{min}</span>
      )}
      <input
        type="range"
        className="slider-input"
        min={min}
        max={max}
        step={step}
        value={!isNaN(numVal) ? numVal : min}
        onChange={(e) => write(parseFloat(e.target.value))}
      />
      {config.showLimits !== false && (
        <span className="slider-limit slider-limit--max">{max}</span>
      )}
      {config.showValue !== false && (
        <span className="slider-value">
          {formatPvValue(!isNaN(numVal) ? numVal : null, format, precision)}
          {config.showUnits !== false && config.units ? ` ${config.units}` : ''}
        </span>
      )}
    </div>
  );
}
