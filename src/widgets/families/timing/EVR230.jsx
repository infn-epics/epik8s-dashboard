import { PvDisplay, PvInput, getPvText } from '../../../components/common/PvControls.jsx';
import { usePv } from '../../../hooks/usePv.js';

/**
 * EVR230 timing receiver (MRF PCI-230).
 */
export default function EVR230Widget({ config, client }) {
  const pvPrefix = config.pvPrefix || '';
  const precision = config.precision ?? 3;
  const numberFormat = config.format || 'decimal';
  const showUnits = config.showUnits !== false;
  const numDG = config.numDelayGens ?? 8;

  return (
    <div className="timing-widget-body timing-detail">
      <div className="timing-section-title">Global</div>
      <div className="timing-field-row">
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Link-Sts` : ''} label="Link" />
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Pll-Sts` : ''} label="PLL" />
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Time-Clock-I` : ''} label="Time" />
      </div>
      <div className="timing-field-row">
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Cnt-RxErr-I` : ''} label="RX Err" precision={0} />
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Cnt-LinkTimo-I` : ''} label="TIMO" precision={0} />
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:SFP-Pwr-RX-I` : ''} label="RX Pwr" precision={precision} format={numberFormat} showUnit={showUnits} unit="mW" />
      </div>

      <div className="timing-section-title">Delay Generators</div>
      <table className="timing-dg-table timing-dg-detail">
        <thead>
          <tr><th>Label</th><th>On/Off</th><th>Delay</th><th>Width</th><th>Evt</th></tr>
        </thead>
        <tbody>
          {Array.from({ length: numDG }, (_, i) => (
            <tr key={i}>
              <td><DelayGenLabel client={client} pvPrefix={pvPrefix} index={i} /></td>
              <td><DelayOnOffControl client={client} pvPrefix={pvPrefix} index={i} /></td>
              <td><PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:DlyGen${i}Delay-SP` : ''} step={0.01} /></td>
              <td><PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:DlyGen${i}Width-SP` : ''} step={1} /></td>
              <td><PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:DlyGen${i}EvtTrig0-SP` : ''} precision={0} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DelayGenLabel({ client, pvPrefix, index }) {
  const dlyLabel = usePv(client, pvPrefix ? `${pvPrefix}:DlyGen${index}Label-I` : '');
  const pulLabel = usePv(client, pvPrefix ? `${pvPrefix}:Pul${index}-Label-I` : '');
  const hasAnyUpdate = dlyLabel !== null || pulLabel !== null;

  if (!hasAnyUpdate) return '...';

  return getPvText(dlyLabel) || getPvText(pulLabel) || `DG${index}`;
}

function DelayOnOffControl({ client, pvPrefix, index }) {
  const pvName = pvPrefix ? `${pvPrefix}:DlyGen${index}Ena-Sel` : '';
  const ena = usePv(client, pvName);
  const value = Number(ena?.value);
  const isOn = value === 1;

  const toggle = () => {
    if (client && pvName) {
      client.put(pvName, isOn ? 0 : 1);
    }
  };

  return (
    <button type="button" className={`timing-onoff-btn ${isOn ? 'is-on' : 'is-off'}`} onClick={toggle}>
      {isOn ? 'ON' : 'OFF'}
    </button>
  );
}
