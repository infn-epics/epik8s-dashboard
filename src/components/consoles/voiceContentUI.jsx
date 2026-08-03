/**
 * Presentational rich-content pieces for the voice chat's "Phase B"
 * feature (tables/charts/embedded control widgets), sibling to
 * voiceConsoleUI.jsx and following the same convention: no hooks besides
 * plain prop-driven rendering, testable with react-dom/server's
 * renderToStaticMarkup (see tests/voiceContentUI.test.jsx).
 *
 * Built incrementally per the Phase B plan chunking - ContentChartBlock
 * (B1: get_history -> chart) and ContentTableBlock (B2: list_iocs/
 * search_pvs/list_beamline_devices -> table) exist so far. ContentWidgetBlock
 * (B3) is added in its own pass, not stubbed out ahead of time.
 */
import MiniChart from '../common/MiniChart.jsx';
import { TranscriptLine } from './voiceConsoleUI.jsx';

/** Converts a chart content event's columnar {t:[...], v:[...]} series into
 * MiniChart's {x,y} point-array shape, at this component boundary rather
 * than the wire boundary (keeps the wire format compact - see
 * argus_content.py's MAX_CHART_POINTS comment for why columnar). */
export function ContentChartBlock({ content }) {
  const series = (content.series || []).map((s) => ({
    label: s.label,
    points: (s.t || []).map((t, i) => ({ x: t, y: s.v?.[i] })),
  }));
  return (
    <div className="content-block content-block--chart">
      <div className="content-block-title">
        {content.title}
        {content.unit ? ` (${content.unit})` : ''}
      </div>
      {content.truncated?.points ? (
        <div className="content-block-note">+{content.truncated.points} punti non mostrati</div>
      ) : null}
      <MiniChart series={series} />
    </div>
  );
}

/** Rows carrying a device_id (see argus_content.py's DEVGROUP_WIDGET_MAP /
 * "device_id" tagging) render clickable; onRowClick is only wired up by
 * call sites once B5 lands (click-to-embed) - passing nothing here just
 * means rows render as plain, non-interactive data, same as a row with no
 * device_id at all (e.g. list_iocs, or a devgroup this beamline's widget
 * registry doesn't cover). */
export function ContentTableBlock({ content, onRowClick }) {
  const columns = content.columns || [];
  const rows = content.rows || [];
  return (
    <div className="content-block content-block--table">
      <div className="content-block-title">{content.title}</div>
      {content.truncated?.rows ? (
        <div className="content-block-note">+{content.truncated.rows} righe non mostrate</div>
      ) : null}
      <div className="content-table-scroll">
        <table className="content-table">
          <thead>
            <tr>
              {columns.map((col) => <th key={col}>{col}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const clickable = Boolean(row.device_id && onRowClick);
              return (
                <tr
                  key={i}
                  className={row.device_id ? 'content-table-row--clickable' : undefined}
                  onClick={clickable ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => <td key={col}>{String(row.cells?.[col] ?? '')}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Kind dispatcher - renders nothing for a kind it doesn't yet know how to
 * render (B3 will extend this), rather than crashing on an unrecognized/
 * not-yet-implemented content kind. */
export function ContentBlock({ content, onRowClick }) {
  switch (content.kind) {
    case 'chart':
      return <ContentChartBlock content={content} />;
    case 'table':
      return <ContentTableBlock content={content} onRowClick={onRowClick} />;
    default:
      return null;
  }
}

/**
 * Renders the merged chronological feed built by buildChatFeed()
 * (src/voice/events.js), interleaving transcript lines with rich content
 * blocks. Drop-in replacement for TranscriptPanel at call sites that also
 * want rich content - TranscriptPanel itself stays available/tested for
 * simpler views.
 */
export function ChatFeed({ entries, partial, onRowClick }) {
  return (
    <div className="voice-transcript">
      {entries.length === 0 && !partial && (
        <div className="console-empty">Nessuna trascrizione</div>
      )}
      {entries.map((entry, i) => (
        entry.kind === 'transcript'
          ? <TranscriptLine key={i} role={entry.role} text={entry.text} />
          : <ContentBlock key={i} content={entry.content} onRowClick={onRowClick} />
      ))}
      {partial && (
        <TranscriptLine role={partial.role} text={partial.text} partial />
      )}
    </div>
  );
}
