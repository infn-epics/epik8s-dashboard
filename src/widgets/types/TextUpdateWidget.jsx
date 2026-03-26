import { usePv } from '../../hooks/usePv.js';
import { formatPvValue } from '../../components/common/PvControls.jsx';

/**
 * TextUpdateWidget — Displays a PV value (read-only), just the text.
 * Phoebus equivalent: Text Update
 *
 * Config: { pv_name, precision, units, format, alarm_sensitive,
 *           foreground, background, fontSize }
 */
export default function TextUpdateWidget({ config, client }) {
  const pv = usePv(client, config.pv_name);
  const val = pv?.value;
  const display = formatPvValue(val, config.format || 'decimal', config.precision ?? 2);

  const style = {
    fontSize: config.fontSize ? `${config.fontSize}px` : undefined,
    color: config.foreground || undefined,
    background: config.background || undefined,
  };

  return (
    <div className="phoebus-text-update" style={style}>
      <span className="text-update-value">{display}</span>
      {config.showUnits !== false && config.units && <span className="text-update-unit">{config.units}</span>}
    </div>
  );
}
