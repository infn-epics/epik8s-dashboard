import { useRef, useEffect } from 'react';
import { usePv } from '../../../hooks/usePv.js';
import { formatPvValue } from '../../../components/common/PvControls.jsx';

/**
 * GaugeWidget — Arc gauge display for a numeric PV.
 * Phoebus equivalent: Gauge / Meter
 *
 * Config: { pv_name, min, max, units, warningHigh, alarmHigh, showTicks, foreground, fontSize }
 */
export default function GaugeWidget({ config, client }) {
  const pv = usePv(client, config.pv_name);
  const canvasRef = useRef(null);
  const val = pv?.value;
  const num = typeof val === 'number' ? val : parseFloat(val);

  const min = config.min ?? 0;
  const max = config.max ?? 100;
  const warnHi = config.warningHigh ?? (min + (max - min) * 0.8);
  const alarmHi = config.alarmHigh ?? (min + (max - min) * 0.9);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h - 10;
    const r = Math.min(cx, cy) - 12;
    const startAngle = Math.PI;
    const endAngle = 2 * Math.PI;

    ctx.clearRect(0, 0, w, h);

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();

    // Warning and alarm zones
    const angleRange = endAngle - startAngle;
    const toAngle = (v) => startAngle + ((v - min) / (max - min)) * angleRange;

    if (config.showTicks !== false) {
      // Warning zone
      ctx.beginPath();
      ctx.arc(cx, cy, r, toAngle(warnHi), toAngle(alarmHi));
      ctx.lineWidth = 14;
      ctx.strokeStyle = 'rgba(251,191,36,0.3)';
      ctx.stroke();

      // Alarm zone
      ctx.beginPath();
      ctx.arc(cx, cy, r, toAngle(alarmHi), endAngle);
      ctx.lineWidth = 14;
      ctx.strokeStyle = 'rgba(248,113,113,0.3)';
      ctx.stroke();
    }

    // Value arc
    if (!isNaN(num)) {
      const clamp = Math.max(min, Math.min(max, num));
      const valAngle = toAngle(clamp);
      let color = '#4f8ff7';
      if (clamp >= alarmHi) color = '#f87171';
      else if (clamp >= warnHi) color = '#fbbf24';

      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, valAngle);
      ctx.lineWidth = 14;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Needle
      const nx = cx + (r - 4) * Math.cos(valAngle);
      const ny = cy + (r - 4) * Math.sin(valAngle);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(nx, ny);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    // Value text
    const displayVal = formatPvValue(!isNaN(num) ? num : null, config.format || 'decimal', config.precision ?? 1);
    ctx.fillStyle = config.foreground || '#e1e4ed';
    ctx.font = `bold ${config.fontSize || 18}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(displayVal, cx, cy - 8);

    if (config.showUnits !== false && config.units) {
      ctx.font = '11px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(config.units, cx, cy + 6);
    }

    // Min/max labels
    if (config.showTicks !== false) {
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.textAlign = 'left';
      ctx.fillText(String(min), 4, cy + 2);
      ctx.textAlign = 'right';
      ctx.fillText(String(max), w - 4, cy + 2);
    }
  }, [num, min, max, warnHi, alarmHi, config]);

  return (
    <div className="phoebus-gauge">
      <canvas ref={canvasRef} width={200} height={120} className="gauge-canvas" />
    </div>
  );
}
