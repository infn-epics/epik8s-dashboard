/**
 * JobContextMenu - Right-click context menu for job/plugin items
 * 
 * Props:
 *   - item: { name, type, status } - The job/plugin to operate on
 *   - x, y: number - Cursor position
 *   - onViewDetails: (name) => void - Callback to view details
 *   - onDeploy: (name) => void - Callback to deploy/load (for available plugins)
 *   - onRestart: (name) => void - Callback to restart (for loaded plugins)
 *   - onRun: (name) => void - Callback to run (for jobs/tasks)
 *   - onRemove: (name) => void - Callback to remove
 *   - onClose: () => void - Callback when menu closes
 */

import React, { useEffect, useRef } from 'react';
import './JobContextMenu.css';

export default function JobContextMenu({
  item,
  x,
  y,
  onViewDetails,
  onDeploy,
  onRestart,
  onRun,
  onRemove,
  onClose,
}) {
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Determine what actions are available based on status
  const isAvailable = item.status === 'available';
  const isLoaded = item.status === 'loaded' || item.running;
  const isRunnable = item.type === 'job' || item.type === 'task';
  const canDeploy = isAvailable;
  const canRestart = isLoaded;

  return (
    <div
      ref={menuRef}
      className="job-context-menu"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <div
        className="context-menu-item"
        onClick={() => {
          onViewDetails(item.name);
          onClose();
        }}
      >
        View Details
      </div>

      {canDeploy && onDeploy && (
        <div
          className="context-menu-item context-menu-item--action"
          onClick={() => {
            onDeploy(item.name);
            onClose();
          }}
        >
          Deploy
        </div>
      )}

      {canRestart && onRestart && (
        <div
          className="context-menu-item context-menu-item--action"
          onClick={() => {
            onRestart(item.name);
            onClose();
          }}
        >
          Restart
        </div>
      )}

      {isRunnable && isLoaded && onRun && (
        <div
          className="context-menu-item"
          onClick={() => {
            onRun(item.name);
            onClose();
          }}
        >
          Run
        </div>
      )}

      <div className="context-menu-separator" />

      <div
        className="context-menu-item context-menu-item--danger"
        onClick={() => {
          onRemove(item.name);
          onClose();
        }}
      >
        Remove
      </div>
    </div>
  );
}
