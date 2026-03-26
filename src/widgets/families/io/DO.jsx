import { usePv } from '../../../hooks/usePv.js';

/**
 * DO widget — digital output: readback LED + setpoint toggle button.
 *
 * Config: { pvPrefix, on_label, off_label, title }
 *
 * PVs used:
 *   <pvPrefix>:DO_RB   — readback (0/1)
 *   <pvPrefix>:DO_SP   — setpoint (write 0/1)
 */
export default function DOWidget({ config, client }) {
  const pvPrefix = config.pvPrefix || '';
  const rbPv = usePv(client, pvPrefix ? `${pvPrefix}:DO_RB` : null);
  const spPv = usePv(client, pvPrefix ? `${pvPrefix}:DO_SP` : null);

  const rbVal  = rbPv?.value;
  const spVal  = spPv?.value;
  const isOn   = rbVal === 1 || rbVal === '1';
  const spIsOn = spVal === 1 || spVal === '1';

  const toggle = () => {
    if (!client || !pvPrefix) return;
    client.put(`${pvPrefix}:DO_SP`, spIsOn ? 0 : 1);
  };

  const onLabel  = config.on_label  || 'ON';
  const offLabel = config.off_label || 'OFF';

  return (
    <div className="rly-widget">
      {/* Readback LED */}
      <div
        className="rly-led"
        title={`DO_RB: ${rbVal ?? '—'}`}
        style={{
          background: isOn ? '#34d399' : '#6b7280',
          boxShadow: isOn ? '0 0 8px #34d399' : 'none',
        }}
      />
      {/* Setpoint toggle */}
      <button
        className={`rly-btn${spIsOn ? ' rly-btn--on' : ''}`}
        onClick={toggle}
        disabled={!pvPrefix}
        title={`DO_SP: ${spVal ?? '—'}`}
      >
        {spIsOn ? onLabel : offLabel}
      </button>
    </div>
  );
}
