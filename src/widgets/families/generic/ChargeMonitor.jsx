import { useState, useEffect, useRef } from 'react';
import { usePv } from '../../../hooks/usePv.js';
import { formatPvValue } from '../../../components/common/PvControls.jsx';

/**
 * ChargeMonitorWidget — charge display with mini trend sparkline.
 *
 * Config: { pvPrefix, units, precision, showTrend, trendLength, title }
 */
export default function ChargeMonitorWidget({ config, client }) {
  const pvPrefix = config.pvPrefix;
  const chargePv = usePv(client, pvPrefix ? `${pvPrefix}:Charge` : null);
  const precision = config.precision ?? 3;
  const units = config.units || 'pC';
  const format = config.format || 'decimal';
  const showTrend = config.showTrend !== false;
  const trendLen = config.trendLength || 50;

  const [history, setHistory] = useState([]);
  const canvasRef = useRef(null);

  // Accumulate history
  useEffect(() => {
    const val = chargePv?.value;
    if (typeof val !== 'number') return;
    setHistory((prev) => {
      const next = [...prev, val];
      return next.length > trendLen ? next.slice(-trendLen) : next;
    });
  }, [chargePv, trendLen]);

  // Draw sparkline
  useEffect(() => {
    if (!showTrend || !canvasRef.current || history.length < 2) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = max - min || 1;

    ctx.strokeStyle = '#4f8ff7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    history.forEach((v, i) => {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [history, showTrend]);

  const val = chargePv?.value;
  const display = formatPvValue(val, format, precision);

  return (
    <div className="charge-widget-body">
      <div className="charge-readback">
        <span className="charge-value">{display}</span>
        {config.showUnits !== false && <span className="charge-unit">{units}</span>}
      </div>
      {showTrend && (
        <canvas
          ref={canvasRef}
          className="charge-sparkline"
          width={200}
          height={40}
        />
      )}
    </div>
  );
}
