import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useApp } from '../../../context/AppContext.jsx';

/**
 * DataBrowserWidget — Multi-PV time-series plot.
 *
 * Modes:
 *  - archive=true  → fetch from EPICS Archiver Appliance (historical)
 *  - archive=false  → subscribe via PVWS and plot live rolling data
 *
 * Config: { pvs (text, newline-separated), timeRange, refreshInterval,
 *           archive, showGrid, showLegend, colors (text, newline-separated) }
 */

const TIME_RANGES = {
  '5m': 5 * 60e3,
  '15m': 15 * 60e3,
  '1h': 60 * 60e3,
  '6h': 6 * 60 * 60e3,
  '24h': 24 * 60 * 60e3,
  '7d': 7 * 24 * 60 * 60e3,
  '30d': 30 * 24 * 60 * 60e3,
};

const MAX_LIVE_POINTS = 600; // rolling buffer per PV

const DEFAULT_COLORS = ['#4f8ff7', '#34d399', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export default function DataBrowserWidget({ config, client }) {
  const { archiverClient } = useApp();
  const canvasRef = useRef(null);
  const [traces, setTraces] = useState({}); // { pvName: [{timestamp, value},...] }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedRange, setSelectedRange] = useState(config.timeRange || '1h');

  const pvList = useMemo(() =>
    (config.pvs || '').split('\n').map(s => s.trim()).filter(Boolean),
    [config.pvs],
  );

  const colorList = useMemo(() => {
    const custom = (config.colors || '').split('\n').map(s => s.trim()).filter(Boolean);
    return custom.length > 0 ? custom : DEFAULT_COLORS;
  }, [config.colors]);

  const rangeMs = TIME_RANGES[selectedRange] || TIME_RANGES['1h'];
  const refreshMs = (config.refreshInterval || 30) * 1000;
  const useArchive = config.archive !== false && !!archiverClient;

  // ==== Archiver mode: fetch historical data ====
  useEffect(() => {
    if (!useArchive || pvList.length === 0) return;
    let cancelled = false;

    const fetchAll = async () => {
      setLoading(true);
      setError(null);
      try {
        const to = new Date();
        const from = new Date(to.getTime() - rangeMs);
        const results = {};
        await Promise.all(pvList.map(async (pv) => {
          try {
            results[pv] = await archiverClient.fetchData(pv, from, to);
          } catch {
            results[pv] = [];
          }
        }));
        if (!cancelled) setTraces(results);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchAll();
    const timer = refreshMs > 0 ? setInterval(fetchAll, refreshMs) : null;
    return () => { cancelled = true; clearInterval(timer); };
  }, [useArchive, archiverClient, pvList.join(','), rangeMs, refreshMs]);

  // ==== Live PVWS mode: subscribe and accumulate ====
  const liveBufferRef = useRef({});

  useEffect(() => {
    if (useArchive || !client || pvList.length === 0) return;
    // Initialize buffers
    const buffers = {};
    for (const pv of pvList) buffers[pv] = liveBufferRef.current[pv] || [];
    liveBufferRef.current = buffers;

    const unsubs = pvList.map((pv) =>
      client.subscribe(pv, (msg) => {
        const val = typeof msg.value === 'number' ? msg.value : parseFloat(msg.value);
        if (isNaN(val)) return;
        const buf = liveBufferRef.current[pv] || [];
        buf.push({ timestamp: Date.now(), value: val });
        // Trim to time window + max points
        const cutoff = Date.now() - rangeMs;
        while (buf.length > 0 && buf[0].timestamp < cutoff) buf.shift();
        if (buf.length > MAX_LIVE_POINTS) buf.splice(0, buf.length - MAX_LIVE_POINTS);
        liveBufferRef.current[pv] = buf;
      })
    );

    // Periodic refresh of displayed traces from buffer
    const timer = setInterval(() => {
      const snapshot = {};
      for (const pv of pvList) snapshot[pv] = [...(liveBufferRef.current[pv] || [])];
      setTraces(snapshot);
    }, 500);

    return () => {
      unsubs.forEach((u) => u());
      clearInterval(timer);
    };
  }, [useArchive, client, pvList.join(','), rangeMs]);

  // Draw multi-trace chart
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

    // Dark background fill so traces are visible
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    // Gather all data points for axis scaling
    let allValues = [];
    let minT = Infinity, maxT = -Infinity;
    for (const pv of pvList) {
      const pts = traces[pv] || [];
      for (const p of pts) {
        allValues.push(p.value);
        if (p.timestamp < minT) minT = p.timestamp;
        if (p.timestamp > maxT) maxT = p.timestamp;
      }
    }

    if (allValues.length < 2) {
      ctx.fillStyle = 'rgba(200,210,230,0.6)';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(loading ? 'Loading…' : 'No data', w / 2, h / 2);
      return;
    }

    const minV = Math.min(...allValues);
    const maxV = Math.max(...allValues);
    const rangeV = maxV - minV || 1;
    const rangeT = maxT - minT || 1;

    const pad = { top: 10, right: 10, bottom: 28, left: 55 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Grid
    if (config.showGrid !== false) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (plotH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
      }
      for (let i = 0; i <= 4; i++) {
        const x = pad.left + (plotW / 4) * i;
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();
      }
    }

    // Y-axis labels
    ctx.fillStyle = 'rgba(200,210,230,0.7)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotH / 4) * i;
      const v = maxV - (rangeV / 4) * i;
      ctx.fillText(v.toPrecision(4), pad.left - 4, y + 3);
    }

    // Time labels
    ctx.fillStyle = 'rgba(200,210,230,0.7)';
    ctx.textAlign = 'center';
    const fmt = rangeMs >= 24 * 60 * 60e3
      ? (t) => new Date(t).toLocaleDateString()
      : (t) => new Date(t).toLocaleTimeString();
    for (let i = 0; i <= 3; i++) {
      const x = pad.left + (plotW / 3) * i;
      const t = minT + (rangeT / 3) * i;
      ctx.fillText(fmt(t), x, h - 6);
    }

    // Draw each trace
    pvList.forEach((pv, idx) => {
      const pts = traces[pv] || [];
      if (pts.length < 2) return;
      const color = colorList[idx % colorList.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = pad.left + ((p.timestamp - minT) / rangeT) * plotW;
        const y = pad.top + plotH - ((p.value - minV) / rangeV) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }, [traces, pvList, colorList, config.showGrid, loading, rangeMs]);

  if (pvList.length === 0) {
    return <div className="plot-empty">Configure PV names in properties</div>;
  }

  return (
    <div className="data-browser-widget">
      {/* Toolbar */}
      <div className="db-toolbar">
        <select
          className="db-range-select"
          value={selectedRange}
          onChange={(e) => setSelectedRange(e.target.value)}
        >
          {Object.keys(TIME_RANGES).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <span className="db-mode-badge">{useArchive ? '📦 Archive' : '⚡ Live'}</span>
        <span className="db-pv-count">{pvList.length} PV(s)</span>
        {loading && <span className="db-loading">⟳</span>}
        {error && <span className="db-error" title={error}>⚠</span>}
        {config.archive !== false && !archiverClient && <span className="db-error">No archiver</span>}
      </div>

      {/* Canvas */}
      <div className="db-chart-area">
        <canvas ref={canvasRef} className="db-canvas" />
      </div>

      {/* Legend */}
      {config.showLegend !== false && pvList.length > 0 && (
        <div className="db-legend">
          {pvList.map((pv, idx) => (
            <span key={pv} className="db-legend-item">
              <span
                className="db-legend-color"
                style={{ background: colorList[idx % colorList.length] }}
              />
              {pv}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
