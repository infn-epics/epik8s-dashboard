import { useState } from 'react';
import {
  getChildren, getSaveAndRestoreUrl, getSnapshotItems, searchNodes, snapshotToMagnetRows,
} from '../../../services/saveAndRestoreApi.js';

const NODE_ICON = { FOLDER: '📁', CONFIGURATION: '🗂', SNAPSHOT: '📸', COMPOSITE_SNAPSHOT: '🗃' };

function formatDate(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString(); } catch { return ''; }
}

/**
 * Read-only browser of a Phoebus save-and-restore tree: search, drill into a
 * folder or configuration, and load a snapshot's values as magnet rows.
 *
 * save-and-restore's write endpoints need a login this client does not
 * perform, so this only reads: browsing and loading an existing snapshot.
 */
export default function SaveAndRestoreBrowser({ onLoad, onClose }) {
  const url = getSaveAndRestoreUrl();
  const [query, setQuery] = useState('');
  const [path, setPath] = useState([]); // [{ id, name }], root = []
  const [items, setItems] = useState(null); // null = nothing searched/opened yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runSearch = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError('');
    try {
      setPath([]);
      setItems(await searchNodes(q));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const openFolder = async (node) => {
    setLoading(true);
    setError('');
    try {
      const children = await getChildren(node.uniqueId);
      setPath((p) => [...p, { id: node.uniqueId, name: node.name }]);
      setItems(children);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const goTo = async (index) => {
    // index === -1 -> back to the search results
    if (index < 0) {
      setLoading(true);
      setError('');
      try {
        setPath([]);
        setItems(await searchNodes(query.trim() || '*'));
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setError('');
    try {
      const target = path[index];
      const children = await getChildren(target.id);
      setPath(path.slice(0, index + 1));
      setItems(children);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const openSnapshot = async (node) => {
    setLoading(true);
    setError('');
    try {
      const items2 = await getSnapshotItems(node.uniqueId);
      const { rows, skipped } = snapshotToMagnetRows(items2);
      if (!rows.length) {
        setError(`"${node.name}" has no CURRENT_SP/STATE_SP values to load.`);
        return;
      }
      const label = [...path.map((p) => p.name), node.name].join(' / ');
      onLoad(rows, skipped, label);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const click = (node) => {
    if (node.nodeType === 'FOLDER' || node.nodeType === 'CONFIGURATION') openFolder(node);
    else if (node.nodeType === 'SNAPSHOT') openSnapshot(node);
    // COMPOSITE_SNAPSHOT items live behind a different endpoint shape - not supported here.
  };

  if (!url) {
    return (
      <div className="sar-browser">
        <p className="mag-proc-empty">save-and-restore is not configured for this beamline.</p>
        <button type="button" className="mag-proc-btn" onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <div className="sar-browser">
      <div className="sar-browser-head">
        <form className="mag-proc-toolbar" onSubmit={runSearch} style={{ flex: 1 }}>
          <input
            className="mag-proc-input"
            style={{ flex: 1, minWidth: 160 }}
            type="search"
            placeholder="Search save-and-restore (name or *)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button type="submit" className="mag-proc-btn">Search</button>
        </form>
        <button type="button" className="mag-proc-btn" onClick={onClose}>Close</button>
      </div>

      {path.length > 0 && (
        <div className="sar-breadcrumb">
          <button type="button" className="sar-crumb" onClick={() => goTo(-1)}>Search results</button>
          {path.map((p, i) => (
            <span key={p.id}>
              <span className="sar-crumb-sep">/</span>
              <button type="button" className="sar-crumb" onClick={() => goTo(i)}>{p.name}</button>
            </span>
          ))}
        </div>
      )}

      {error && <div className="mag-proc-status mag-proc-status--error">{error}</div>}
      {loading && <div className="mag-proc-status mag-proc-status--info">Loading...</div>}

      {!loading && items !== null && (
        items.length === 0 ? (
          <p className="mag-proc-empty">Nothing here.</p>
        ) : (
          <ul className="sar-node-list">
            {items.map((node) => (
              <li key={node.uniqueId}>
                <button
                  type="button"
                  className="sar-node"
                  disabled={node.nodeType === 'COMPOSITE_SNAPSHOT'}
                  onClick={() => click(node)}
                  title={node.nodeType === 'COMPOSITE_SNAPSHOT' ? 'Composite snapshots are not supported here' : node.description || ''}
                >
                  <span className="sar-node-icon">{NODE_ICON[node.nodeType] || '•'}</span>
                  <span className="sar-node-name">{node.name}</span>
                  <span className="sar-node-meta">{node.userName} · {formatDate(node.lastModified)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      {!loading && items === null && (
        <p className="mag-proc-empty">Search for a folder, configuration or snapshot name (or "*" for everything).</p>
      )}
    </div>
  );
}
