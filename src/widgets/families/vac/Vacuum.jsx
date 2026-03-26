import { usePv } from '../../../hooks/usePv.js';
import { PvDisplay, StatusIndicator } from '../../../components/common/PvControls.jsx';

/**
 * VacuumWidget — pressure readback and status.
 *
 * Config: { pvPrefix, pressureUnit, pressureFormat, precision, showUnits, alarmThreshold, title }
 */
export default function VacuumWidget({ config, client }) {
  const pvPrefix = config.pvPrefix;
  const pressurePv = usePv(client, pvPrefix ? `${pvPrefix}:PRES_RB` : null);

  const pressure = pressurePv?.value;
  const threshold = config.alarmThreshold ?? 1e-5;
  const isAlarm = typeof pressure === 'number' && pressure > threshold;

  return (
    <div className="vacuum-widget-body">
      <div className={`vacuum-pressure ${isAlarm ? 'vacuum-alarm' : ''}`}>
        <PvDisplay
          client={client}
          pvName={pvPrefix ? `${pvPrefix}:PRES_RB` : ''}
          label="Pressure"
          precision={config.precision ?? 2}
          format={config.pressureFormat || 'exponential'}
          showUnit={config.showUnits !== false}
          unit={config.pressureUnit || 'mbar'}
        />
      </div>

      <StatusIndicator
        client={client}
        pvName={pvPrefix ? `${pvPrefix}:PRES_STAT` : ''}
        label="Status"
      />
    </div>
  );
}
