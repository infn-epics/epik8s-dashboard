import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MiniChart from '../src/components/common/MiniChart.jsx';

// renderToStaticMarkup does not run effects (no DOM/canvas context in
// SSR), so the canvas-drawn "Waiting for data…" placeholder and the
// actual polylines aren't verifiable here - only the static markup
// (legend, canvas element presence) is testable, same limitation this
// repo's other canvas-based widgets accept.

describe('MiniChart', () => {
  it('renders a canvas element', () => {
    const html = renderToStaticMarkup(<MiniChart series={[]} />);
    expect(html).toContain('<canvas');
    expect(html).toContain('mini-chart-canvas');
  });

  it('renders a legend entry per series with its label', () => {
    const html = renderToStaticMarkup(
      <MiniChart series={[{ label: 'X', points: [] }, { label: 'Y', points: [] }]} />
    );
    expect(html).toContain('mini-chart-legend');
    expect(html).toContain('>X<');
    expect(html).toContain('>Y<');
  });

  it('omits the legend when showLegend is false', () => {
    const html = renderToStaticMarkup(
      <MiniChart series={[{ label: 'X', points: [] }]} showLegend={false} />
    );
    expect(html).not.toContain('mini-chart-legend');
  });

  it('omits the legend for zero series even when showLegend is true', () => {
    const html = renderToStaticMarkup(<MiniChart series={[]} showLegend />);
    expect(html).not.toContain('mini-chart-legend');
  });

  it('does not throw for a single series with real points', () => {
    const html = renderToStaticMarkup(
      <MiniChart series={[{ label: 'CURRENT_RB', points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }]} />
    );
    expect(html).toContain('CURRENT_RB');
  });
});
