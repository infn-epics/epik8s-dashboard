import { usePv } from '../../../hooks/usePv.js';
import { PvDisplay, StatusIndicator } from '../../../components/common/PvControls.jsx';

/**
 * GenericPVWidget — fallback widget for any device/PV.
 *
 * Config: { pvPrefix, title }
 */
export default function GenericPVWidget({ config, client }) {
  const pvPrefix = config.pvPrefix;

  return (
    <div className="generic-widget-body">
      <div className="generic-pv-info">
        <span className="pv-label">PV Prefix</span>
        <code className="pv-prefix">{pvPrefix || '—'}</code>
      </div>
      <StatusIndicator client={client} pvName={pvPrefix ? `${pvPrefix}:Status` : ''} label="Status" />
      <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Value` : ''} label="Value" />
    </div>
  );
}
