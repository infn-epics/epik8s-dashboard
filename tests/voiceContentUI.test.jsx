import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentChartBlock, ContentTableBlock, ContentWidgetBlock, ContentBlock, ChatFeed } from '../src/components/consoles/voiceContentUI.jsx';

const chartContent = {
  type: 'content',
  kind: 'chart',
  tool: 'sparc-argus__get_history',
  title: 'SPARC:MAG:HZ:GUNSOL01:CURRENT_RB',
  unit: 'A',
  series: [{ label: 'CURRENT_RB', pv: 'SPARC:MAG:HZ:GUNSOL01:CURRENT_RB', t: [1, 2, 3], v: [10, 11, 12] }],
  ts: 1000,
};

const tableContent = {
  type: 'content',
  kind: 'table',
  tool: 'sparc-argus__list_beamline_devices',
  title: 'Devices (2 of 2, devgroup=mag)',
  columns: ['name', 'devgroup', 'devfunc', 'ioc_name'],
  rows: [
    {
      cells: { name: 'GUNSOL01', devgroup: 'mag', devfunc: 'SOL', ioc_name: 'haz-ser-ch1' },
      device_id: 'SPARC:MAG:HZ:GUNSOL01',
      pv_prefix: 'SPARC:MAG:HZ:GUNSOL01',
      widget_type: 'power-supply',
    },
    {
      cells: { name: 'AC1SOL01', devgroup: 'mag', devfunc: 'SOL', ioc_name: 'haz-ser-ch1' },
    },
  ],
  ts: 1000,
};

// Shaped like a search_pvs row (argus_content.py's _build_search_pvs_table):
// device_id only, no pv_prefix/widget_type - a raw PV isn't a whole device.
const pvOnlyTableContent = {
  ...tableContent,
  columns: ['name', 'devgroup', 'ioc'],
  rows: [
    { cells: { name: 'SPARC:MAG:HZ:GUNSOL01:ALL_FAULT', devgroup: 'mag', ioc: 'haz-ser-ch1' }, device_id: 'SPARC:MAG:HZ:GUNSOL01:ALL_FAULT' },
  ],
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

describe('ContentTableBlock', () => {
  it('renders the title, columns, and cell values', () => {
    const html = renderToStaticMarkup(<ContentTableBlock content={tableContent} />);
    expect(html).toContain('Devices (2 of 2, devgroup=mag)');
    expect(html).toContain('GUNSOL01');
    expect(html).toContain('AC1SOL01');
  });

  it('shows a truncation note when rows were dropped', () => {
    const html = renderToStaticMarkup(
      <ContentTableBlock content={{ ...tableContent, truncated: { rows: 5 } }} />
    );
    expect(html).toContain('5');
  });

  it('marks rows with pv_prefix+widget_type as clickable, others not', () => {
    const html = renderToStaticMarkup(<ContentTableBlock content={tableContent} onRowClick={() => {}} />);
    expect(html).toContain('content-table-row--clickable');
  });

  it('does not mark a device_id-only row (e.g. a raw search_pvs PV) as clickable', () => {
    const html = renderToStaticMarkup(<ContentTableBlock content={pvOnlyTableContent} onRowClick={() => {}} />);
    expect(html).not.toContain('content-table-row--clickable');
  });

  it('still shows the clickable affordance even with no onRowClick handler given', () => {
    const html = renderToStaticMarkup(<ContentTableBlock content={tableContent} />);
    // embeddable rows keep the visual affordance class regardless, but no
    // onClick fires without a handler (can't assert that via static HTML).
    expect(html).toContain('content-table-row--clickable');
  });

  it('renders without a truncation note when not truncated', () => {
    const html = renderToStaticMarkup(<ContentTableBlock content={tableContent} />);
    expect(html).not.toContain('content-block-note');
  });
});

const widgetContent = {
  type: 'content',
  kind: 'widget',
  tool: 'sparc-argus__get_device',
  title: 'GUNSOL01 (mag)',
  device_id: 'SPARC:MAG:HZ:GUNSOL01',
  pv_prefix: 'SPARC:MAG:HZ:GUNSOL01',
  widget_type: 'power-supply',
  config: { pvPrefix: 'SPARC:MAG:HZ:GUNSOL01', viewMode: 'essential' },
  ts: 1000,
};

describe('ContentWidgetBlock', () => {
  it('renders the title and the resolved widget component', () => {
    const html = renderToStaticMarkup(<ContentWidgetBlock content={widgetContent} />);
    expect(html).toContain('GUNSOL01 (mag)');
    expect(html).toContain('content-widget-body');
  });

  it('falls back to the generic widget for an unknown widget_type rather than crashing', () => {
    const html = renderToStaticMarkup(
      <ContentWidgetBlock content={{ ...widgetContent, widget_type: 'not-a-real-type' }} />
    );
    expect(html).toContain('content-widget-body');
  });
});

describe('ContentBlock', () => {
  it('dispatches chart content to ContentChartBlock', () => {
    const html = renderToStaticMarkup(<ContentBlock content={chartContent} />);
    expect(html).toContain('content-block--chart');
  });

  it('dispatches table content to ContentTableBlock', () => {
    const html = renderToStaticMarkup(<ContentBlock content={tableContent} />);
    expect(html).toContain('content-block--table');
  });

  it('dispatches widget content to ContentWidgetBlock', () => {
    const html = renderToStaticMarkup(<ContentBlock content={widgetContent} />);
    expect(html).toContain('content-block--widget');
  });

  it('renders nothing for an unrecognized/not-yet-implemented kind', () => {
    const html = renderToStaticMarkup(<ContentBlock content={{ kind: 'multichoice' }} />);
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
