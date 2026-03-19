import Widget from '../layout/Widget.jsx';
import { PvDisplay, PvInput, PvSlider, StatusIndicator } from '../common/PvControls.jsx';
import { usePv } from '../../hooks/usePv.js';

/**
 * MotorWidget - Motor control widget with position readback, move-to, limits.
 */
export default function MotorWidget({ device, client, onHide }) {
  const rbvPv = usePv(client, `${device.pvPrefix}.RBV`);
  const dmovPv = usePv(client, `${device.pvPrefix}.DMOV`);
  const moving = dmovPv?.value === 0;
  const severity = rbvPv?.severity || 'NONE';

  const status = moving ? 'warning' : severity !== 'NONE' ? severity.toLowerCase() : 'ok';

  const params = device.params || {};

  const detailContent = (
    <div className="motor-detail">
      <PvDisplay client={client} pvName={`${device.pvPrefix}.RBV`} label="Position" precision={4} />
      <PvDisplay client={client} pvName={`${device.pvPrefix}.VELO`} label="Velocity" precision={2} />
      <PvDisplay client={client} pvName={`${device.pvPrefix}.DMOV`} label="Done Moving" precision={0} />
      <PvDisplay client={client} pvName={`${device.pvPrefix}.HLS`} label="High Limit" precision={0} />
      <PvDisplay client={client} pvName={`${device.pvPrefix}.LLS`} label="Low Limit" precision={0} />
      <PvSlider client={client} pvName={`${device.pvPrefix}.VAL`} label="Set Position" min={params.dllm ?? -100} max={params.dhlm ?? 100} step={0.01} />
      {device.poi && device.poi.length > 0 && (
        <div className="motor-poi">
          <span className="pv-label">Presets:</span>
          {device.poi.map((p) => (
            <button
              key={p.name}
              className="widget-action-btn"
              onClick={() => client?.put(`${device.pvPrefix}.VAL`, p.value)}
            >
              {p.name} ({p.value})
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Widget
      title={device.name}
      subtitle={`${device.iocName} • ${device.zone || ''}`}
      icon="⚙"
      status={status}
      onHide={onHide}
      detailContent={detailContent}
    >
      <div className="motor-widget-body">
        <div className="motor-readback">
          <PvDisplay client={client} pvName={`${device.pvPrefix}.RBV`} label="Pos" precision={4} />
          {moving && <span className="motor-moving-badge">MOVING</span>}
        </div>
        <PvInput
          client={client}
          pvName={`${device.pvPrefix}.VAL`}
          label="Go to"
          min={params.dllm}
          max={params.dhlm}
          step={0.01}
        />
        <div className="motor-buttons">
          <button className="widget-action-btn" onClick={() => client?.put(`${device.pvPrefix}.STOP`, 1)}>
            ⏹ Stop
          </button>
          <button className="widget-action-btn" onClick={() => client?.put(`${device.pvPrefix}.HOMF`, 1)}>
            🏠 Home
          </button>
        </div>
      </div>
    </Widget>
  );
}
