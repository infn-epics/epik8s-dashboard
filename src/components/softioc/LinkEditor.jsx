/**
 * LinkEditor — Visual editor for wired input/output link connections.
 *
 * Shows a two-column layout:
 *  Left:  External PVs (link targets)
 *  Right: Internal softioc PVs
 *  Lines connecting linked pairs
 *
 * Users can:
 *  - View all link connections
 *  - Edit link PV names inline
 *  - Add/remove links
 *  - See link direction (← input, → output)
 */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useSoftIOC } from '../../context/SoftIOCContext.jsx';

export default function LinkEditor({ taskName, onClose }) {
  const { taskConfigs, updateLink } = useSoftIOC();
  const config = taskConfigs[taskName];
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [hoveredLink, setHoveredLink] = useState(null);

  const inputs = config?.inputs || {};
  const outputs = config?.outputs || {};

  // Collect all linked items
  const linkedItems = useMemo(() => {
    const items = [];
    for (const [key, spec] of Object.entries(inputs)) {
      if (spec.link) {
        items.push({ key, link: spec.link, direction: 'input', type: spec.type, trigger: spec.trigger });
      }
    }
    for (const [key, spec] of Object.entries(outputs)) {
      if (spec.link) {
        items.push({ key, link: spec.link, direction: 'output', type: spec.type });
      }
    }
    return items;
  }, [inputs, outputs]);

  // Collect unlinked items
  const unlinkedInputs = useMemo(
    () => Object.entries(inputs).filter(([, spec]) => !spec.link).map(([k]) => k),
    [inputs]
  );
  const unlinkedOutputs = useMemo(
    () => Object.entries(outputs).filter(([, spec]) => !spec.link).map(([k]) => k),
    [outputs]
  );

  // Draw SVG connection lines
  const rowRefs = useRef({});
  const [lines, setLines] = useState([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const newLines = [];
    for (const item of linkedItems) {
      const leftEl = rowRefs.current[`ext-${item.key}`];
      const rightEl = rowRefs.current[`int-${item.key}`];
      if (leftEl && rightEl) {
        const cRect = container.getBoundingClientRect();
        const lRect = leftEl.getBoundingClientRect();
        const rRect = rightEl.getBoundingClientRect();
        newLines.push({
          key: item.key,
          direction: item.direction,
          x1: lRect.right - cRect.left,
          y1: lRect.top + lRect.height / 2 - cRect.top,
          x2: rRect.left - cRect.left,
          y2: rRect.top + rRect.height / 2 - cRect.top,
        });
      }
    }
    setLines(newLines);
  }, [linkedItems, config]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLinkChange = useCallback((pvKey, direction, newLink) => {
    updateLink(taskName, pvKey, direction, newLink);
  }, [taskName, updateLink]);

  if (!config) {
    return (
      <div className="sioc-link-editor">
        <div className="sioc-link-header">
          <h3>Link Editor — {taskName}</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <p className="sioc-empty">No config loaded for this task. Import the config.yaml first.</p>
      </div>
    );
  }

  return (
    <div className="sioc-link-editor">
      <div className="sioc-link-header">
        <h3>🔗 Link Editor — {taskName}</h3>
        <button className="btn btn-ghost" onClick={onClose}>✕</button>
      </div>

      <div className="sioc-link-container" ref={containerRef}>
        {/* SVG overlay for connection lines */}
        <svg className="sioc-link-svg">
          {lines.map((line) => (
            <g key={line.key}>
              <line
                x1={line.x1} y1={line.y1}
                x2={line.x2} y2={line.y2}
                className={`sioc-link-line ${line.direction} ${hoveredLink === line.key ? 'hovered' : ''}`}
              />
              {/* Arrow */}
              <circle
                cx={line.direction === 'input' ? line.x2 - 4 : line.x1 + 4}
                cy={line.direction === 'input' ? line.y2 : line.y1}
                r={3}
                className={`sioc-link-dot ${line.direction}`}
              />
            </g>
          ))}
        </svg>

        {/* Two columns */}
        <div className="sioc-link-columns">
          {/* External PVs (left) */}
          <div className="sioc-link-col sioc-link-external">
            <h4>External PVs</h4>
            {linkedItems.map((item) => (
              <div key={item.key}
                className={`sioc-link-row ${hoveredLink === item.key ? 'hovered' : ''}`}
                ref={(el) => { rowRefs.current[`ext-${item.key}`] = el; }}
                onMouseEnter={() => setHoveredLink(item.key)}
                onMouseLeave={() => setHoveredLink(null)}>
                <span className={`sioc-link-dir ${item.direction}`}>
                  {item.direction === 'input' ? '←' : '→'}
                </span>
                <input
                  type="text"
                  value={item.link}
                  className="sioc-link-input"
                  onChange={(e) => handleLinkChange(item.key, item.direction, e.target.value)}
                  placeholder="External PV name"
                />
                {item.trigger && <span className="sioc-trigger-badge">⚡</span>}
              </div>
            ))}
          </div>

          {/* Gap for lines */}
          <div className="sioc-link-gap" />

          {/* Internal PVs (right) */}
          <div className="sioc-link-col sioc-link-internal">
            <h4>SoftIOC PVs</h4>
            {linkedItems.map((item) => (
              <div key={item.key}
                className={`sioc-link-row ${hoveredLink === item.key ? 'hovered' : ''}`}
                ref={(el) => { rowRefs.current[`int-${item.key}`] = el; }}
                onMouseEnter={() => setHoveredLink(item.key)}
                onMouseLeave={() => setHoveredLink(null)}>
                <span className="sioc-link-pvname">{item.key}</span>
                <span className="sioc-link-type">{item.type}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Unlinked items */}
        {(unlinkedInputs.length > 0 || unlinkedOutputs.length > 0) && (
          <div className="sioc-unlinked-section">
            <h4>Unlinked PVs</h4>
            <div className="sioc-unlinked-list">
              {unlinkedInputs.map((k) => (
                <div key={k} className="sioc-unlinked-item">
                  <span className="sioc-link-dir input">IN</span>
                  <span>{k}</span>
                  <button className="btn btn-xs btn-ghost"
                    onClick={() => {
                      const link = prompt(`External PV to link to ${k}:`);
                      if (link) handleLinkChange(k, 'input', link);
                    }}>+ link</button>
                </div>
              ))}
              {unlinkedOutputs.map((k) => (
                <div key={k} className="sioc-unlinked-item">
                  <span className="sioc-link-dir output">OUT</span>
                  <span>{k}</span>
                  <button className="btn btn-xs btn-ghost"
                    onClick={() => {
                      const link = prompt(`External PV to link ${k} to:`);
                      if (link) handleLinkChange(k, 'output', link);
                    }}>+ link</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
