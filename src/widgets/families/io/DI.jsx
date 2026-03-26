import { usePv } from '../../../hooks/usePv.js';

/**
 * DI widget — digital input: readback LED + edge counter.
 *
 * Config: { pvPrefix, on_label, off_label, title }
 *
 * PVs used:
 *   <pvPrefix>:DI_RB   — readback (0/1)
 *   <pvPrefix>:DI_CNT  — rising-edge counter (0→1 transitions)
 */
export default function DIWidget({ config, client }) {
  const pvPrefix = config.pvPrefix || '';
  const rbPv  = usePv(client, pvPrefix ? `${pvPrefix}:DI_RB`  : null);
  const cntPv = usePv(client, pvPrefix ? `${pvPrefix}:DI_CNT` : null);

  const rbVal  = rbPv?.value;
  const cntVal = cntPv?.value;
  const isOn   = rbVal === 1 || rbVal === '1';

  const cntDisplay = cntVal !== null && cntVal !== undefined ? String(cntVal) : '—';

  return (
    <div className="di-widget">
      {/* Readback LED (read-only) */}
      <div
        className="rly-led"
        title={`DI_RB: ${rbVal ?? '—'}`}
        style={{
          background: isOn ? '#34d399' : '#6b7280',
          boxShadow: isOn ? '0 0 8px #34d399' : 'none',
        }}
      />
      <span className="di-state">{isOn ? (config.on_label || 'ON') : (config.off_label || 'OFF')}</span>
      {/* Rising-edge counter */}
      <span className="di-counter" title="Rising-edge counter (0→1)">
        #{cntDisplay}
      </span>
    </div>
  );
}
