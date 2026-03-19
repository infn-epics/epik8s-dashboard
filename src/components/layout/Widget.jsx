import { useState, forwardRef } from 'react';

/**
 * Widget - Generic base container for dashboard widgets.
 *
 * Features:
 *  - drag handle
 *  - collapse/expand
 *  - show/hide
 *  - detail modal
 *
 * Props:
 *  - title: widget title
 *  - subtitle: optional subtitle
 *  - icon: optional icon/emoji
 *  - status: 'ok' | 'warning' | 'error' | 'disconnected'
 *  - children: widget content
 *  - detailContent: optional expanded detail panel content
 *  - onHide: callback to hide widget
 *  - className: extra CSS classes
 */
const Widget = forwardRef(function Widget(
  { title, subtitle, icon, status, children, detailContent, onHide, className, style, ...rest },
  ref,
) {
  const [collapsed, setCollapsed] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const statusClass = status ? `widget--${status}` : '';

  return (
    <div
      ref={ref}
      className={`widget ${statusClass} ${collapsed ? 'widget--collapsed' : ''} ${className || ''}`}
      style={style}
      {...rest}
    >
      {/* Header with drag handle */}
      <div className="widget-header widget-drag-handle">
        <div className="widget-title-area">
          {icon && <span className="widget-icon">{icon}</span>}
          <span className="widget-title">{title}</span>
          {subtitle && <span className="widget-subtitle">{subtitle}</span>}
        </div>
        <div className="widget-actions">
          {status && <span className={`widget-status-dot widget-status-dot--${status}`} />}
          {detailContent && (
            <button
              className="widget-btn"
              onClick={() => setShowDetail(true)}
              title="Detail view"
            >
              ⤢
            </button>
          )}
          <button
            className="widget-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▼' : '▲'}
          </button>
          {onHide && (
            <button className="widget-btn" onClick={onHide} title="Hide widget">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {!collapsed && <div className="widget-body">{children}</div>}

      {/* Detail Modal */}
      {showDetail && (
        <div className="widget-modal-overlay" onClick={() => setShowDetail(false)}>
          <div className="widget-modal" onClick={(e) => e.stopPropagation()}>
            <div className="widget-modal-header">
              <span className="widget-title">
                {icon} {title}
              </span>
              <button className="widget-btn" onClick={() => setShowDetail(false)}>
                ✕
              </button>
            </div>
            <div className="widget-modal-body">{detailContent || children}</div>
          </div>
        </div>
      )}
    </div>
  );
});

export default Widget;
