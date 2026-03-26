import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { searchChannels, getChannelFinderUrl } from '../../services/channelFinderApi.js';

/**
 * ChannelInfoDialog — modal for widget metadata and ChannelFinder results.
 *
 * Query strategy:
 * - exact lookup for each resolved PV in `pvs`
 * - prefix lookup for device `pvPrefix*`
 * - IOC fallback when no PV/prefix is available
 */
export default function ChannelInfoDialog({ device, widget, pvs = [], onClose }) {
  const [channels, setChannels] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [queryLog, setQueryLog] = useState([]);

  const cfUrl = getChannelFinderUrl();

  const normalizedPvs = useMemo(
    () => Array.from(new Set((pvs || []).map((v) => (v || '').toString().trim()).filter(Boolean))).slice(0, 8),
    [pvs],
  );

  const querySignature = useMemo(
    () => JSON.stringify({
      name: device?.name || '',
      iocName: device?.iocName || '',
      pvPrefix: device?.pvPrefix || '',
      pvs: normalizedPvs,
    }),
    [device?.name, device?.iocName, device?.pvPrefix, normalizedPvs],
  );

  const openChannelBrowserForPv = (pvName) => {
    if (!pvName) return;
    const url = new URL(window.location.href);
    url.pathname = '/channels';
    url.search = `?name=${encodeURIComponent(pvName)}`;
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    if (!cfUrl || !device) return;

    let cancelled = false;

    setLoading(true);
    setError(null);

    const queries = [];

    // Query exact PV names.
    for (const pv of normalizedPvs) {
      queries.push({ mode: 'pv', filters: { name: pv } });
    }
    // Query prefix for device channels.
    if (device.pvPrefix) {
      queries.push({ mode: 'prefix', filters: { name: `${device.pvPrefix}*` } });
    }
    // IOC fallback.
    if (!queries.length && device.iocName) {
      queries.push({ mode: 'ioc', filters: { iocName: device.iocName } });
    }
    // Name fallback.
    if (!queries.length && device.name) {
      queries.push({ mode: 'name', filters: { name: `*${device.name}*` } });
    }

    // Remove duplicated queries.
    const uniqueQueries = [];
    const seen = new Set();
    for (const q of queries) {
      const key = `${q.mode}:${JSON.stringify(q.filters)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueQueries.push(q);
    }

    setQueryLog(uniqueQueries.map((q) => ({ mode: q.mode, filters: q.filters })));

    Promise.all(uniqueQueries.map((q) => searchChannels(q.filters, 0, 50)))
      .then((results) => {
        if (cancelled) return;
        const byName = new Map();
        let total = 0;
        for (const res of results) {
          total += res?.totalCount || 0;
          for (const ch of res?.channels || []) {
            if (ch?.name && !byName.has(ch.name)) byName.set(ch.name, ch);
          }
        }
        setChannels(Array.from(byName.values()));
        setTotalCount(total || byName.size);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cfUrl, querySignature]);

  if (!device) return null;

  // Aggregate info from channel properties
  const aggregateProps = (propName) => {
    const values = new Set();
    for (const ch of channels) {
      const prop = ch.properties?.find(p => p.name === propName);
      if (prop?.value) values.add(prop.value);
    }
    return [...values];
  };

  const protocolCounts = {};
  for (const ch of channels) {
    const proto = ch.properties?.find(p => p.name === 'pvProtocol')?.value || 'ca';
    protocolCounts[proto] = (protocolCounts[proto] || 0) + 1;
  }

  const allTags = new Set();
  for (const ch of channels) {
    for (const t of (ch.tags || [])) allTags.add(t.name);
  }

  return createPortal(
    <div className="widget-modal-overlay" onClick={onClose}>
      <div className="ci-dialog" onClick={e => e.stopPropagation()}>
        <div className="ci-header">
          <h3>📡 Widget Info — {device.name || device.iocName}</h3>
          <button className="widget-btn" onClick={onClose}>✕</button>
        </div>

        {!cfUrl && <div className="cb-error">ChannelFinder service not configured</div>}
        {loading && <div className="ci-loading">Querying ChannelFinder…</div>}
        {error && <div className="cb-error">{error}</div>}

        {!loading && !error && cfUrl && (
          <div className="ci-body">
            {/* Summary */}
            <div className="ci-summary">
              {widget?.type && (
                <div className="ci-summary-item">
                  <span className="ci-label">Widget Type</span>
                  <span className="ci-value">{widget.type}</span>
                </div>
              )}
              {widget?.category && (
                <div className="ci-summary-item">
                  <span className="ci-label">Category</span>
                  <span className="ci-value">{widget.category}</span>
                </div>
              )}
              {widget?.dataSource && (
                <div className="ci-summary-item">
                  <span className="ci-label">Data Source</span>
                  <span className="ci-value">{widget.dataSource}</span>
                </div>
              )}
              <div className="ci-summary-item">
                <span className="ci-label">Total Channels</span>
                <span className="ci-value">{totalCount}</span>
              </div>
              {device.iocName && (
                <div className="ci-summary-item">
                  <span className="ci-label">IOC</span>
                  <span className="ci-value">{device.iocName}</span>
                </div>
              )}
              {aggregateProps('host').map(h => (
                <div key={h} className="ci-summary-item">
                  <span className="ci-label">Host</span>
                  <span className="ci-value">{h}</span>
                </div>
              ))}
              {aggregateProps('ioc_version').map(v => (
                <div key={v} className="ci-summary-item">
                  <span className="ci-label">IOC Version</span>
                  <span className="ci-value">{v}</span>
                </div>
              ))}
              {aggregateProps('ioc_start_time').map(t => (
                <div key={t} className="ci-summary-item">
                  <span className="ci-label">Started</span>
                  <span className="ci-value">{t}</span>
                </div>
              ))}
              {aggregateProps('asset').map(a => (
                <div key={a} className="ci-summary-item">
                  <span className="ci-label">Asset</span>
                  <span className="ci-value">
                    <a href={a} target="_blank" rel="noopener noreferrer">{a}</a>
                  </span>
                </div>
              ))}
              <div className="ci-summary-item">
                <span className="ci-label">Protocol</span>
                <span className="ci-value">
                  {Object.entries(protocolCounts).map(([proto, count]) => (
                    <span key={proto} className={`cb-protocol cb-protocol--${proto}`}>
                      {proto}: {count}
                    </span>
                  ))}
                </span>
              </div>
              {allTags.size > 0 && (
                <div className="ci-summary-item ci-summary-item--wide">
                  <span className="ci-label">Tags</span>
                  <span className="ci-value ci-tags">
                    {[...allTags].map(t => <span key={t} className="cb-tag">{t}</span>)}
                  </span>
                </div>
              )}
              {queryLog.length > 0 && (
                <div className="ci-summary-item ci-summary-item--wide">
                  <span className="ci-label">Channel Query</span>
                  <span className="ci-value">
                    {queryLog.map((q, i) => (
                      <span key={`${q.mode}-${i}`} className="cb-tag">
                        {q.mode}: {JSON.stringify(q.filters)}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {pvs.length > 0 && (
                <div className="ci-summary-item ci-summary-item--wide">
                  <span className="ci-label">Resolved PVs</span>
                  <span className="ci-value ci-tags">
                    {pvs.map((pv) => (
                      <button
                        key={pv}
                        type="button"
                        className="cb-tag ci-pv-link"
                        title={`Open Channel Browser for ${pv}`}
                        onClick={() => openChannelBrowserForPv(pv)}
                      >
                        {pv}
                      </button>
                    ))}
                  </span>
                </div>
              )}
            </div>

            {/* Widget metadata */}
            {widget?.config && (
              <div className="ci-channels" style={{ marginBottom: 16 }}>
                <h4>Widget Metadata</h4>
                <div className="ci-channel-detail" style={{ paddingLeft: 8 }}>
                  {Object.entries(widget.config).map(([k, v]) => (
                    <div key={k} className="cb-detail-prop">
                      <span className="cb-detail-key">{k}</span>
                      <span className="cb-detail-value">
                        {typeof v === 'string' ? v : JSON.stringify(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Channel list */}
            <div className="ci-channels">
              <h4>Channels ({channels.length}{totalCount > channels.length ? ` of ${totalCount}` : ''})</h4>
              <div className="ci-channel-list">
                {channels.map(ch => (
                  <div
                    key={ch.name}
                    className={`ci-channel-item ${expanded === ch.name ? 'ci-channel-item--expanded' : ''}`}
                  >
                    <div className="ci-channel-name" onClick={() => setExpanded(prev => prev === ch.name ? null : ch.name)}>
                      <span className="cb-expand-icon">{expanded === ch.name ? '▼' : '▶'}</span>
                      {ch.name}
                      <span className={`cb-protocol cb-protocol--${ch.properties?.find(p => p.name === 'pvProtocol')?.value || 'ca'}`}>
                        {ch.properties?.find(p => p.name === 'pvProtocol')?.value || 'ca'}
                      </span>
                    </div>
                    {expanded === ch.name && (
                      <div className="ci-channel-detail">
                        {(ch.properties || []).map(p => (
                          <div key={p.name} className="cb-detail-prop">
                            <span className="cb-detail-key">{p.name}</span>
                            <span className="cb-detail-value">{p.value || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
