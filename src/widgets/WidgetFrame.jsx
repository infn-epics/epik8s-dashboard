import { useState, useCallback, useMemo, forwardRef, cloneElement, Children } from 'react';
import { createPortal } from 'react-dom';
import { getWidgetType } from './registry.js';
import { usePv } from '../hooks/usePv.js';
import { useAuth } from '../context/AuthContext.jsx';
import CreateTicketModal from '../components/common/CreateTicketModal.jsx';
import ChannelInfoDialog from '../components/common/ChannelInfoDialog.jsx';

/**
 * WidgetFrame — container for every widget in the dashboard grid.
 *
 * Provides: drag handle, essential/detail toggle (device widgets)
 * or collapse/expand (non-device), detail modal, hide,
 * configure panel toggle, connection LED, alarm border,
 * right-click context menu with ticket creation.
 */
const WidgetFrame = forwardRef(function WidgetFrame(
  { widget, editMode, onRemove, onConfigure, onUpdateConfig, client, children, className, style, ...rest },
  ref,
) {
  const [collapsed, setCollapsed] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [showChannelInfo, setShowChannelInfo] = useState(false);
  const [localViewMode, setLocalViewMode] = useState(widget.config?.viewMode || 'essential');
  const [contextMenu, setContextMenu] = useState(null);
  const { isAuthenticated } = useAuth();

  // Derived values — must be declared before callbacks that use them
  const typeDef = getWidgetType(widget.type);
  const title = widget.config?.title || typeDef?.name || widget.type;
  const subtitle = widget.config?.subtitle || '';
  const icon = typeDef?.icon || '🔧';

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = () => setContextMenu(null);

  const handleSnapshot = useCallback(() => {
    // Capture the widget DOM element as an image for ticket attachment
    const el = ref?.current;
    if (!el) return;
    import('html2canvas').then(({ default: html2canvas }) => {
      html2canvas(el, { backgroundColor: '#1e1e2e', scale: 2 }).then(canvas => {
        canvas.toBlob(blob => {
          if (blob) {
            const file = new File([blob], `${title}-snapshot.png`, { type: 'image/png' });
            setShowTicket({ snapshot: file });
          }
        });
      });
    }).catch(() => {
      // html2canvas not installed — open ticket without snapshot
      setShowTicket(true);
    });
    setContextMenu(null);
  }, [ref, title]);

  // Does this widget type support essential/detail viewMode?
  const hasViewMode = typeDef?.properties?.some(p => p.key === 'viewMode');
  const currentMode = onUpdateConfig
    ? (widget.config?.viewMode || 'essential')
    : localViewMode;

  const toggleViewMode = () => {
    const newMode = currentMode === 'essential' ? 'detail' : 'essential';
    if (onUpdateConfig) {
      onUpdateConfig(widget.id, { ...widget.config, viewMode: newMode });
    } else {
      setLocalViewMode(newMode);
    }
  };

  // Build effective config with current viewMode
  const effectiveConfig = hasViewMode
    ? { ...widget.config, viewMode: currentMode }
    : widget.config;

  // Determine the connection PV to monitor
  const connectionPv = getConnectionPv(widget, typeDef);
  const widgetPvs = useMemo(
    () => extractWidgetPvs(widget, typeDef, connectionPv),
    [widget, typeDef, connectionPv],
  );
  const deviceInfo = useMemo(() => ({
    name: widget.config?.title || title,
    iocName: widget.config?.iocName || '',
    pvPrefix: widget.config?.pvPrefix || '',
    zone: widget.config?.zone || '',
    family: widget.config?.family || widget.type,
  }), [widget, title]);
  const widgetInfo = useMemo(() => ({
    id: widget.id,
    type: widget.type,
    icon,
    name: title,
    subtitle,
    category: typeDef?.category || '',
    dataSource: typeDef?.dataSource || '',
    config: widget.config || {},
  }), [widget, icon, title, subtitle, typeDef]);
  const pvMsg = usePv(client, connectionPv);

  // Connection state: null = no PV, 'connected' | 'disconnected'
  const hasPv = !!connectionPv;
  const isConnected = hasPv && pvMsg != null;
  const severity = pvMsg?.severity || 'NONE';

  // Alarm border class
  const alarmClass =
    severity === 'MAJOR' ? 'widget--alarm-major' :
    severity === 'MINOR' ? 'widget--alarm-minor' :
    severity === 'INVALID' ? 'widget--alarm-invalid' : '';

  // LED color
  const ledClass = !hasPv ? '' :
    isConnected ? 'widget-led--connected' : 'widget-led--disconnected';

  return (
    <div
      ref={ref}
      className={`widget ${alarmClass} ${collapsed ? 'widget--collapsed' : ''} ${className || ''}`}
      style={style}
      onContextMenu={handleContextMenu}
      {...rest}
    >
      {/* Header with drag handle */}
      <div className="widget-header widget-drag-handle">
        <div className="widget-title-area">
          {hasPv && <span className={`widget-led ${ledClass}`} title={isConnected ? `Connected (${connectionPv})` : `Disconnected (${connectionPv})`} />}
          <span className="widget-icon">{icon}</span>
          <span className="widget-title">{title}</span>
          {subtitle && <span className="widget-subtitle">{subtitle}</span>}
        </div>
        <div className="widget-actions">
          {isAuthenticated && (
            <button className="widget-btn" onClick={() => setShowTicket(true)} title="Create ticket">
              🎫
            </button>
          )}
          {editMode && onConfigure && (
            <button className="widget-btn" onClick={() => onConfigure(widget)} title="Configure">
              ⚙
            </button>
          )}
          <button
            className="widget-btn"
            onClick={() => setShowDetail(true)}
            title="Detail view"
          >
            ⤢
          </button>
          {hasViewMode ? (
            <button
              className={`widget-btn ${currentMode === 'detail' ? 'widget-btn--active' : ''}`}
              onClick={toggleViewMode}
              title={currentMode === 'essential' ? 'Switch to Detail' : 'Switch to Essential'}
            >
              {currentMode === 'essential' ? '◫' : '☰'}
            </button>
          ) : (
            <button
              className="widget-btn"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              {collapsed ? '▼' : '▲'}
            </button>
          )}
          {editMode && onRemove && (
            <button className="widget-btn widget-btn--danger" onClick={() => onRemove(widget.id)} title="Remove">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="widget-body">
          {Children.map(children, (child) =>
            child && typeof child === 'object'
              ? cloneElement(child, { config: effectiveConfig })
              : child
          )}
        </div>
      )}

      {/* Detail Modal — portaled to body to avoid overflow:hidden clipping */}
      {showDetail && createPortal(
        <div className="widget-modal-overlay" onClick={() => setShowDetail(false)}>
          <div className="widget-modal" onClick={(e) => e.stopPropagation()}>
            <div className="widget-modal-header">
              <span className="widget-title">{icon} {title}</span>
              <button className="widget-btn" onClick={() => setShowDetail(false)}>✕</button>
            </div>
            <div className="widget-modal-body">
              {Children.map(children, (child) =>
                child && typeof child === 'object'
                  ? cloneElement(child, { config: { ...effectiveConfig, viewMode: 'detail' } })
                  : child
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {/* Context Menu — portaled to body */}
      {contextMenu && createPortal(
        <div className="widget-context-backdrop" onClick={closeContextMenu}>
          <div
            className="bll-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            <button className="bll-context-menu-item" onClick={() => { setShowDetail(true); closeContextMenu(); }}>
              <span className="bll-context-menu-icon">⤢</span>
              <span className="bll-context-menu-label">Detail View</span>
            </button>
            {isAuthenticated && (
              <>
                <div className="bll-context-menu-sep" />
                <button className="bll-context-menu-item" onClick={() => { setShowTicket(true); closeContextMenu(); }}>
                  <span className="bll-context-menu-icon">🎫</span>
                  <span className="bll-context-menu-label">Create Ticket</span>
                </button>
                <button className="bll-context-menu-item" onClick={handleSnapshot}>
                  <span className="bll-context-menu-icon">📸</span>
                  <span className="bll-context-menu-label">Snapshot &amp; Ticket</span>
                </button>
              </>
            )}
            <>
              <div className="bll-context-menu-sep" />
              <button className="bll-context-menu-item" onClick={() => { setShowChannelInfo(true); closeContextMenu(); }}>
                <span className="bll-context-menu-icon">📡</span>
                <span className="bll-context-menu-label">Widget Info</span>
              </button>
            </>
            {editMode && onConfigure && (
              <>
                <div className="bll-context-menu-sep" />
                <button className="bll-context-menu-item" onClick={() => { onConfigure(widget); closeContextMenu(); }}>
                  <span className="bll-context-menu-icon">⚙</span>
                  <span className="bll-context-menu-label">Configure</span>
                </button>
              </>
            )}
            {editMode && onRemove && (
              <button className="bll-context-menu-item" onClick={() => { onRemove(widget.id); closeContextMenu(); }}
                style={{ color: '#f87171' }}>
                <span className="bll-context-menu-icon">🗑</span>
                <span className="bll-context-menu-label">Remove</span>
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
      {/* Ticket Modal — portaled to body */}
      {showTicket && createPortal(
        <CreateTicketModal
          onClose={() => setShowTicket(false)}
          deviceInfo={widget.config ? {
            name: widget.config.title || title,
            family: widget.config.family || widget.type,
            iocName: widget.config.iocName || '',
            pvPrefix: widget.config.pvPrefix || '',
            zone: widget.config.zone || '',
          } : null}
          initialSnapshot={showTicket?.snapshot || null}
        />,
        document.body,
      )}
      {/* Channel Info Dialog */}
      {showChannelInfo && (
        <ChannelInfoDialog
          device={deviceInfo}
          widget={widgetInfo}
          pvs={widgetPvs}
          onClose={() => setShowChannelInfo(false)}
        />
      )}
    </div>
  );
});

/**
 * Determine the PV to monitor for connection status.
 * - Single-PV widgets: use config.pv_name
 * - Device widgets: use pvPrefix + typeDef.connectionSuffix
 * - No PV configured: return null
 */
function getConnectionPv(widget, typeDef) {
  const cfg = widget.config || {};
  // Single PV widgets (pv_name)
  if (cfg.pv_name) return cfg.pv_name;
  // Device widgets (pvPrefix + suffix)
  if (cfg.pvPrefix) {
    const suffix = typeDef?.connectionSuffix ?? '';
    return cfg.pvPrefix + suffix;
  }
  return null;
}

function extractWidgetPvs(widget, typeDef, connectionPv) {
  const cfg = widget?.config || {};
  const pvSet = new Set();

  if (connectionPv) pvSet.add(connectionPv);

  // Collect explicit PV fields from config.
  for (const [key, value] of Object.entries(cfg)) {
    if (typeof value !== 'string' || !value.trim()) continue;

    if (key === 'pv_name' || key === 'pvPrefix' || key === 'evrPrefix') {
      pvSet.add(value.trim());
      continue;
    }

    if (key.toLowerCase().includes('pv')) {
      pvSet.add(value.trim());
    }
  }

  // Expand line-based PV list used by plotting/data widgets.
  if (typeof cfg.pvs === 'string' && cfg.pvs.trim()) {
    cfg.pvs
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((pv) => pvSet.add(pv));
  }

  // If this is a device widget, include the conventional prefix lookup form.
  if (cfg.pvPrefix && typeDef?.connectionSuffix !== undefined) {
    pvSet.add(`${cfg.pvPrefix}${typeDef.connectionSuffix || ''}`);
  }

  return Array.from(pvSet);
}

export default WidgetFrame;
