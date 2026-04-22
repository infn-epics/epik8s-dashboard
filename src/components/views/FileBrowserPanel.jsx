import { useState, useEffect, useRef, useCallback } from 'react';
import { listFiles, fileContentUrl, fileArchiveUrl } from '../../services/k8sApi.js';

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
        // Dynamically import utif so it's only loaded when needed
        const UTIF = (await import('utif')).default;
        const ifds = UTIF.decode(buf);
        UTIF.decodeImages(buf, ifds);
        const ifd = ifds[0];
        const rgba = UTIF.toRGBA8(ifd);
        const w = ifd.width, h = ifd.height;
        setDims(`${w} × ${h}`);

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

  const downloadUrl = fileContentUrl(filePath, true);

  return (
    <div className="fb-tiff-overlay" onClick={onClose}>
      <div className="fb-tiff-modal" onClick={e => e.stopPropagation()}>
        <div className="fb-tiff-header">
          <span className="fb-tiff-title">{fileName}</span>
          {dims && <span className="fb-tiff-dims">{dims} px</span>}
          <div className="fb-tiff-actions">
            {downloadUrl && (
              <a
                href={downloadUrl}
                download={fileName}
                className="toolbar-btn toolbar-btn--small"
                onClick={e => {
                  // Add auth header by fetching as blob then clicking
                  if (token) {
                    e.preventDefault();
                    const headers = { Authorization: `Bearer ${token}` };
                    fetch(fileContentUrl(filePath, true), { headers })
                      .then(r => r.blob())
                      .then(blob => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = fileName;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
                      });
                  }
                }}
              >
                ⬇ Download
              </a>
            )}
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

// ─── File Browser Panel ──────────────────────────────────────────────────

export default function FileBrowserPanel({ initialPath, token, onClose }) {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [inputPath, setInputPath] = useState(initialPath || '');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tiffPreview, setTiffPreview] = useState(null); // { path, name }

  const navigate = useCallback((path) => {
    const p = path.replace(/\/$/, '') || '/';
    setCurrentPath(p);
    setInputPath(p);
  }, []);

  useEffect(() => {
    if (!currentPath) return;
    setLoading(true);
    setError(null);
    setEntries([]);
    listFiles(currentPath, token)
      .then(data => {
        setEntries(data.entries || []);
        setCurrentPath(data.path);
        setInputPath(data.path);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [currentPath, token]);

  const goUp = () => {
    const parts = currentPath.replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      navigate('/' + parts.join('/'));
    }
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
      .catch(err => console.error('Download failed:', err));
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

  return (
    <>
      <div className="fb-overlay" onClick={onClose}>
        <div className="fb-panel" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="fb-header">
            <span className="fb-title">📁 File Browser</span>
            <button className="toolbar-btn toolbar-btn--small" onClick={onClose}>✕</button>
          </div>

          {/* Navigation bar */}
          <div className="fb-navbar">
            <button className="toolbar-btn toolbar-btn--small" onClick={goUp} title="Go up">↑ Up</button>
            <input
              className="fb-path-input"
              value={inputPath}
              onChange={e => setInputPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && navigate(inputPath)}
              placeholder="/nfs/data/…"
            />
            <button className="toolbar-btn toolbar-btn--small" onClick={() => navigate(inputPath)}>Go</button>
            <button
              className="toolbar-btn toolbar-btn--small"
              onClick={downloadArchive}
              disabled={loading || entries.length === 0}
              title="Download entire directory as tar.gz"
            >
              ⬇ Archive
            </button>
          </div>

          {/* File list */}
          <div className="fb-body">
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
                          title={entry.name}
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
                                title="Preview"
                                onClick={() => setTiffPreview({ path: entry.path, name: entry.name })}
                              >
                                👁
                              </button>
                            )}
                            <button
                              className="toolbar-btn toolbar-btn--small"
                              title="Download"
                              onClick={() => downloadFile(entry)}
                            >
                              ⬇
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {tiffPreview && (
        <TiffViewer
          filePath={tiffPreview.path}
          fileName={tiffPreview.name}
          token={token}
          onClose={() => setTiffPreview(null)}
        />
      )}
    </>
  );
}
