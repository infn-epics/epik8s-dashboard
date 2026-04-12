import { useState, useRef } from 'react';
import { useDashboard } from '../../context/DashboardContext.jsx';
import { importDashboard, exportAllDashboards } from '../../services/dashboardStorage.js';
import { generateId } from '../../models/dashboard.js';

/**
 * Sidebar — Grafana-like sidebar with dashboard list and navigation.
 *
 * Props:
 *  - collapsed: boolean
 *  - onToggle: () => void
 */
export default function Sidebar({ collapsed, onToggle }) {
  const {
    dashboards,
    activeDashboard,
    openDashboard,
    addDashboard,
    removeDashboard,
    duplicateDashboard,
    refreshList,
    updateDashboard,
  } = useDashboard();

  const [contextMenu, setContextMenu] = useState(null); // { id, x, y }
  const [renaming, setRenaming] = useState(null); // dashboard id
  const [renameValue, setRenameValue] = useState('');
  const fileRef = useRef(null);

  const handleNew = () => {
    addDashboard('New Dashboard');
  };

  const handleContextMenu = (e, id) => {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  const closeMenu = () => setContextMenu(null);

  const handleDuplicate = (id) => {
    duplicateDashboard(id);
    closeMenu();
  };

  const handleDelete = (id) => {
    removeDashboard(id);
    closeMenu();
  };

  const handleStartRename = (id, name) => {
    setRenaming(id);
    setRenameValue(name);
    closeMenu();
  };

  const handleConfirmRename = (id) => {
    if (renameValue.trim()) {
      const dash = dashboards.find((d) => d.id === id);
      if (dash) {
        updateDashboard({ ...dash, name: renameValue.trim() });
      }
    }
    setRenaming(null);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      console.info('[DashboardImport] Starting import from sidebar:', file.name);
      const dash = await importDashboard(file);
      // Assign new id to avoid conflicts
      dash.id = generateId();
      updateDashboard(dash);
      refreshList();
      openDashboard(dash.id);
      const count = Array.isArray(dash.widgets) ? dash.widgets.length : 0;
      console.info('[DashboardImport] Imported dashboard:', { name: dash.name, id: dash.id, widgets: count });
      alert(`Imported dashboard "${dash.name}" (${count} widget${count === 1 ? '' : 's'})`);
    } catch (err) {
      console.error('[DashboardImport] Import failed:', err);
      alert(`Import failed: ${err.message}`);
    }
    e.target.value = '';
  };

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed">
        <button className="sidebar-toggle" onClick={onToggle} title="Expand sidebar">
          ▶
        </button>
        <div className="sidebar-icons">
          <button className="sidebar-icon-btn" onClick={handleNew} title="New dashboard">+</button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Dashboards</span>
        <button className="sidebar-toggle" onClick={onToggle} title="Collapse sidebar">
          ◀
        </button>
      </div>

      <div className="sidebar-actions">
        <button className="sidebar-btn sidebar-btn--primary" onClick={handleNew}>
          + New Dashboard
        </button>
        <div className="sidebar-btn-group">
          <button className="sidebar-btn" onClick={() => fileRef.current?.click()} title="Import JSON">
            ⬆ Import
          </button>
          <button className="sidebar-btn" onClick={exportAllDashboards} title="Export all">
            ⬇ Export All
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
      </div>

      <div className="sidebar-list">
        {dashboards.length === 0 ? (
          <div className="sidebar-empty">
            No dashboards yet.<br />Click <strong>+ New</strong> to create one.
          </div>
        ) : (
          dashboards.map((dash) => (
            <div
              key={dash.id}
              className={`sidebar-item ${activeDashboard?.id === dash.id ? 'active' : ''}`}
              onClick={() => openDashboard(dash.id)}
              onContextMenu={(e) => handleContextMenu(e, dash.id)}
            >
              <span className="sidebar-item-icon">📊</span>
              {renaming === dash.id ? (
                <input
                  className="sidebar-rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmRename(dash.id);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={() => handleConfirmRename(dash.id)}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span className="sidebar-item-name">{dash.name}</span>
              )}
              <span className="sidebar-item-count">{dash.widgets.length}</span>
            </div>
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="context-menu-backdrop" onClick={closeMenu} />
          <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <button onClick={() => handleStartRename(contextMenu.id, dashboards.find((d) => d.id === contextMenu.id)?.name || '')}>
              ✏ Rename
            </button>
            <button onClick={() => handleDuplicate(contextMenu.id)}>
              📋 Duplicate
            </button>
            <button className="context-menu-danger" onClick={() => handleDelete(contextMenu.id)}>
              🗑 Delete
            </button>
          </div>
        </>
      )}

      <div className="sidebar-footer">
        <span className="sidebar-footer-text">
          {dashboards.length} dashboard{dashboards.length !== 1 ? 's' : ''}
        </span>
      </div>
    </aside>
  );
}
