import { useEffect, useRef, useState } from 'react';
import { PvDisplay } from '../../../components/common/PvControls.jsx';

/**
 * BPMWidget — Beam Position Monitor display.
 *
 * Essential: X/Y/Q numeric readouts (unchanged).
 * Detail:    readouts + a realtime X/Y trend plot (live PVWS subscription,
 *            rolling time window) - see BPMPlot below, which reuses the
 *            same subscribe+ref-buffer+canvas approach as
 *            widgets/families/plot/DataBrowser.jsx's live mode rather than
 *            introducing a second charting approach.
 *
 * Config: { pvPrefix, precision, showCharge, viewMode, plotWindowSec, title }
 */
export default function BPMWidget({ config, client }) {
  const pvPrefix = config.pvPrefix;
  const precision = config.precision ?? 3;
  const numberFormat = config.format || 'decimal';
  const showUnits = config.showUnits !== false;
  const viewMode = config.viewMode || 'essential';

  return (
    <div className="bpm-widget-body">
      <div className="bpm-readings">
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:X` : ''} label="X" precision={precision} format={numberFormat} showUnit={showUnits} unit="mm" />
        <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Y` : ''} label="Y" precision={precision} format={numberFormat} showUnit={showUnits} unit="mm" />
        {config.showCharge !== false && (
          <PvDisplay client={client} pvName={pvPrefix ? `${pvPrefix}:Charge` : ''} label="Q" precision={precision} format={numberFormat} showUnit={showUnits} unit="pC" />
        )}
      </div>
      {viewMode === 'detail' && (
        <BPMPlot pvPrefix={pvPrefix} client={client} windowSec={config.plotWindowSec || 60} />
      )}
    </div>
  );
}

const MAX_LIVE_POINTS = 600;
const COLOR_X = '#4f8ff7';
const COLOR_Y = '#34d399';

/**
 * Realtime X/Y trend plot: subscribes directly via client.subscribe (not
 * usePv, which only keeps the latest value) and accumulates a rolling
 * ref-based buffer per axis, redrawn on a 500ms timer - identical approach
 * to DataBrowser.jsx's live mode, just fixed to exactly the X/Y pair
 * instead of a configurable PV list.
 */
function BPMPlot({ pvPrefix, client, windowSec }) {
  const canvasRef = useRef(null);
  const bufferRef = useRef({ X: [], Y: [] });
  const [traces, setTraces] = useState({ X: [], Y: [] });
  const windowMs = windowSec * 1000;

  const pvX = pvPrefix ? `${pvPrefix}:X` : null;
  const pvY = pvPrefix ? `${pvPrefix}:Y` : null;

  useEffect(() => {
    if (!client || !pvX || !pvY) return;
    bufferRef.current = { X: [], Y: [] };

    const subscribeAxis = (pv, axis) => client.subscribe(pv, (msg) => {
      const val = typeof msg.value === 'number' ? msg.value : parseFloat(msg.value);
      if (isNaN(val)) return;
      const buf = bufferRef.current[axis];
      buf.push({ timestamp: Date.now(), value: val });
      const cutoff = Date.now() - windowMs;
      while (buf.length > 0 && buf[0].timestamp < cutoff) buf.shift();
      if (buf.length > MAX_LIVE_POINTS) buf.splice(0, buf.length - MAX_LIVE_POINTS);
    });

    const unsubX = subscribeAxis(pvX, 'X');
    const unsubY = subscribeAxis(pvY, 'Y');

    const timer = setInterval(() => {
      setTraces({ X: [...bufferRef.current.X], Y: [...bufferRef.current.Y] });
    }, 500);

    return () => { unsubX(); unsubY(); clearInterval(timer); };
  }, [client, pvX, pvY, windowMs]);

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

    const allPts = [...traces.X, ...traces.Y];
    if (allPts.length < 2) {
      ctx.fillStyle = 'rgba(200,210,230,0.6)';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for data…', w / 2, h / 2);
      return;
    }

    const minT = Math.min(...allPts.map((p) => p.timestamp));
    const maxT = Math.max(...allPts.map((p) => p.timestamp));
    const rangeT = maxT - minT || 1;
    const minV = Math.min(...allPts.map((p) => p.value));
    const maxV = Math.max(...allPts.map((p) => p.value));
    const rangeV = maxV - minV || 1;

    const pad = { top: 8, right: 8, bottom: 4, left: 42 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 3; i++) {
      const y = pad.top + (plotH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    // Y-axis labels (shared mm scale)
    ctx.fillStyle = 'rgba(200,210,230,0.7)';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 3; i++) {
      const y = pad.top + (plotH / 3) * i;
      const v = maxV - (rangeV / 3) * i;
      ctx.fillText(v.toPrecision(3), pad.left - 4, y + 3);
    }

    const drawTrace = (pts, color) => {
      if (pts.length < 2) return;
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
    };
    drawTrace(traces.X, COLOR_X);
    drawTrace(traces.Y, COLOR_Y);
  }, [traces]);

  return (
    <div className="bpm-plot">
      <div className="bpm-plot-legend">
        <span className="bpm-legend-item"><span className="bpm-legend-swatch" style={{ background: COLOR_X }} />X</span>
        <span className="bpm-legend-item"><span className="bpm-legend-swatch" style={{ background: COLOR_Y }} />Y</span>
        <span className="bpm-plot-window">last {windowSec}s</span>
      </div>
      <canvas ref={canvasRef} className="bpm-plot-canvas" />
    </div>
  );
}
