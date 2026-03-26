import { PvDisplay } from '../../../components/common/PvControls.jsx';

/**
 * BPMWidget — Beam Position Monitor display.
 *
 * Config: { pvPrefix, precision, showCharge, title }
 */
export default function BPMWidget({ config, client }) {
  const pvPrefix = config.pvPrefix;
  const precision = config.precision ?? 3;
  const numberFormat = config.format || 'decimal';
  const showUnits = config.showUnits !== false;

  return (
    <div className="bpm-widget-body">
      <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:X` : ''} label="X" precision={precision} format={numberFormat} showUnit={showUnits} unit="mm" />
      <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Y` : ''} label="Y" precision={precision} format={numberFormat} showUnit={showUnits} unit="mm" />
      {config.showCharge !== false && (
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Charge` : ''} label="Q" precision={precision} format={numberFormat} showUnit={showUnits} unit="pC" />
      )}
    </div>
  );
}
