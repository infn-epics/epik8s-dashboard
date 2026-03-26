import { useState, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext.jsx';
import { searchChannels, getChannelFinderUrl } from '../../services/channelFinderApi.js';
import { PvDisplay } from '../common/PvControls.jsx';

const PAGE_SIZE = 50;

/**
 * ChannelBrowserView — paginated channel browser with filters.
 * Queries ChannelFinder REST API by name, IOC, zone, type, family, or raw query.
 */
export default function ChannelBrowserView() {
  const { zones, devices, pvwsClient, archiverClient, dataSources } = useApp();
  const location = useLocation();

  const presetName = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return (params.get('name') || '').trim();
  }, [location.search]);

  // Derive unique filter options from loaded devices
  const iocNames = useMemo(() => [...new Set(devices.map(d => d.iocName).filter(Boolean))].sort(), [devices]);
  const devTypes = useMemo(() => [...new Set(devices.map(d => d.type).filter(Boolean))].sort(), [devices]);
  const families = useMemo(() => [...new Set(devices.map(d => d.family).filter(Boolean))].sort(), [devices]);

  // Filter state
  const [nameFilter, setNameFilter] = useState(() => presetName || '*');
  const [iocFilter, setIocFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [familyFilter, setFamilyFilter] = useState('');
  const [rawFilter, setRawFilter] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  // Results
  const [channels, setChannels] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Expanded channel detail
  const [expanded, setExpanded] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedPv, setSelectedPv] = useState('');
  const [actionStatus, setActionStatus] = useState('');

  const cfUrl = getChannelFinderUrl();
  const archiverUrl = archiverClient?.baseUrl || dataSources?.archiverUrl || '';

  const doSearch = useCallback(async (p = 0) => {
    if (!cfUrl) {
      setError('ChannelFinder service not configured');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const filters = {};
      if (nameFilter) filters.name = nameFilter;
      if (iocFilter) filters.iocName = iocFilter;
      if (zoneFilter) filters.zone = zoneFilter;
      if (typeFilter) filters.devtype = typeFilter;
      if (familyFilter) filters.devgroup = familyFilter;
      if (showRaw && rawFilter) filters.raw = rawFilter;

      const result = await searchChannels(filters, p, PAGE_SIZE);
      setChannels(result.channels);
      setTotalCount(result.totalCount);
      setPage(p);
    } catch (err) {
      setError(err.message);
      setChannels([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [cfUrl, nameFilter, iocFilter, zoneFilter, typeFilter, familyFilter, rawFilter, showRaw]);

  // Initial search on mount (only default mode, no preset query)
  useEffect(() => {
    if (cfUrl && !presetName) doSearch(0);
  }, [cfUrl, presetName]); // eslint-disable-line react-hooks/exhaustive-deps

  // If page is opened with ?name=PV, prefill and search that PV directly.
  useEffect(() => {
    if (!cfUrl || !presetName) return;

    setNameFilter(presetName);
    setIocFilter('');
    setZoneFilter('');
    setTypeFilter('');
    setFamilyFilter('');
    setRawFilter('');
    setShowRaw(false);
    setActionStatus(`Prefilled from Widget Info: ${presetName}`);

    setLoading(true);
    setError(null);
    searchChannels({ name: presetName }, 0, PAGE_SIZE)
      .then((result) => {
        setChannels(result.channels);
        setTotalCount(result.totalCount);
        setPage(0);
      })
      .catch((err) => {
        setError(err.message);
        setChannels([]);
        setTotalCount(0);
      })
      .finally(() => setLoading(false));
  }, [cfUrl, presetName]);

  const handleSubmit = (e) => {
    e.preventDefault();
    doSearch(0);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const toggleExpand = (ch) => {
    setExpanded(prev => prev === ch.name ? null : ch.name);
  };

  const getProperty = (ch, propName) => {
    const prop = ch.properties?.find(p => p.name === propName);
    return prop?.value || '';
  };

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const handleClick = () => setContextMenu(null);
    const handleEsc = (e) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback((e, channel) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, channel });
  }, []);

  const handleCopyPv = useCallback(async (pvName) => {
    if (!pvName) return;
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(pvName);
      setActionStatus(`Copied ${pvName}`);
    } catch (err) {
      setActionStatus(`Copy failed: ${err.message}`);
    }
  }, []);

  const handleGraphPv = useCallback((pvName) => {
    if (!pvName) return;
    if (!archiverUrl) {
      setActionStatus('Archiver URL is not configured');
      return;
    }
    const pv = encodeURIComponent(pvName);
    const url = `${archiverUrl}/retrieval/ui/viewer/archViewer.html?pv=${pv}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [archiverUrl]);

  const handleArchivePv = useCallback(async (pvName) => {
    if (!pvName) return;
    if (!archiverUrl) {
      setActionStatus('Archiver URL is not configured');
      return;
    }
    const url = `${archiverUrl}/mgmt/bpl/addPV?pv=${encodeURIComponent(pvName)}`;
    try {
      const resp = await fetch(url);
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      setActionStatus(`Archive request sent for ${pvName}`);
    } catch (err) {
      setActionStatus(`Archive failed: ${err.message}`);
    }
  }, [archiverUrl]);

  return (
    <div className="channel-browser-view">
      <div className="view-toolbar">
        <span className="view-toolbar-title">📡 Channel Browser</span>
        <span className="cb-status">
          {cfUrl ? (
            <span className="cb-status-ok">● Connected</span>
          ) : (
            <span className="cb-status-err">● Not configured</span>
          )}
          {totalCount > 0 && <span className="cb-count">{totalCount.toLocaleString()} channels</span>}
        </span>
      </div>

      <form className="cb-filters" onSubmit={handleSubmit}>
        <div className="cb-filter-row">
          <div className="cb-filter-field">
            <label>Name</label>
            <input
              type="text"
              value={nameFilter}
              onChange={e => setNameFilter(e.target.value)}
              placeholder="*pattern* (glob)"
            />
          </div>
          <div className="cb-filter-field">
            <label>IOC</label>
            <select value={iocFilter} onChange={e => setIocFilter(e.target.value)}>
              <option value="">All IOCs</option>
              {iocNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="cb-filter-field">
            <label>Zone</label>
            <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)}>
              <option value="">All zones</option>
              {zones.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="cb-filter-field">
            <label>Type</label>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {devTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="cb-filter-field">
            <label>Family</label>
            <select value={familyFilter} onChange={e => setFamilyFilter(e.target.value)}>
              <option value="">All families</option>
              {families.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        <div className="cb-filter-row cb-filter-actions">
          <button
            type="button"
            className={`toolbar-btn ${showRaw ? 'active' : ''}`}
            onClick={() => setShowRaw(s => !s)}
          >
            🔧 Raw Query
          </button>
          {showRaw && (
            <input
              type="text"
              className="cb-raw-input"
              value={rawFilter}
              onChange={e => setRawFilter(e.target.value)}
              placeholder="key1=val1&key2=val2 (appended to query)"
            />
          )}
          <button type="submit" className="toolbar-btn active" disabled={loading}>
            {loading ? '⏳ Searching…' : '🔍 Search'}
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => {
              setNameFilter('*');
              setIocFilter('');
              setZoneFilter('');
              setTypeFilter('');
              setFamilyFilter('');
              setRawFilter('');
              setShowRaw(false);
            }}
          >
            ↻ Reset
          </button>
        </div>
      </form>

      {error && <div className="cb-error">{error}</div>}

      {selectedPv && (
        <div className="cb-quick-view">
          <div className="cb-quick-view-head">
            <strong>Selected PV</strong>
            <button className="toolbar-btn" onClick={() => setSelectedPv('')}>✕</button>
          </div>
          <div className="cb-quick-view-body">
            <span className="cb-quick-view-name">{selectedPv}</span>
            <PvDisplay client={pvwsClient} pvName={selectedPv} label="Live value" precision={0} />
          </div>
        </div>
      )}

      {actionStatus && <div className="cb-action-status">{actionStatus}</div>}

      <div className="cb-results">
        <table className="cb-table">
          <thead>
            <tr>
              <th className="cb-th-name">Channel Name</th>
              <th>IOC</th>
              <th>Type</th>
              <th>Family</th>
              <th>Zone</th>
              <th>Host</th>
              <th>Protocol</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            {channels.length === 0 && !loading && (
              <tr><td colSpan={8} className="cb-empty">No channels found</td></tr>
            )}
            {channels.map(ch => (
              <ChannelRow
                key={ch.name}
                channel={ch}
                expanded={expanded === ch.name}
                onToggle={() => toggleExpand(ch)}
                getProperty={getProperty}
                onContextMenu={handleContextMenu}
              />
            ))}
          </tbody>
        </table>
      </div>

      {contextMenu && (
        <div
          className="cb-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="cb-context-item"
            onClick={() => {
              setSelectedPv(contextMenu.channel.name);
              closeContextMenu();
            }}
          >
            Visualize PV
          </button>
          <button
            className="cb-context-item"
            onClick={() => {
              handleCopyPv(contextMenu.channel.name);
              closeContextMenu();
            }}
          >
            Copy PV
          </button>
          <button
            className="cb-context-item"
            onClick={() => {
              handleGraphPv(contextMenu.channel.name);
              closeContextMenu();
            }}
          >
            Graph PV
          </button>
          <button
            className="cb-context-item"
            onClick={() => {
              handleArchivePv(contextMenu.channel.name);
              closeContextMenu();
            }}
          >
            Archive PV
          </button>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="cb-pagination">
          <button
            className="toolbar-btn"
            disabled={page === 0}
            onClick={() => doSearch(0)}
          >
            ⏮
          </button>
          <button
            className="toolbar-btn"
            disabled={page === 0}
            onClick={() => doSearch(page - 1)}
          >
            ◀
          </button>
          <span className="cb-page-info">
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="toolbar-btn"
            disabled={page >= totalPages - 1}
            onClick={() => doSearch(page + 1)}
          >
            ▶
          </button>
          <button
            className="toolbar-btn"
            disabled={page >= totalPages - 1}
            onClick={() => doSearch(totalPages - 1)}
          >
            ⏭
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Single channel row — click to expand property/tag details.
 */
function ChannelRow({ channel, expanded, onToggle, getProperty, onContextMenu }) {
  return (
    <>
      <tr
        className={`cb-row ${expanded ? 'cb-row--expanded' : ''}`}
        onClick={onToggle}
        onContextMenu={(e) => onContextMenu(e, channel)}
      >
        <td className="cb-cell-name">
          <span className="cb-expand-icon">{expanded ? '▼' : '▶'}</span>
          {channel.name}
        </td>
        <td>{getProperty(channel, 'iocName')}</td>
        <td>{getProperty(channel, 'devtype')}</td>
        <td>{getProperty(channel, 'devgroup')}</td>
        <td>{getProperty(channel, 'zone')}</td>
        <td>{getProperty(channel, 'host')}</td>
        <td>
          <span className={`cb-protocol cb-protocol--${getProperty(channel, 'pvProtocol') || 'ca'}`}>
            {getProperty(channel, 'pvProtocol') || 'ca'}
          </span>
        </td>
        <td>{getProperty(channel, 'ioc_version')}</td>
      </tr>
      {expanded && (
        <tr className="cb-detail-row">
          <td colSpan={8}>
            <ChannelDetail channel={channel} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Expanded detail for a channel — all properties and tags.
 */
function ChannelDetail({ channel }) {
  return (
    <div className="cb-detail">
      <div className="cb-detail-section">
        <h4>Properties</h4>
        <div className="cb-detail-grid">
          {(channel.properties || []).map(p => (
            <div key={p.name} className="cb-detail-prop">
              <span className="cb-detail-key">{p.name}</span>
              <span className="cb-detail-value">{p.value || '—'}</span>
            </div>
          ))}
          {(!channel.properties || channel.properties.length === 0) && (
            <span className="cb-detail-empty">No properties</span>
          )}
        </div>
      </div>
      <div className="cb-detail-section">
        <h4>Tags</h4>
        <div className="cb-detail-tags">
          {(channel.tags || []).map(t => (
            <span key={t.name} className="cb-tag">{t.name}</span>
          ))}
          {(!channel.tags || channel.tags.length === 0) && (
            <span className="cb-detail-empty">No tags</span>
          )}
        </div>
      </div>
      <div className="cb-detail-section">
        <span className="cb-detail-owner">Owner: {channel.owner}</span>
      </div>
    </div>
  );
}
