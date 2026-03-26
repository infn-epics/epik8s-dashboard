import { usePv } from '../../../hooks/usePv.js';
import { formatPvValue } from '../../../components/common/PvControls.jsx';

/**
 * RTD widget: temperature readback with a small icon hint.
 *
 * Shows a thermometer icon when the configured PV appears to be a TEMP_RB channel,
 * while keeping the same numeric formatting behavior as Text Update.
 */
export default function RTDWidget({ config, client }) {
	const pvName = (config?.pv_name || '').toString();
	const pv = usePv(client, pvName || null);
	const val = pv?.value;
	const display = formatPvValue(val, config.format || 'decimal', config.precision ?? 2);

	const style = {
		fontSize: config.fontSize ? `${config.fontSize}px` : undefined,
		color: config.foreground || undefined,
		background: config.background || undefined,
	};

	const isTempReadback = /(^|:)TEMP_RB$/i.test(pvName) || /TEMP_RB/i.test(pvName);

	return (
		<div className="phoebus-text-update rtd-text-update" style={style}>
			{isTempReadback && (
				<span className="rtd-temp-icon" title={`Temperature PV: ${pvName || 'N/A'}`}>
					🌡
				</span>
			)}
			<span className="text-update-value">{display}</span>
			{config.showUnits !== false && config.units && <span className="text-update-unit">{config.units}</span>}
		</div>
	);
}
