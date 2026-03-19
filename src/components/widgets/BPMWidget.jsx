import Widget from '../layout/Widget.jsx';
import { PvDisplay } from '../common/PvControls.jsx';

/**
 * BPMWidget - Beam Position Monitor display.
 */
export default function BPMWidget({ device, client, onHide }) {
  const detailContent = (
    <div className="bpm-detail">
      <PvDisplay client={client} pvName={`${device.pvPrefix}:PosX`} label="X Position" precision={4} unit="mm" />
      <PvDisplay client={client} pvName={`${device.pvPrefix}:PosY`} label="Y Position" precision={4} unit="mm" />
      <PvDisplay client={client} pvName={`${device.pvPrefix}:Charge`} label="Charge" precision={3} unit="pC" />
      <PvDisplay client={client} pvName={`${device.pvPrefix}:Status`} label="Status" precision={0} />
    </div>
  );

  return (
    <Widget
      title={device.name}
      subtitle={`${device.iocName} • ${device.zone || ''}`}
      icon="📊"
      status="ok"
      onHide={onHide}
      detailContent={detailContent}
    >
      <div className="bpm-widget-body">
        <PvDisplay client={client} pvName={`${device.pvPrefix}:PosX`} label="X" precision={3} unit="mm" />
        <PvDisplay client={client} pvName={`${device.pvPrefix}:PosY`} label="Y" precision={3} unit="mm" />
        <PvDisplay client={client} pvName={`${device.pvPrefix}:Charge`} label="Q" precision={2} unit="pC" />
      </div>
    </Widget>
  );
}
