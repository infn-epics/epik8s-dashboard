import { PvDisplay, PvInput } from '../../../components/common/PvControls.jsx';

/**
 * EVG230 timing generator (MRF PCI-230).
 */
export default function EVG230Widget({ config, client }) {
  const pvPrefix = config.pvPrefix || '';
  const precision = config.precision ?? 3;
  const numberFormat = config.format || 'decimal';
  const showUnits = config.showUnits !== false;

  return (
    <div className="timing-widget-body timing-detail">
      <div className="timing-section-title">Event Clock</div>
      <div className="timing-field-row">
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:EvtClk-RFFreq-SP` : ''} label="RF Input" step={0.001} />
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:EvtClk-RFDiv-SP` : ''} label="RF Div" step={1} />
      </div>
      <div className="timing-field-row">
        <PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:EvtClk-FracSynFreq-SP` : ''} label="FS Freq" step={0.001} />
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:EvtClk-Source-Sel` : ''} label="Source" />
      </div>
      <div className="timing-field-row">
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:EvtClk-Frequency-RB` : ''} label="Evt Clk" precision={precision} format={numberFormat} showUnit={showUnits} unit="MHz" />
      </div>

      <div className="timing-section-title">Prescalers</div>
      <table className="timing-dg-table">
        <thead>
          <tr><th>PS</th><th>Div</th><th>Rate</th></tr>
        </thead>
        <tbody>
          {[0, 1, 2].map((n) => (
            <tr key={n}>
              <td>{n}</td>
              <td><PvInput client={client} pvName={pvPrefix ? `${pvPrefix}:PS${n}-Div-SP` : ''} step={1} /></td>
              <td><PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:PS${n}-Rate-I` : ''} precision={precision} format={numberFormat} showUnit={showUnits} unit="Hz" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
