import { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../../context/AppContext.jsx';

async function copyPvToClipboard(pvName) {
  if (!pvName || !navigator?.clipboard?.writeText) return;
  try {
    await navigator.clipboard.writeText(pvName);
  } catch (err) {
    // Best-effort copy only.
  }
}

/**
 * PlotWidget — time-series plot from EPICS Archiver.
 * Renders a simple canvas-based line chart.
 *
 * Config: { pvName, timeRange, refreshInterval, lineColor, showGrid, title }
 */

const TIME_RANGES = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export default function PlotWidget({ config, client }) {
  const { archiverClient } = useApp();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const canvasRef = useRef(null);

  const rangeMs = TIME_RANGES[config.timeRange || '1h'] || TIME_RANGES['1h'];
  const refreshMs = (config.refreshInterval || 30) * 1000;

  // Fetch archiver data
  useEffect(() => {
    if (!archiverClient || !config.pvName) return;
    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const to = new Date();
        const from = new Date(to.getTime() - rangeMs);
        const result = await archiverClient.fetchData(config.pvName, from, to);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    const timer = refreshMs > 0 ? setInterval(fetchData, refreshMs) : null;
    return () => { cancelled = true; clearInterval(timer); };
  }, [archiverClient, config.pvName, rangeMs, refreshMs]);

  // Draw chart
  useEffect(() => {
    if (!canvasRef.current || data.length < 2) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * (window.devicePixelRatio || 1);
    canvas.height = rect.height * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    const values = data.map((d) => d.value);
    const times = data.map((d) => d.timestamp);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const minT = times[0];
    const maxT = times[times.length - 1];
    const rangeV = maxV - minV || 1;
    const rangeT = maxT - minT || 1;

    const pad = { top: 10, right: 10, bottom: 25, left: 50 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Grid
    if (config.showGrid !== false) {
      ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--border') || '#2e3345';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (plotH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
      }
    }

    // Axis labels
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--text-dim') || '#8b90a0';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotH / 4) * i;
      const v = maxV - (rangeV / 4) * i;
      ctx.fillText(v.toPrecision(4), pad.left - 4, y + 3);
    }

    // Time labels
    ctx.textAlign = 'center';
    const fmt = rangeMs >= 24 * 60 * 60 * 1000
      ? (t) => new Date(t).toLocaleDateString()
      : (t) => new Date(t).toLocaleTimeString();
    for (let i = 0; i <= 3; i++) {
      const x = pad.left + (plotW / 3) * i;
      const t = minT + (rangeT / 3) * i;
      ctx.fillText(fmt(t), x, h - 4);
    }

    // Line
    ctx.strokeStyle = config.lineColor || '#4f8ff7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = pad.left + ((d.timestamp - minT) / rangeT) * plotW;
      const y = pad.top + plotH - ((d.value - minV) / rangeV) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [data, config.lineColor, config.showGrid, rangeMs]);

  if (!config.pvName) {
    return <div className="plot-empty">Configure a PV name</div>;
  }

  return (
    <div className="plot-widget-body">
      {loading && data.length === 0 && <div className="plot-loading">Loading…</div>}
      {error && <div className="plot-error">⚠ {error}</div>}
      {!archiverClient && (
        <div className="plot-no-archiver">
          No archiver configured. Set <code>archiver.url</code> in services.
        </div>
      )}
      <canvas ref={canvasRef} className="plot-canvas" />
      <div className="plot-footer">
        <span
          className="plot-pv"
          title={config.pvName ? `PV: ${config.pvName} (right-click to copy)` : ''}
          onContextMenu={(e) => {
            if (!config.pvName) return;
            e.preventDefault();
            copyPvToClipboard(config.pvName);
          }}
        >
          {config.pvName}
        </span>
        <span className="plot-range">{config.timeRange || '1h'}</span>
      </div>
    </div>
  );
}
