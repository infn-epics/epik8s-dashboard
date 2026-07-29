/**
 * Presentational rich-content pieces for the voice chat's "Phase B"
 * feature (tables/charts/embedded control widgets), sibling to
 * voiceConsoleUI.jsx and following the same convention: no hooks besides
 * plain prop-driven rendering, testable with react-dom/server's
 * renderToStaticMarkup (see tests/voiceContentUI.test.jsx).
 *
 * Built incrementally per the Phase B plan chunking - only ContentChartBlock
 * exists so far (B1: get_history -> chart). ContentTableBlock (B2) and
 * ContentWidgetBlock (B3) are added in their own passes, not stubbed out
 * ahead of time.
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

/** Kind dispatcher - renders nothing for a kind it doesn't yet know how to
 * render (B2/B3 will extend this), rather than crashing on an
 * unrecognized/not-yet-implemented content kind. */
export function ContentBlock({ content }) {
  switch (content.kind) {
    case 'chart':
      return <ContentChartBlock content={content} />;
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
export function ChatFeed({ entries, partial }) {
  return (
    <div className="voice-transcript">
      {entries.length === 0 && !partial && (
        <div className="console-empty">Nessuna trascrizione</div>
      )}
      {entries.map((entry, i) => (
        entry.kind === 'transcript'
          ? <TranscriptLine key={i} role={entry.role} text={entry.text} />
          : <ContentBlock key={i} content={entry.content} />
      ))}
      {partial && (
        <TranscriptLine role={partial.role} text={partial.text} partial />
      )}
    </div>
  );
}
