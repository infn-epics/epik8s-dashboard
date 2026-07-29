import { useEffect, useRef } from 'react';

const DEFAULT_PALETTE = ['#4f8ff7', '#34d399', '#f59e0b', '#ef4444', '#8b5cf6'];

/**
 * MiniChart — generic canvas polyline chart, N series.
 *
 * Extracted from src/widgets/families/bpm/BPM.jsx's BPMPlot draw effect
 * (same DPR-aware sizing, grid, y-axis labels, per-series polyline) and
 * generalized from BPM's hardcoded 2-series X/Y to any number of series.
 * BPM.jsx itself is intentionally left unmodified - only the drawing
 * logic is shared here; live-subscription/buffer management stays with
 * whoever owns the data (BPMPlot for live BPM data, ContentChartBlock in
 * voiceContentUI.jsx for historical get_history data).
 *
 * series: [{ label, color?, points: [{x, y}] }] - x/y are already-resolved
 * numbers (epoch ms / value), no unit assumptions made here.
 */
export default function MiniChart({ series, height = 140, showLegend = true }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    const allPts = series.flatMap((s) => s.points);
    if (allPts.length < 2) {
      ctx.fillStyle = 'rgba(200,210,230,0.6)';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for data…', w / 2, h / 2);
      return;
    }

    const minX = Math.min(...allPts.map((p) => p.x));
    const maxX = Math.max(...allPts.map((p) => p.x));
    const rangeX = maxX - minX || 1;
    const minY = Math.min(...allPts.map((p) => p.y));
    const maxY = Math.max(...allPts.map((p) => p.y));
    const rangeY = maxY - minY || 1;

    const pad = { top: 8, right: 8, bottom: 4, left: 42 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 3; i++) {
      const y = pad.top + (plotH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(200,210,230,0.7)';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 3; i++) {
      const y = pad.top + (plotH / 3) * i;
      const v = maxY - (rangeY / 3) * i;
      ctx.fillText(v.toPrecision(3), pad.left - 4, y + 3);
    }

    const drawTrace = (pts, color) => {
      if (pts.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = pad.left + ((p.x - minX) / rangeX) * plotW;
        const y = pad.top + plotH - ((p.y - minY) / rangeY) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    series.forEach((s, i) => drawTrace(s.points, s.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]));
  }, [series]);

  return (
    <div className="mini-chart">
      {showLegend && series.length > 0 && (
        <div className="mini-chart-legend">
          {series.map((s, i) => (
            <span key={s.label || i} className="mini-chart-legend-item">
              <span className="mini-chart-legend-swatch" style={{ background: s.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length] }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <canvas ref={canvasRef} className="mini-chart-canvas" style={{ height }} />
    </div>
  );
}
