import { usePv } from '../../../hooks/usePv.js';
import { PvDisplay, PvInput } from '../../../components/common/PvControls.jsx';

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

const STATE_SP_OPTIONS = ['ON', 'STANDBY', 'RESET'];

/**
 * PowerSupplyWidget — current/voltage set/read, on/off control.
 *
 * Config: { pvPrefix, maxCurrent, maxVoltage, precision, title }
 */
export default function PowerSupplyWidget({ config, client }) {
  const pvPrefix = config.pvPrefix;
  const stateRbPv = usePv(client, pvPrefix ? `${pvPrefix}:STATE_RB` : null);
  const stateSpPv = usePv(client, pvPrefix ? `${pvPrefix}:STATE_SP` : null);

  const precision = config.precision ?? 3;
  const numberFormat = config.format || 'decimal';
  const showUnits = config.showUnits !== false;

  const stateSpRaw = stateSpPv?.value;
  const stateChoices = (() => {
    const fromSp = resolveEnumChoices(stateSpPv);
    if (fromSp.length) return fromSp.map((v) => String(v).toUpperCase());
    const fromRb = resolveEnumChoices(stateRbPv);
    return fromRb.length ? fromRb.map((v) => String(v).toUpperCase()) : [];
  })();
  const stateRbLabel = resolveEnumLabel(stateRbPv);

  const stateSpString = (() => {
    if (typeof stateSpRaw === 'string') return stateSpRaw.toUpperCase();
    if (Number.isInteger(stateSpRaw) && stateChoices[stateSpRaw]) return stateChoices[stateSpRaw];
    return '';
  })();

  const writeState = (stateCmd) => {
    if (!client || !pvPrefix || !stateCmd) return;
    client.put(`${pvPrefix}:STATE_SP`, stateCmd);
  };

  return (
    <div className="ps-widget-body">
      <div className="ps-status-row ps-state-row">
        <span className="pv-display" title={pvPrefix ? `${pvPrefix}:STATE_RB` : 'STATE_RB'}>
          <span className="pv-label">State RB</span>
          <span className="pv-value">{stateRbLabel}</span>
        </span>

        <div className="pv-input-group" title={pvPrefix ? `${pvPrefix}:STATE_SP` : 'STATE_SP'}>
          <label className="pv-label">State SP</label>
          <div className="ps-state-buttons">
            {STATE_SP_OPTIONS.map((state) => (
              <button
                key={state}
                type="button"
                className={`widget-action-btn ${stateSpString === state ? 'on' : ''}`}
                onClick={() => writeState(state)}
              >
                {state}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ps-readings">
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:CURRENT_RB` : ''} label="I read" precision={precision} format={numberFormat} showUnit={showUnits} unit="A" />
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:VOLTAGE_RB` : ''} label="V read" precision={precision} format={numberFormat} showUnit={showUnits} unit="V" />
      </div>

      <div className="ps-setpoints">
        <PvInput
          client={client}
          pvName={pvPrefix ? `${pvPrefix}:CURRENT_SP` : ''}
          label="I set"
          min={0}
          max={config.maxCurrent ?? 100}
          step={0.01}
        />
        <PvInput
          client={client}
          pvName={pvPrefix ? `${pvPrefix}:VOLTAGE_SP` : ''}
          label="V set"
          min={0}
          max={config.maxVoltage ?? 50}
          step={0.01}
        />
      </div>
    </div>
  );
}
