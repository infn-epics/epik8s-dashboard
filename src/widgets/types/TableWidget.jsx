import { useMemo } from 'react';
import { usePv } from '../../hooks/usePv.js';

async function copyPvToClipboard(pvName) {
  if (!pvName || !navigator?.clipboard?.writeText) return;
  try {
    await navigator.clipboard.writeText(pvName);
  } catch (err) {
    // Best-effort copy only.
  }
}

/**
 * TableWidget — multi-PV status table.
 *
 * Config: { pvList (newline-separated PV names), showSeverity, precision, title }
 */
export default function TableWidget({ config, client }) {
  const pvNames = useMemo(
    () => (config.pvList || '').split('\n').map((s) => s.trim()).filter(Boolean),
    [config.pvList],
  );

  return (
    <div className="table-widget-body">
      {pvNames.length === 0 ? (
        <div className="table-empty">Configure PV list in widget properties</div>
      ) : (
        <table className="pv-table">
          <thead>
            <tr>
              <th>PV</th>
              <th>Value</th>
              {config.showSeverity !== false && <th>Severity</th>}
            </tr>
          </thead>
          <tbody>
            {pvNames.map((pv) => (
              <TableRow key={pv} pv={pv} client={client} config={config} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TableRow({ pv, client, config }) {
  const pvData = usePv(client, pv);
  const val = pvData?.value;
  const severity = pvData?.severity || 'NONE';
  const precision = config.precision ?? 2;

  let display = '---';
  if (val !== null && val !== undefined) {
    display = typeof val === 'number' ? val.toFixed(precision) : String(val);
  }

  const sevClass = severity !== 'NONE' ? `pv-severity--${severity.toLowerCase()}` : '';

  return (
    <tr
      className={sevClass}
      title={`PV: ${pv} (right-click to copy)`}
      onContextMenu={(e) => {
        e.preventDefault();
        copyPvToClipboard(pv);
      }}
    >
      <td className="table-pv-name">{pv}</td>
      <td className="table-pv-value">{display}</td>
      {config.showSeverity !== false && (
        <td className={`table-pv-severity ${sevClass}`}>{severity}</td>
      )}
    </tr>
  );
}
