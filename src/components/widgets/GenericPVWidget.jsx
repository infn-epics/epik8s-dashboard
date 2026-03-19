import Widget from '../layout/Widget.jsx';
import { PvDisplay, PvInput, PvSlider, StatusIndicator } from '../common/PvControls.jsx';
import { usePv } from '../../hooks/usePv.js';

/**
 * GenericPVWidget - Fallback widget for any device type.
 * Shows PV prefix and basic controls.
 */
export default function GenericPVWidget({ device, client, onHide }) {
  const statusPv = usePv(client, `${device.pvPrefix}:Status`);
  const severity = (statusPv?.severity || 'NONE').toLowerCase();
  const status = severity === 'none' ? 'ok' : severity;

  return (
    <Widget
      title={device.name}
      subtitle={`${device.iocName} • ${device.type}`}
      icon="🔧"
      status={status}
      onHide={onHide}
    >
      <div className="generic-widget-body">
        <div className="generic-pv-info">
          <span className="pv-label">PV Prefix</span>
          <code className="pv-prefix">{device.pvPrefix}</code>
        </div>
        <StatusIndicator client={client} pvName={`${device.pvPrefix}:Status`} label="Status" />
        <PvDisplay client={client} pvName={`${device.pvPrefix}:Value`} label="Value" />
      </div>
    </Widget>
  );
}
