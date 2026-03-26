import { usePv } from '../../hooks/usePv.js';
import { formatPvValue } from '../../components/common/PvControls.jsx';

/**
 * PvDisplayWidget — displays a single PV value with alarm severity.
 *
 * Config: { pvName, units, precision, showAlarm, fontSize }
 */
export default function PvDisplayWidget({ config, client }) {
  const pv = usePv(client, config.pvName);
  const val = pv?.value;
  const severity = pv?.severity || 'NONE';

  const display = formatPvValue(val, config.format || 'decimal', config.precision ?? 2);

  const sevClass = severity !== 'NONE' ? `pv-severity--${severity.toLowerCase()}` : '';
  const sizeClass = `pv-display--${config.fontSize || 'medium'}`;

  return (
    <div className={`pv-display-widget ${sevClass} ${sizeClass}`}>
      <div className="pv-display-value">{display}</div>
      {config.showUnits !== false && config.units && <div className="pv-display-unit">{config.units}</div>}
      {config.showAlarm && severity !== 'NONE' && (
        <div className={`pv-display-alarm pv-alarm--${severity.toLowerCase()}`}>
          {severity}
        </div>
      )}
    </div>
  );
}
