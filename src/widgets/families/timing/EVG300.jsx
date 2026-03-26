import { PvDisplay, PvInput } from '../../../components/common/PvControls.jsx';

/**
 * EVG300 timing generator (MRF uTCA-300).
 */
export default function EVG300Widget({ config, client }) {
  const pvPrefix = config.pvPrefix || '';
  const precision = config.precision ?? 3;
  const numberFormat = config.format || 'decimal';
  const showUnits = config.showUnits !== false;

  return (
    <div className="timing-widget-body timing-detail">
      <div className="timing-section-title">Event Clock</div>
      <div className="timing-field-row">
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:EvtClkRFFreq-SP` : ''} label="RF Input" step={0.001} />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:EvtClkRFDiv-SP` : ''} label="RF Div" step={1} />
      </div>
      <div className="timing-field-row">
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:EvtClkFracSynFreq-SP` : ''} label="FS Freq" step={0.001} />
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:EvtClkSource-Sel` : ''} label="Source" />
      </div>
      <div className="timing-field-row">
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:EvtClkFrequency-RB` : ''} label="Evt Clk" precision={precision} format={numberFormat} showUnit={showUnits} unit="MHz" />
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:EvtClkPll-Sts` : ''} label="PLL" />
      </div>

      <div className="timing-section-title">Multiplexed Counters</div>
      <table className="timing-dg-table">
        <thead>
          <tr><th>MXC</th><th>Prescaler</th><th>Frequency</th></tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
            <tr key={n}>
              <td>Mxc{n}</td>
              <td><PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Mxc${n}Prescaler-SP` : ''} precision={0} /></td>
              <td><PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Mxc${n}Frequency-RB` : ''} precision={precision} format={numberFormat} showUnit={showUnits} unit="Hz" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
