import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { listFiles, fileContentUrl, fileArchiveUrl, buildBackendUrl, setBackendUrl, getBackendUrl } from '../../services/k8sApi.js';

// ─── LocalStorage key for persisted file browser root ───────────────────
const LS_FILES_ROOT = 'epik8s-files-root';
const DEFAULT_FILES_ROOT = '/nfs';

function loadFilesRoot() {
  try { return localStorage.getItem(LS_FILES_ROOT) || DEFAULT_FILES_ROOT; } catch { return DEFAULT_FILES_ROOT; }
}
function saveFilesRoot(root) {
  try { localStorage.setItem(LS_FILES_ROOT, root); } catch { /* ignore */ }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function isTiff(name) {
  return /\.(tiff?)$/i.test(name);
}

// ─── Breadcrumb ──────────────────────────────────────────────────────────

function Breadcrumb({ path, root, onNavigate }) {
  // Build segments relative to root (or absolute if path is outside root)
  const parts = path.split('/').filter(Boolean);
  const rootParts = root.replace(/^\//, '').split('/').filter(Boolean);
  return (
    <div className="fb-breadcrumb">
      {parts.map((seg, idx) => {
        const segPath = '/' + parts.slice(0, idx + 1).join('/');
        const isLast = idx === parts.length - 1;
        // Only show root portion as a home icon
        const isRootSeg = idx < rootParts.length;
        return (
          <span key={segPath} className="fb-breadcrumb-item">
            {idx > 0 && <span className="fb-breadcrumb-sep">/</span>}
            {isLast ? (
              <span className="fb-breadcrumb-current">{isRootSeg && idx === rootParts.length - 1 ? '🏠 ' : ''}{seg}</span>
            ) : (
              <button className="fb-breadcrumb-btn" onClick={() => onNavigate(segPath)}>
                {isRootSeg && idx === rootParts.length - 1 ? '🏠 ' : ''}{seg}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

// ─── TIFF Viewer ─────────────────────────────────────────────────────────

function TiffViewer({ filePath, fileName, token, onClose }) {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dims, setDims] = useState('');

  useEffect(() => {
    if (!filePath) return;
    setLoading(true);
    setError(null);

    const url = fileContentUrl(filePath);
    if (!url) { setError('Backend URL not configured'); setLoading(false); return; }

    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    fetch(url, { headers })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(async buf => {
        const UTIF = (await import('utif')).default;
        const ifds = UTIF.decode(buf);
        UTIF.decodeImages(buf, ifds);
        const ifd = ifds[0];
        const rgba = UTIF.toRGBA8(ifd);
        const w = ifd.width, h = ifd.height;
        setDims(`${w} × ${h} px`);
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(w, h);
        imgData.data.set(new Uint8ClampedArray(rgba));
        ctx.putImageData(imgData, 0, 0);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [filePath, token]);

  const handleDownload = () => {
    const url = fileContentUrl(filePath, true);
    if (!url) return;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(url, { headers })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      });
  };

  return (
    <div className="fb-tiff-overlay" onClick={onClose}>
      <div className="fb-tiff-modal" onClick={e => e.stopPropagation()}>
        <div className="fb-tiff-header">
          <span className="fb-tiff-title">{fileName}</span>
          {dims && <span className="fb-tiff-dims">{dims}</span>}
          <div className="fb-tiff-actions">
            <button className="toolbar-btn toolbar-btn--small" onClick={handleDownload}>⬇ Download</button>
            <button className="toolbar-btn toolbar-btn--small" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div className="fb-tiff-body">
          {loading && <div className="fb-status">Loading TIFF…</div>}
          {error && <div className="fb-status fb-status--error">Error: {error}</div>}
          <canvas
            ref={canvasRef}
            className="fb-tiff-canvas"
            style={{ display: loading || error ? 'none' : 'block' }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main View ───────────────────────────────────────────────────────────

export default function OpsFilesView() {
  const { token } = useAuth();
  const { config } = useApp();

  // Ensure backend URL is initialised (same pattern as K8sView)
  useEffect(() => {
    if (!getBackendUrl() && config) {
      const url = buildBackendUrl(config);
      if (url) setBackendUrl(url);
    }
  }, [config]);

  // Persistent root — editable via Settings row
  const [filesRoot, setFilesRoot] = useState(loadFilesRoot);
  const [rootInput, setRootInput] = useState(loadFilesRoot);
  const [editingRoot, setEditingRoot] = useState(false);

  // Current directory
  const [currentPath, setCurrentPath] = useState(() => loadFilesRoot());
  const [pathInput, setPathInput] = useState(() => loadFilesRoot());

  // Directory contents
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // TIFF preview
  const [tiffPreview, setTiffPreview] = useState(null); // { path, name }

  const navigate = useCallback((path) => {
    const p = path.replace(/\/$/, '') || filesRoot;
    setCurrentPath(p);
    setPathInput(p);
  }, [filesRoot]);

  // Load directory listing whenever currentPath changes
  useEffect(() => {
    if (!currentPath) return;
    setLoading(true);
    setError(null);
    setEntries([]);
    listFiles(currentPath, token)
      .then(data => {
        setEntries(data.entries || []);
        setCurrentPath(data.path);
        setPathInput(data.path);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [currentPath, token]);

  const goUp = () => {
    const parts = currentPath.replace(/\/$/, '').split('/').filter(Boolean);
    // Don't go above the configured root
    const rootParts = filesRoot.replace(/^\//, '').split('/').filter(Boolean);
    if (parts.length > rootParts.length) {
      parts.pop();
      navigate('/' + parts.join('/'));
    }
  };

  const handleApplyRoot = () => {
    const r = rootInput.trim().replace(/\/$/, '') || '/nfs';
    setFilesRoot(r);
    saveFilesRoot(r);
    setEditingRoot(false);
    navigate(r);
  };

  const downloadFile = (entry) => {
    const url = fileContentUrl(entry.path, true);
    if (!url) return;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(url, { headers })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = entry.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      })
      .catch(err => setError(`Download failed: ${err.message}`));
  };

  const downloadArchive = () => {
    const url = fileArchiveUrl(currentPath);
    if (!url) return;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(url, { headers })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then(blob => {
        const dirName = currentPath.split('/').filter(Boolean).pop() || 'archive';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${dirName}.tar.gz`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      })
      .catch(err => setError(`Archive failed: ${err.message}`));
  };

  const handleEntryClick = (entry) => {
    if (entry.isDir) {
      navigate(entry.path);
    } else if (isTiff(entry.name)) {
      setTiffPreview({ path: entry.path, name: entry.name });
    } else {
      downloadFile(entry);
    }
  };

  const atRoot = (() => {
    const cp = currentPath.replace(/\/$/, '');
    const rp = filesRoot.replace(/\/$/, '');
    return cp === rp || !cp.startsWith(rp);
  })();

  return (
    <div className="ops-files-view">
      {/* Top toolbar */}
      <div className="view-toolbar">
        <span className="view-toolbar-title">📁 File Browser</span>
        <div className="toolbar-controls">
          <div className="ops-files-root-row">
            <span className="ops-files-root-label">Root:</span>
            {editingRoot ? (
              <>
                <input
                  className="camera-save-input ops-files-root-input"
                  value={rootInput}
                  onChange={e => setRootInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleApplyRoot()}
                  placeholder="/nfs"
                  autoFocus
                />
                <button className="toolbar-btn toolbar-btn--small" onClick={handleApplyRoot}>Apply</button>
                <button className="toolbar-btn toolbar-btn--small" onClick={() => { setEditingRoot(false); setRootInput(filesRoot); }}>Cancel</button>
              </>
            ) : (
              <>
                <code className="ops-files-root-value">{filesRoot}</code>
                <button className="toolbar-btn toolbar-btn--small" onClick={() => setEditingRoot(true)}>Edit</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Navigation bar */}
      <div className="ops-files-navbar">
        <button
          className="toolbar-btn toolbar-btn--small"
          onClick={goUp}
          disabled={atRoot}
          title="Go up one level"
        >
          ↑ Up
        </button>
        <button
          className="toolbar-btn toolbar-btn--small"
          onClick={() => navigate(filesRoot)}
          title="Go to root"
        >
          🏠
        </button>
        <input
          className="fb-path-input ops-files-path-input"
          value={pathInput}
          onChange={e => setPathInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && navigate(pathInput)}
          placeholder={filesRoot}
        />
        <button className="toolbar-btn toolbar-btn--small" onClick={() => navigate(pathInput)}>Go</button>
        <button
          className="toolbar-btn toolbar-btn--small"
          onClick={() => navigate(currentPath)}
          title="Refresh"
        >
          ↻
        </button>
        <button
          className="toolbar-btn"
          onClick={downloadArchive}
          disabled={loading || entries.length === 0}
          title="Download entire directory as tar.gz"
        >
          ⬇ Download tar.gz
        </button>
      </div>

      {/* Breadcrumb */}
      <Breadcrumb path={currentPath} root={filesRoot} onNavigate={navigate} />

      {/* File table */}
      <div className="ops-files-body">
        {loading && <div className="fb-status">Loading…</div>}
        {error && <div className="fb-status fb-status--error">{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <div className="fb-status">Directory is empty</div>
        )}
        {!loading && entries.length > 0 && (
          <table className="fb-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.path} className={entry.isDir ? 'fb-row fb-row--dir' : 'fb-row'}>
                  <td>
                    <span
                      className="fb-entry-name"
                      onClick={() => handleEntryClick(entry)}
                      title={entry.path}
                    >
                      {entry.isDir ? '📁 ' : isTiff(entry.name) ? '🖼 ' : '📄 '}
                      {entry.name}
                    </span>
                  </td>
                  <td className="fb-cell-size">{entry.isDir ? '' : formatBytes(entry.size)}</td>
                  <td className="fb-cell-date">{formatDate(entry.mtime)}</td>
                  <td className="fb-cell-actions">
                    {!entry.isDir && (
                      <>
                        {isTiff(entry.name) && (
                          <button
                            className="toolbar-btn toolbar-btn--small"
                            title="Preview TIFF"
                            onClick={() => setTiffPreview({ path: entry.path, name: entry.name })}
                          >
                            👁
                          </button>
                        )}
                        <button
                          className="toolbar-btn toolbar-btn--small"
                          title="Download file"
                          onClick={() => downloadFile(entry)}
                        >
                          ⬇
                        </button>
                      </>
                    )}
                    {entry.isDir && (
                      <button
                        className="toolbar-btn toolbar-btn--small"
                        title="Download as tar.gz"
                        onClick={() => {
                          const url = fileArchiveUrl(entry.path);
                          if (!url) return;
                          const headers = token ? { Authorization: `Bearer ${token}` } : {};
                          fetch(url, { headers }).then(r => r.blob()).then(blob => {
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = `${entry.name}.tar.gz`;
                            a.click();
                            setTimeout(() => URL.revokeObjectURL(a.href), 30000);
                          }).catch(err => setError(`Archive failed: ${err.message}`));
                        }}
                      >
                        ⬇ tar.gz
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {tiffPreview && (
        <TiffViewer
          filePath={tiffPreview.path}
          fileName={tiffPreview.name}
          token={token}
          onClose={() => setTiffPreview(null)}
        />
      )}
    </div>
  );
}
