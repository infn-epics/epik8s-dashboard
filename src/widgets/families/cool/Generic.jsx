import { PvDisplay, PvInput } from '../../../components/common/PvControls.jsx';
import { usePv } from '../../../hooks/usePv.js';

function resolveEnumChoices(pvMsg) {
	if (!pvMsg) return [];
	const c = pvMsg.choices || pvMsg.enumStrings || pvMsg.enum_strs || pvMsg.labels;
	return Array.isArray(c) ? c : [];
}

function resolveEnumLabel(pvMsg) {
	if (!pvMsg) return '---';
	const direct = pvMsg.display || pvMsg.text || pvMsg.string || pvMsg.str || pvMsg.valueStr;
	if (typeof direct === 'string' && direct.trim() !== '') return direct;

	const choices = resolveEnumChoices(pvMsg);
	const raw = pvMsg.value;
	const idx = typeof raw === 'number' ? raw : parseInt(raw, 10);
	if (choices.length && Number.isInteger(idx) && idx >= 0 && idx < choices.length) {
		return String(choices[idx]);
	}

	return raw !== null && raw !== undefined ? String(raw) : '---';
}

/**
 * Cooling generic channel.
 *
 * PVs:
 * - <pvPrefix>:TEMP_RB  (temperature readback)
 * - <pvPrefix>:TEMP_SP  (temperature setpoint)
 * - <pvPrefix>:STATE_RB (state readback, enum/string)
 * - <pvPrefix>:STATE_SP (state setpoint)
 */
export default function CoolingGenericWidget({ config, client }) {
	const pvPrefix = config.pvPrefix || '';
	const precision = config.precision ?? 2;
	const numberFormat = config.format || 'decimal';
	const showUnits = config.showUnits !== false;
	const units = config.units || 'degC';
	const stateRbPv = usePv(client, pvPrefix ? `${pvPrefix}:STATE_RB` : null);
	const stateSpPv = usePv(client, pvPrefix ? `${pvPrefix}:STATE_SP` : null);

	const stateChoices = (() => {
		const fromSp = resolveEnumChoices(stateSpPv);
		if (fromSp.length) return fromSp;
		return resolveEnumChoices(stateRbPv);
	})();
	const stateSpRaw = stateSpPv?.value;
	const stateSpIndex = Number.isInteger(stateSpRaw)
		? stateSpRaw
		: parseInt(stateSpRaw, 10);
	const stateRbLabel = resolveEnumLabel(stateRbPv);

	const writeState = (idx) => {
		if (!client || !pvPrefix || !Number.isInteger(idx)) return;
		client.put(`${pvPrefix}:STATE_SP`, idx);
	};

	return (
		<div className="generic-widget-body cool-widget-body">
			<div className="generic-pv-info">
				<span className="pv-label">PV Prefix</span>
				<code className="pv-prefix">{pvPrefix || '—'}</code>
			</div>

			<div className="cool-row">
				<PvDisplay
					client={client}
					pvName={pvPrefix ? `${pvPrefix}:TEMP_RB` : ''}
					label="Temp RB"
					precision={precision}
					format={numberFormat}
					showUnit={showUnits}
					unit={units}
				/>
				<PvInput
					client={client}
					pvName={pvPrefix ? `${pvPrefix}:TEMP_SP` : ''}
					label="Temp SP"
					step={0.1}
				/>
			</div>

			<div className="cool-row">
				<span className="pv-display" title={pvPrefix ? `${pvPrefix}:STATE_RB` : 'STATE_RB'}>
					<span className="pv-label">State RB</span>
					<span className="pv-value">{stateRbLabel}</span>
				</span>
				{stateChoices.length > 0 ? (
					<div className="pv-input-group" title={pvPrefix ? `${pvPrefix}:STATE_SP` : 'STATE_SP'}>
						<label className="pv-label">State SP</label>
						<select
							className="pv-input"
							value={Number.isInteger(stateSpIndex) ? String(stateSpIndex) : ''}
							onChange={(e) => writeState(parseInt(e.target.value, 10))}
						>
							{!Number.isInteger(stateSpIndex) && <option value="">---</option>}
							{stateChoices.map((label, idx) => (
								<option key={idx} value={idx}>{String(label)}</option>
							))}
						</select>
					</div>
				) : (
					<PvInput
						client={client}
						pvName={pvPrefix ? `${pvPrefix}:STATE_SP` : ''}
						label="State SP"
						step={1}
					/>
				)}
			</div>
		</div>
	);
}
