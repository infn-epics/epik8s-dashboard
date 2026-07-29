import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentChartBlock, ContentBlock, ChatFeed } from '../src/components/consoles/voiceContentUI.jsx';

const chartContent = {
  type: 'content',
  kind: 'chart',
  tool: 'sparc-argus__get_history',
  title: 'SPARC:MAG:HZ:GUNSOL01:CURRENT_RB',
  unit: 'A',
  series: [{ label: 'CURRENT_RB', pv: 'SPARC:MAG:HZ:GUNSOL01:CURRENT_RB', t: [1, 2, 3], v: [10, 11, 12] }],
  ts: 1000,
};

describe('ContentChartBlock', () => {
  it('renders the title, unit, and a MiniChart canvas', () => {
    const html = renderToStaticMarkup(<ContentChartBlock content={chartContent} />);
    expect(html).toContain('SPARC:MAG:HZ:GUNSOL01:CURRENT_RB');
    expect(html).toContain('(A)');
    expect(html).toContain('mini-chart-canvas');
    expect(html).toContain('CURRENT_RB'); // series label in the legend
  });

  it('shows a truncation note when points were dropped', () => {
    const html = renderToStaticMarkup(
      <ContentChartBlock content={{ ...chartContent, truncated: { points: 42 } }} />
    );
    expect(html).toContain('42');
  });

  it('renders without a truncation note when not truncated', () => {
    const html = renderToStaticMarkup(<ContentChartBlock content={chartContent} />);
    expect(html).not.toContain('content-block-note');
  });
});

describe('ContentBlock', () => {
  it('dispatches chart content to ContentChartBlock', () => {
    const html = renderToStaticMarkup(<ContentBlock content={chartContent} />);
    expect(html).toContain('content-block--chart');
  });

  it('renders nothing for an unrecognized/not-yet-implemented kind', () => {
    const html = renderToStaticMarkup(<ContentBlock content={{ kind: 'table' }} />);
    expect(html).toBe('');
  });
});

describe('ChatFeed', () => {
  it('shows the empty state with no entries and no partial', () => {
    const html = renderToStaticMarkup(<ChatFeed entries={[]} partial={null} />);
    expect(html).toContain('Nessuna trascrizione');
  });

  it('interleaves transcript lines and content blocks in the given order', () => {
    const entries = [
      { kind: 'transcript', role: 'user', text: 'che corrente ha Q1?', ts: 100 },
      { kind: 'content', content: chartContent, ts: 200 },
      { kind: 'transcript', role: 'assistant', text: 'ecco il grafico', ts: 300 },
    ];
    const html = renderToStaticMarkup(<ChatFeed entries={entries} partial={null} />);
    expect(html).toContain('che corrente ha Q1?');
    expect(html).toContain('mini-chart-canvas');
    expect(html).toContain('ecco il grafico');
  });

  it('renders the live partial transcript line', () => {
    const html = renderToStaticMarkup(
      <ChatFeed entries={[]} partial={{ role: 'assistant', text: 'sto pensando…' }} />
    );
    expect(html).toContain('sto pensando…');
    expect(html).toContain('voice-transcript-line--partial');
  });
});
