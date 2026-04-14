/**
 * BeamlineLayout — Graphical beamline layout editor using React Flow.
 *
 * Features:
 *  - Multiple named layouts (create/save/restore/delete/navigate)
 *  - Device nodes with SVG glyphs and multi-device linking
 *  - Glyph type selector in properties modal with preview
 *  - Module grouping as true parent containers (children move with module)
 *  - Drag-and-drop glyphs into modules to auto-parent
 *  - Drawing primitives: line, rectangle, circle, arc
 *  - Drag-and-drop from palette to canvas
 *  - Right-click context menu (edit, delete, copy, cut, paste)
 *  - Multi-select with box selection + Shift+click
 *  - Keyboard shortcuts: Ctrl+C/X/V, Delete
 *  - Schematic view mode: SVG-only with connecting lines
 *  - Straight-line connections between devices
 *  - Real-time PV status coloring
 *  - View mode: click glyph → open linked device controls
 *  - View mode: click module → open all child device controls
 *  - Custom glyph icon management
 */
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useApp } from '../../context/AppContext.jsx';
import { useGitStorage } from '../../hooks/useGitStorage.js';
import { getGlyph, GLYPH_TYPES, STATUS_COLORS } from '../glyphs/DeviceGlyphs.jsx';
import { usePv } from '../../hooks/usePv.js';
import { deviceToWidgetType, getWidgetComponent } from '../../widgets/registry.js';
import { deviceToWidgetConfig } from '../../models/dashboard.js';
import WidgetFrame from '../../widgets/WidgetFrame.jsx';

// ─── Layout persistence (multi-layout) ──────────────────────────────────
const LS_LAYOUTS_KEY = 'epik8s-beamline-layouts';

function getAllLayouts(beamline) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_LAYOUTS_KEY) || '{}');
    return all[beamline] || {};
  } catch { return {}; }
}

function listLayouts(beamline) {
  const layouts = getAllLayouts(beamline);
  return Object.entries(layouts).map(([name, data]) => ({
    name,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    nodeCount: (data.nodes || []).length,
  })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function loadNamedLayout(beamline, name) {
  const layouts = getAllLayouts(beamline);
  return layouts[name] || null;
}

function saveNamedLayout(beamline, name, { nodes, edges }) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_LAYOUTS_KEY) || '{}');
    if (!all[beamline]) all[beamline] = {};
    const existing = all[beamline][name];
    all[beamline][name] = {
      nodes, edges,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    localStorage.setItem(LS_LAYOUTS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

function deleteNamedLayout(beamline, name) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_LAYOUTS_KEY) || '{}');
    if (all[beamline]) {
      delete all[beamline][name];
      localStorage.setItem(LS_LAYOUTS_KEY, JSON.stringify(all));
    }
  } catch { /* ignore */ }
}

function renameNamedLayout(beamline, oldName, newName) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_LAYOUTS_KEY) || '{}');
    if (all[beamline]?.[oldName]) {
      all[beamline][newName] = { ...all[beamline][oldName], updatedAt: Date.now() };
      delete all[beamline][oldName];
      localStorage.setItem(LS_LAYOUTS_KEY, JSON.stringify(all));
    }
  } catch { /* ignore */ }
}

// ─── Custom glyph persistence ───────────────────────────────────────────
const LS_CUSTOM_GLYPHS_KEY = 'epik8s-custom-glyphs';

let customGlyphs = [];
try { customGlyphs = JSON.parse(localStorage.getItem(LS_CUSTOM_GLYPHS_KEY) || '[]'); } catch { /* ignore */ }

function saveCustomGlyphs(glyphs) {
  customGlyphs = glyphs;
  localStorage.setItem(LS_CUSTOM_GLYPHS_KEY, JSON.stringify(glyphs));
}

// ─── Glyph type → device family mapping (for picker filtering) ──────────
const GLYPH_FAMILY_MAP = {
  quadrupole: 'mag', dipole: 'mag', corrector: 'mag', solenoid: 'mag', ps: 'mag',
  camera: 'cam',
  bpm: 'bpm',
  motor: 'mot',
  vac: 'vac', valve: 'vac', 'turbo-pump': 'vac',
  cooling: 'cool',
  io: 'io',
};

// ─── PPT-style category colors ──────────────────────────────────────────
const CATEGORY_COLORS = {
  source:      { bg: '#ff660018', border: '#ff6600' },
  accelerator: { bg: '#ff880018', border: '#ff8800' },
  magnet:      { bg: '#4488ff18', border: '#4488ff' },
  optics:      { bg: '#534AB718', border: '#534AB7' },
  diagnostic:  { bg: '#00cccc18', border: '#00cccc' },
  detector:    { bg: '#3DD68C18', border: '#3DD68C' },
  vacuum:      { bg: '#88888818', border: '#999' },
  motion:      { bg: '#ccaa0018', border: '#ccaa00' },
  infra:       { bg: '#88668818', border: '#886688' },
  beamline:    { bg: '#22c55e18', border: '#22c55e' },
};

function getCategoryForGlyph(glyphType) {
  const entry = GLYPH_TYPES.find(g => g.type === glyphType);
  if (entry) return entry.category;
  const custom = customGlyphs.find(g => g.type === glyphType);
  return custom?.category || 'infra';
}

// ─── Helper: map beamline glyphType to widget family code ──────────────
const GLYPH_TO_FAMILY = {
  camera: 'cam',
  flag: 'mot',
  bpm: 'bpm',
  bcm: 'generic',
  'vacuum-gauge': 'vac',
  'vacuum-valve': 'vac',
  solenoid: 'mag',
  corrector: 'mag',
  quadrupole: 'mag',
  dipole: 'mag',
  'rf-cavity': 'rf',
  'turbo-pump': 'generic',
  'electron-gun': 'generic',
  io: 'io',
};

// ─── Helper: resolve devices array from node data (backward compat) ─────
function resolveDevices(data) {
  if (data.devices?.length > 0) return data.devices;
  if (data.deviceId) return [{ id: data.deviceId, name: data.label, pvPrefix: data.pvPrefix, family: data.family, iocName: data.sublabel }];
  if (data.pvPrefix) return [{ id: data.id, name: data.label, pvPrefix: data.pvPrefix, family: data.family || GLYPH_TO_FAMILY[data.glyphType] || 'generic', iocName: data.sublabel }];
  return [];
}

// ─── Device Node Component ──────────────────────────────────────────────

function DeviceNode({ data }) {
  const { pvwsClient } = useApp();
  const devices = resolveDevices(data);
  const statusPv = devices[0]?.pvPrefix ? `${devices[0].pvPrefix}:STATUS` : null;
  const pvVal = usePv(pvwsClient, statusPv);

  let status = 'ok';
  if (!pvVal && statusPv) status = 'disconnected';
  else if (pvVal?.severity === 2) status = 'alarm';
  else if (pvVal?.severity === 1) status = 'warning';

  const isCustom = data.glyphType?.startsWith('custom-');
  const GlyphComp = isCustom ? null : getGlyph(data.glyphType || data.family || 'generic');
  const glyphSize = data.glyphSize || 36;
  const rotation = data.rotation || 0;
  const cat = getCategoryForGlyph(data.glyphType);
  const catColors = CATEGORY_COLORS[cat] || CATEGORY_COLORS.infra;
  const showBorder = data.showBorder !== false;

  const renderGlyph = () => {
    if (isCustom) {
      const cg = customGlyphs.find(g => g.type === data.glyphType);
      if (!cg) return <span style={{ fontSize: glyphSize * 0.5 }}>?</span>;
      const dim = status === 'disconnected' || status === 'disabled';
      const safeSvg = cg.svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on\w+\s*=/gi, '');
      return (
        <svg width={glyphSize} height={glyphSize} viewBox="0 0 48 48" fill="none"
          style={dim ? { opacity: 0.45, filter: 'grayscale(0.8)' } : undefined}
          dangerouslySetInnerHTML={{ __html: safeSvg }} />
      );
    }
    return <GlyphComp status={status} size={glyphSize} />;
  };

  return (
    <div
      className={`bll-node bll-node--${status}${!showBorder ? ' bll-node--borderless' : ''}`}
      style={{
        minWidth: showBorder ? (data.width || 80) : undefined,
        minHeight: showBorder ? (data.height || 56) : undefined,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        borderColor: showBorder ? (status === 'ok' ? catColors.border : undefined) : 'transparent',
        background: showBorder ? (status === 'ok' ? catColors.bg : undefined) : 'transparent',
      }}
      title={devices.map(d => d.name || d.pvPrefix).join(', ') || data.label}
    >
      <Handle type="target" position={Position.Left} className="bll-handle" />
      <div className="bll-node-glyph">{renderGlyph()}</div>
      <div className="bll-node-info">
        <span className="bll-node-label">{data.label}</span>
        {data.sublabel && <span className="bll-node-sublabel">{data.sublabel}</span>}
        {devices.length > 1 && <span className="bll-node-sublabel">{devices.length} devices</span>}
      </div>
      {status === 'alarm' && <span className="bll-node-alarm-badge">⚠</span>}
      <Handle type="source" position={Position.Right} className="bll-handle" />
    </div>
  );
}

// ─── Annotation Node ────────────────────────────────────────────────────

function AnnotationNode({ data }) {
  const rotation = data.rotation || 0;
  if (data.annotationType === 'beam') {
    return (
      <div className="bll-beam-segment" style={{
        width: data.width || 120, height: 6,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
      }}>
        <Handle type="target" position={Position.Left} className="bll-handle" />
        <Handle type="source" position={Position.Right} className="bll-handle" />
      </div>
    );
  }
  return (
    <div className="bll-annotation" style={{
      fontSize: data.fontSize || 14,
      color: data.color || '#aaa',
      fontWeight: data.bold ? 'bold' : 'normal',
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
    }}>
      {data.label || 'Label'}
    </div>
  );
}

// ─── Group / Module Node (transparent container, optional glyph+handles) ──

function GroupNode({ data }) {
  const shape = data.shape || 'rect';
  const dashed = data.dashed !== false;
  const hasGlyph = !!data.glyphType;
  const GlyphComp = hasGlyph ? getGlyph(data.glyphType) : null;
  const glyphSize = data.glyphSize || 28;
  return (
    <div className={`bll-group${hasGlyph ? ' bll-group--device' : ''}`} style={{
      width: data.width || 300,
      height: data.height || 200,
      borderColor: data.borderColor || '#555',
      borderStyle: dashed ? 'dashed' : 'solid',
      borderRadius: shape === 'oval' ? '50%' : shape === 'rounded' ? '16px' : '4px',
    }}>
      {hasGlyph && <Handle type="target" position={Position.Left} className="bll-handle" />}
      <div className="bll-group-label">
        {GlyphComp && <GlyphComp status="ok" size={glyphSize} />}
        {data.label || 'Module'}
      </div>
      {hasGlyph && <Handle type="source" position={Position.Right} className="bll-handle" />}
    </div>
  );
}

// ─── Shape Nodes (drawing primitives) ───────────────────────────────────

function ShapeLineNode({ data }) {
  const w = data.width || 200;
  const h = data.height || 4;
  const color = data.color || '#22c55e';
  const dashed = data.dashed;
  const rotation = data.rotation || 0;
  return (
    <div style={{
      width: w, height: Math.max(h, 10), position: 'relative',
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
    }}>
      <Handle type="target" position={Position.Left} className="bll-handle" />
      <svg width={w} height={Math.max(h, 10)} style={{ position: 'absolute', top: 0, left: 0 }}>
        <line
          x1={0} y1={Math.max(h, 10) / 2}
          x2={w} y2={Math.max(h, 10) / 2}
          stroke={color} strokeWidth={h}
          strokeDasharray={dashed ? '8,4' : undefined}
        />
      </svg>
      <Handle type="source" position={Position.Right} className="bll-handle" />
    </div>
  );
}

function ShapeRectNode({ data }) {
  const w = data.width || 100;
  const h = data.height || 60;
  const color = data.color || '#4488ff';
  const fillColor = data.fill || 'rgba(68,136,255,0.1)';
  const dashed = data.dashed;
  const rx = data.rounded ? 8 : 2;
  const rotation = data.rotation || 0;
  return (
    <div style={{
      width: w, height: h,
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
    }}>
      <svg width={w} height={h}>
        <rect
          x={1} y={1} width={w - 2} height={h - 2} rx={rx}
          fill={fillColor} stroke={color} strokeWidth={2}
          strokeDasharray={dashed ? '6,3' : undefined}
        />
        {data.label && (
          <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fill={color} fontSize={12} fontWeight="bold">
            {data.label}
          </text>
        )}
      </svg>
    </div>
  );
}

function ShapeCircleNode({ data }) {
  const size = data.size || 40;
  const color = data.color || '#4488ff';
  const fillColor = data.fill || 'rgba(68,136,255,0.1)';
  const rotation = data.rotation || 0;
  return (
    <div style={{
      width: size, height: size,
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
    }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 2}
          fill={fillColor} stroke={color} strokeWidth={2}
        />
        {data.label && (
          <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fill={color} fontSize={10} fontWeight="bold">
            {data.label}
          </text>
        )}
      </svg>
    </div>
  );
}

function ShapeArcNode({ data }) {
  const w = data.width || 80;
  const h = data.height || 60;
  const color = data.color || '#4488ff';
  const sweep = data.sweep || 0;
  const cy = sweep === 0 ? h : 0;
  const rotation = data.rotation || 0;
  return (
    <div style={{
      width: w, height: h,
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
    }}>
      <Handle type="target" position={Position.Left} className="bll-handle" />
      <svg width={w} height={h}>
        <path
          d={`M0,${cy} Q${w / 2},${sweep === 0 ? 0 : h * 2} ${w},${cy}`}
          fill="none" stroke={color} strokeWidth={2}
        />
      </svg>
      <Handle type="source" position={Position.Right} className="bll-handle" />
    </div>
  );
}

const nodeTypes = {
  device: DeviceNode,
  annotation: AnnotationNode,
  group: GroupNode,
  'shape-line': ShapeLineNode,
  'shape-rect': ShapeRectNode,
  'shape-circle': ShapeCircleNode,
  'shape-arc': ShapeArcNode,
};

const PALETTE_CATEGORIES = [
  { key: 'source',      label: 'Source' },
  { key: 'accelerator', label: 'Accelerator' },
  { key: 'magnet',      label: 'Magnets' },
  { key: 'optics',      label: 'Optics' },
  { key: 'diagnostic',  label: 'Diagnostics' },
  { key: 'detector',    label: 'Detectors' },
  { key: 'vacuum',      label: 'Vacuum' },
  { key: 'beamline',    label: 'Beam Line' },
  { key: 'motion',      label: 'Motion' },
  { key: 'infra',       label: 'Infrastructure' },
];

// ─── Device Name Picker Modal ───────────────────────────────────────────

function DevicePickerModal({ devices, glyphType, familyFilter, onSelect, onSkip, onCancel }) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const filtered = useMemo(() => {
    let list = devices;
    if (familyFilter) list = list.filter(d => d.family === familyFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.pvPrefix?.toLowerCase().includes(q) ||
        d.iocName?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [devices, familyFilter, search]);

  const handleConfirm = () => {
    const dev = devices.find(d => d.id === selectedId);
    if (dev) onSelect(dev);
  };

  return (
    <div className="widget-modal-overlay" onClick={onCancel}>
      <div className="widget-modal bll-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="widget-modal-header">
          <span className="widget-title">
            Select device{familyFilter ? ` (${familyFilter})` : ''} from configuration
          </span>
          <button className="widget-btn" onClick={onCancel}>✕</button>
        </div>
        <div className="widget-modal-body">
          <input className="settings-input bll-picker-search" value={search}
            onChange={e => setSearch(e.target.value)} placeholder="Search devices..." autoFocus />
          <div className="bll-picker-list">
            {filtered.map(dev => (
              <button key={dev.id}
                className={`bll-picker-item ${selectedId === dev.id ? 'active' : ''}`}
                onClick={() => setSelectedId(dev.id)}
                onDoubleClick={() => onSelect(dev)}>
                <span className="bll-picker-item-name">{dev.name}</span>
                <span className="bll-picker-item-meta">{dev.family} · {dev.iocName}</span>
                {dev.zone && <span className="bl-chip-tag bl-chip-tag--zone">{dev.zone}</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="bll-picker-empty">No matching devices</div>}
          </div>
          <div className="bll-picker-actions">
            <button className="bl-btn bl-btn--sm" onClick={onSkip}>Skip (unlinked)</button>
            <button className="bl-btn bl-btn--sm" onClick={onCancel}>Cancel</button>
            <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleConfirm} disabled={!selectedId}>
              ✓ Place Device
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Node Properties Editor ─────────────────────────────────────────────

function NodePropsModal({ node, allDevices, allNodes, onSave, onCancel }) {
  const [props, setProps] = useState(() => ({ ...node.data }));
  const update = (key, val) => setProps(p => ({ ...p, [key]: val }));

  const isShape = node.type?.startsWith('shape-');
  const isDevice = node.type === 'device';
  const isAnnotation = node.type === 'annotation';
  const isGroup = node.type === 'group';

  // Multi-device management
  const [deviceSearch, setDeviceSearch] = useState('');
  const linkedDevices = props.devices?.length > 0 ? props.devices : resolveDevices(props);

  const removeDevice = (devId) => {
    const newDevices = linkedDevices.filter(d => d.id !== devId);
    setProps(p => ({ ...p, devices: newDevices }));
  };

  const addDevice = (dev) => {
    if (linkedDevices.some(d => d.id === dev.id)) return;
    const newDevices = [...linkedDevices, {
      id: dev.id, name: dev.name, pvPrefix: dev.pvPrefix, family: dev.family, iocName: dev.iocName,
    }];
    setProps(p => ({
      ...p,
      devices: newDevices,
      label: p.label || newDevices[0]?.name || '',
    }));
    setDeviceSearch('');
  };

  const searchResults = useMemo(() => {
    if (!deviceSearch || !allDevices) return [];
    const q = deviceSearch.toLowerCase();
    const existingIds = new Set(linkedDevices.map(d => d.id));
    return allDevices.filter(d =>
      !existingIds.has(d.id) &&
      (d.name.toLowerCase().includes(q) || d.pvPrefix?.toLowerCase().includes(q) || d.iocName?.toLowerCase().includes(q))
    ).slice(0, 10);
  }, [deviceSearch, allDevices, linkedDevices]);

  // All glyph types (built-in + custom) grouped by category
  const glyphsByCategory = useMemo(() => {
    const all = [...GLYPH_TYPES, ...customGlyphs.map(g => ({ type: g.type, label: g.label, icon: g.icon || '🎨', category: g.category }))];
    const map = {};
    all.forEach(g => {
      if (!map[g.category]) map[g.category] = [];
      map[g.category].push(g);
    });
    return map;
  }, []);

  // Children of this group (for display)
  const groupChildren = useMemo(() => {
    if (!isGroup || !allNodes) return [];
    return allNodes.filter(n => n.parentId === node.id);
  }, [isGroup, allNodes, node.id]);

  // Glyph preview
  const PreviewGlyph = isDevice && props.glyphType ? getGlyph(props.glyphType) : null;

  return (
    <div className="widget-modal-overlay" onClick={onCancel}>
      <div className="widget-modal bll-props-modal" onClick={e => e.stopPropagation()}>
        <div className="widget-modal-header">
          <span className="widget-title">Edit Properties</span>
          <button className="widget-btn" onClick={onCancel}>✕</button>
        </div>
        <div className="widget-modal-body">
          {/* Label */}
          <div className="bl-tpl-field">
            <label className="bl-tpl-field-label">Label</label>
            <input className="settings-input" value={props.label || ''} onChange={e => update('label', e.target.value)} />
          </div>

          {/* Glyph type selector + preview (device only) */}
          {isDevice && (
            <div className="bl-tpl-field">
              <label className="bl-tpl-field-label">Glyph Type</label>
              <div className="bll-glyph-selector">
                <select className="settings-input" value={props.glyphType || ''}
                  onChange={e => update('glyphType', e.target.value)}>
                  <option value="">— auto —</option>
                  {Object.entries(glyphsByCategory).map(([cat, glyphs]) => (
                    <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                      {glyphs.map(g => (
                        <option key={g.type} value={g.type}>{g.icon} {g.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {PreviewGlyph && (
                  <div className="bll-glyph-preview">
                    <PreviewGlyph status="ok" size={32} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Rotation (all types) */}
          <div className="bl-tpl-field">
            <label className="bl-tpl-field-label">Rotation (°)</label>
            <div className="bll-rotation-row">
              <input className="settings-input" type="number" value={props.rotation || 0}
                onChange={e => update('rotation', Number(e.target.value))} style={{ width: 80 }} />
              <button className="bl-btn bl-btn--sm" type="button" onClick={() => update('rotation', ((props.rotation || 0) + 90) % 360)}>+90°</button>
              <button className="bl-btn bl-btn--sm" type="button" onClick={() => update('rotation', ((props.rotation || 0) - 90 + 360) % 360)}>-90°</button>
              <button className="bl-btn bl-btn--sm" type="button" onClick={() => update('rotation', 0)}>Reset</button>
            </div>
          </div>

          {/* Width / Height */}
          {(isShape || isGroup) && props.width !== undefined && (
            <div className="bl-tpl-field">
              <label className="bl-tpl-field-label">Width</label>
              <input className="settings-input" type="number" value={props.width} onChange={e => update('width', Number(e.target.value))} />
            </div>
          )}
          {(isShape || isGroup) && props.height !== undefined && (
            <div className="bl-tpl-field">
              <label className="bl-tpl-field-label">Height</label>
              <input className="settings-input" type="number" value={props.height} onChange={e => update('height', Number(e.target.value))} />
            </div>
          )}
          {isShape && props.size !== undefined && (
            <div className="bl-tpl-field">
              <label className="bl-tpl-field-label">Size</label>
              <input className="settings-input" type="number" value={props.size} onChange={e => update('size', Number(e.target.value))} />
            </div>
          )}

          {/* Device: glyph size + border toggle */}
          {isDevice && (
            <>
              <div className="bl-tpl-field">
                <label className="bl-tpl-field-label">Glyph Size</label>
                <input className="settings-input" type="number" value={props.glyphSize || 36}
                  onChange={e => update('glyphSize', Number(e.target.value))} />
              </div>
              <label className="bl-tpl-field bl-tpl-field--check">
                <input type="checkbox" checked={props.showBorder !== false}
                  onChange={e => update('showBorder', e.target.checked)} />
                <span>Show Border</span>
              </label>
            </>
          )}

          {/* Linked Devices (device only) */}
          {isDevice && allDevices && (
            <div className="bl-tpl-field">
              <label className="bl-tpl-field-label">Linked Devices ({linkedDevices.length})</label>
              <div className="bll-linked-devices">
                {linkedDevices.map(d => (
                  <div key={d.id} className="bll-linked-device">
                    <span className="bll-linked-device-name">{d.name || d.id}</span>
                    <span className="bll-linked-device-meta">{d.family}</span>
                    <button className="bl-btn bl-btn--sm" onClick={() => removeDevice(d.id)} title="Remove">✕</button>
                  </div>
                ))}
                <div className="bll-device-adder">
                  <input className="settings-input" value={deviceSearch}
                    onChange={e => setDeviceSearch(e.target.value)} placeholder="Search device to add..." />
                  {searchResults.map(d => (
                    <button key={d.id} className="bll-picker-item" onClick={() => addDevice(d)}>
                      <span className="bll-picker-item-name">{d.name}</span>
                      <span className="bll-picker-item-meta">{d.family} · {d.iocName}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Group: shape, dashed, border color, children list */}
          {isGroup && (
            <>
              <div className="bl-tpl-field">
                <label className="bl-tpl-field-label">Shape</label>
                <select className="settings-input" value={props.shape || 'rect'} onChange={e => update('shape', e.target.value)}>
                  <option value="rect">Rectangle</option>
                  <option value="rounded">Rounded Rectangle</option>
                  <option value="oval">Oval</option>
                </select>
              </div>
              <label className="bl-tpl-field bl-tpl-field--check">
                <input type="checkbox" checked={props.dashed !== false}
                  onChange={e => update('dashed', e.target.checked)} />
                <span>Dashed Border</span>
              </label>
              <div className="bl-tpl-field">
                <label className="bl-tpl-field-label">Border Color</label>
                <input type="color" value={props.borderColor || '#555555'} onChange={e => update('borderColor', e.target.value)} />
              </div>
              {/* Show children inside this module */}
              <div className="bl-tpl-field">
                <label className="bl-tpl-field-label">Elements inside ({groupChildren.length})</label>
                <div className="bll-linked-devices">
                  {groupChildren.map(ch => {
                    const GlyphIcon = ch.type === 'device' ? getGlyph(ch.data.glyphType || 'generic') : null;
                    return (
                      <div key={ch.id} className="bll-linked-device">
                        {GlyphIcon && <GlyphIcon status="ok" size={18} />}
                        <span className="bll-linked-device-name">{ch.data.label || ch.id}</span>
                        <span className="bll-linked-device-meta">{ch.type}</span>
                      </div>
                    );
                  })}
                  {groupChildren.length === 0 && <span style={{ color: '#666', fontSize: 12 }}>Drag elements into this module on the canvas</span>}
                </div>
              </div>
            </>
          )}

          {/* Color */}
          {(isShape || isAnnotation) && (
            <div className="bl-tpl-field">
              <label className="bl-tpl-field-label">Color</label>
              <input type="color" value={props.color || '#4488ff'} onChange={e => update('color', e.target.value)} />
            </div>
          )}
          {/* Fill */}
          {(node.type === 'shape-rect' || node.type === 'shape-circle') && (
            <div className="bl-tpl-field">
              <label className="bl-tpl-field-label">Fill Color</label>
              <input type="color" value={props.fill?.startsWith('#') ? props.fill : '#112233'}
                onChange={e => update('fill', e.target.value + '33')} />
            </div>
          )}
          {/* Dashed */}
          {(node.type === 'shape-line' || node.type === 'shape-rect') && (
            <label className="bl-tpl-field bl-tpl-field--check">
              <input type="checkbox" checked={!!props.dashed} onChange={e => update('dashed', e.target.checked)} />
              <span>Dashed</span>
            </label>
          )}
          {/* Rounded */}
          {node.type === 'shape-rect' && (
            <label className="bl-tpl-field bl-tpl-field--check">
              <input type="checkbox" checked={!!props.rounded} onChange={e => update('rounded', e.target.checked)} />
              <span>Rounded Corners</span>
            </label>
          )}
          {/* Arc sweep */}
          {node.type === 'shape-arc' && (
            <div className="bl-tpl-field">
              <label className="bl-tpl-field-label">Arc Direction</label>
              <select className="settings-input" value={props.sweep || 0} onChange={e => update('sweep', Number(e.target.value))}>
                <option value={0}>Top arc</option>
                <option value={1}>Bottom arc</option>
              </select>
            </div>
          )}
          {/* Annotation specifics */}
          {isAnnotation && (
            <>
              <div className="bl-tpl-field">
                <label className="bl-tpl-field-label">Font Size</label>
                <input className="settings-input" type="number" value={props.fontSize || 14}
                  onChange={e => update('fontSize', Number(e.target.value))} />
              </div>
              <label className="bl-tpl-field bl-tpl-field--check">
                <input type="checkbox" checked={!!props.bold} onChange={e => update('bold', e.target.checked)} />
                <span>Bold</span>
              </label>
            </>
          )}

          <div className="bll-picker-actions">
            <button className="bl-btn bl-btn--sm" onClick={onCancel}>Cancel</button>
            <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={() => onSave(props)}>✓ Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Right-click Context Menu ───────────────────────────────────────────

function ContextMenu({ x, y, items, onClose }) {
  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);

  return (
    <div className="bll-context-menu" style={{ left: x, top: y }} onClick={e => e.stopPropagation()}>
      {items.map((item, i) => item.separator ? (
        <div key={i} className="bll-context-menu-sep" />
      ) : (
        <button key={i} className={`bll-context-menu-item${item.disabled ? ' disabled' : ''}`}
          onClick={() => { if (!item.disabled) { item.action(); onClose(); } }}
          disabled={item.disabled}>
          <span className="bll-context-menu-icon">{item.icon || ''}</span>
          <span className="bll-context-menu-label">{item.label}</span>
          {item.shortcut && <span className="bll-context-menu-shortcut">{item.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Layout Manager Modal ───────────────────────────────────────────────

function LayoutManagerModal({ beamline, currentLayout, onLoad, onNew, onClose, gitLayouts, onLoadFromGit }) {
  const layouts = listLayouts(beamline);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [, forceUpdate] = useState(0);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onNew(name);
    setNewName('');
  };

  const handleRename = (oldName) => {
    const name = renameValue.trim();
    if (!name || name === oldName) { setRenaming(null); return; }
    renameNamedLayout(beamline, oldName, name);
    if (currentLayout === oldName) onLoad(name);
    setRenaming(null);
    forceUpdate(n => n + 1);
  };

  const handleDelete = (name) => {
    if (!confirm(`Delete layout "${name}"?`)) return;
    deleteNamedLayout(beamline, name);
    if (currentLayout === name) onLoad(null);
    forceUpdate(n => n + 1);
  };

  return (
    <div className="widget-modal-overlay" onClick={onClose}>
      <div className="widget-modal bll-lm-modal" onClick={e => e.stopPropagation()}>
        <div className="widget-modal-header">
          <span className="widget-title">Layout Manager</span>
          <button className="widget-btn" onClick={onClose}>✕</button>
        </div>
        <div className="widget-modal-body">
          <div className="bll-lm-create">
            <input className="settings-input" value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="New layout name..."
              onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleCreate} disabled={!newName.trim()}>
              + Create
            </button>
          </div>

          {/* Git remote layouts */}
          {gitLayouts && gitLayouts.length > 0 && (
            <div className="bll-lm-section">
              <div className="bll-lm-section-title">☁️ Git Repository</div>
              <div className="bll-lm-list">
                {gitLayouts.map(l => (
                  <div key={l.name} className="bll-lm-item">
                    <button className="bll-lm-name" onClick={() => onLoadFromGit(l.name)}>
                      <span>☁️ {l.name}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Local layouts */}
          <div className="bll-lm-section">
            {gitLayouts && gitLayouts.length > 0 && (
              <div className="bll-lm-section-title">💾 Local</div>
            )}
            <div className="bll-lm-list">
              {layouts.length === 0 && <div className="bll-picker-empty">No saved layouts yet</div>}
              {layouts.map(l => (
                <div key={l.name} className={`bll-lm-item ${l.name === currentLayout ? 'active' : ''}`}>
                  {renaming === l.name ? (
                    <input className="settings-input bll-lm-rename" value={renameValue} autoFocus
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRename(l.name)}
                      onBlur={() => handleRename(l.name)} />
                  ) : (
                    <button className="bll-lm-name" onClick={() => onLoad(l.name)}>
                      <span>{l.name}</span>
                      <span className="bll-lm-meta">{l.nodeCount} elements</span>
                    </button>
                  )}
                  <div className="bll-lm-actions">
                    <button className="bl-btn bl-btn--sm" onClick={() => { setRenaming(l.name); setRenameValue(l.name); }} title="Rename">✎</button>
                    <button className="bl-btn bl-btn--sm" onClick={() => handleDelete(l.name)} title="Delete">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Custom Glyph Modal ─────────────────────────────────────────────────

function CustomGlyphModal({ onClose, onSave }) {
  const [glyphs, setGlyphs] = useState(() => [...customGlyphs]);
  const [editIdx, setEditIdx] = useState(-1);
  const [typeName, setTypeName] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('infra');
  const [svgCode, setSvgCode] = useState('');

  const startNew = () => { setEditIdx(-1); setTypeName(''); setLabel(''); setCategory('infra'); setSvgCode(''); };

  const startEdit = (idx) => {
    const g = glyphs[idx];
    setEditIdx(idx);
    setTypeName(g.type.replace(/^custom-/, ''));
    setLabel(g.label);
    setCategory(g.category);
    setSvgCode(g.svg);
  };

  const parsedSvg = useMemo(() => {
    let inner = svgCode.trim();
    const match = inner.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
    if (match) inner = match[1];
    return inner.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on\w+\s*=/gi, '');
  }, [svgCode]);

  const handleSaveGlyph = () => {
    if (!typeName || !label || !svgCode) return;
    const t = `custom-${typeName.replace(/^custom-/, '').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`;
    const newGlyph = { type: t, label, category, svg: parsedSvg, icon: '🎨' };
    let updated;
    if (editIdx >= 0) {
      updated = [...glyphs];
      updated[editIdx] = newGlyph;
    } else {
      if (glyphs.some(g => g.type === t)) { alert('A custom glyph with this type already exists.'); return; }
      updated = [...glyphs, newGlyph];
    }
    setGlyphs(updated);
    saveCustomGlyphs(updated);
    startNew();
    onSave();
  };

  const handleDeleteGlyph = (idx) => {
    const updated = glyphs.filter((_, i) => i !== idx);
    setGlyphs(updated);
    saveCustomGlyphs(updated);
    if (editIdx === idx) startNew();
    onSave();
  };

  return (
    <div className="widget-modal-overlay" onClick={onClose}>
      <div className="widget-modal bll-custom-glyph-modal" onClick={e => e.stopPropagation()}>
        <div className="widget-modal-header">
          <span className="widget-title">Custom Glyph Icons</span>
          <button className="widget-btn" onClick={onClose}>✕</button>
        </div>
        <div className="widget-modal-body">
          <div className="bll-custom-layout">
            <div className="bll-custom-list">
              {glyphs.map((g, i) => (
                <div key={g.type} className={`bll-custom-item ${editIdx === i ? 'active' : ''}`}>
                  <button className="bll-custom-item-btn" onClick={() => startEdit(i)}>
                    <svg width={24} height={24} viewBox="0 0 48 48" fill="none"
                      dangerouslySetInnerHTML={{ __html: g.svg.replace(/<script[\s\S]*?<\/script>/gi, '') }} />
                    <span>{g.label}</span>
                  </button>
                  <button className="bl-btn bl-btn--sm" onClick={() => handleDeleteGlyph(i)} title="Delete">🗑</button>
                </div>
              ))}
              {glyphs.length === 0 && <div className="bll-picker-empty">No custom glyphs yet</div>}
              <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={startNew} style={{ marginTop: 8 }}>+ New Glyph</button>
            </div>
            <div className="bll-custom-editor">
              <div className="bl-tpl-field">
                <label className="bl-tpl-field-label">Type ID</label>
                <input className="settings-input" value={typeName} onChange={e => setTypeName(e.target.value)} placeholder="my-glyph" />
              </div>
              <div className="bl-tpl-field">
                <label className="bl-tpl-field-label">Display Label</label>
                <input className="settings-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="My Custom Glyph" />
              </div>
              <div className="bl-tpl-field">
                <label className="bl-tpl-field-label">Category</label>
                <select className="settings-input" value={category} onChange={e => setCategory(e.target.value)}>
                  {PALETTE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div className="bl-tpl-field">
                <label className="bl-tpl-field-label">SVG Code (48×48 viewBox)</label>
                <textarea className="settings-input bll-custom-svg-input" rows={6} value={svgCode}
                  onChange={e => setSvgCode(e.target.value)}
                  placeholder={'<circle cx="24" cy="24" r="20" stroke="#4488ff" stroke-width="2" fill="rgba(68,136,255,0.2)"/>'} />
              </div>
              {parsedSvg && (
                <div className="bl-tpl-field">
                  <label className="bl-tpl-field-label">Preview</label>
                  <div className="bll-custom-preview">
                    <svg width={48} height={48} viewBox="0 0 48 48" fill="none"
                      dangerouslySetInnerHTML={{ __html: parsedSvg }} />
                  </div>
                </div>
              )}
              <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleSaveGlyph}
                disabled={!typeName || !label || !svgCode}>
                {editIdx >= 0 ? '✓ Update Glyph' : '✓ Add Glyph'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Inner Layout Editor ────────────────────────────────────────────────

function LayoutEditor() {
  const { config, devices, pvwsClient, zones } = useApp();
  const { gitStorage, canSync, canWrite } = useGitStorage();
  const beamline = config?.beamline || 'default';
  const reactFlowWrapper = useRef(null);
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [editMode, setEditMode] = useState(true);
  const [showPalette, setShowPalette] = useState(true);
  const [selectedZone, setSelectedZone] = useState('');
  const [dirty, setDirty] = useState(false);
  const [gitDirty, setGitDirty] = useState(false);
  const markDirty = useCallback(() => { setDirty(true); setGitDirty(true); }, []);
  const [detailDevices, setDetailDevices] = useState(null);
  const [currentLayout, setCurrentLayout] = useState(null);
  const [customGlyphVersion, setCustomGlyphVersion] = useState(0);
  const [schematicView, setSchematicView] = useState(false);
  const [clipboard, setClipboard] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);

  // Git sync state
  const [syncing, setSyncing] = useState(false);
  const [gitRef, setGitRef] = useState(null); // sha/blob_id for optimistic locking
  const [gitLayouts, setGitLayouts] = useState([]); // remote layout list

  // Modals
  const [pickerOpen, setPickerOpen] = useState(null);
  const [propsNode, setPropsNode] = useState(null);
  const [layoutManagerOpen, setLayoutManagerOpen] = useState(false);
  const [customGlyphModalOpen, setCustomGlyphModalOpen] = useState(false);

  // Palette collapse
  const [collapsedSections, setCollapsedSections] = useState({});
  const toggleSection = (key) => setCollapsedSections(p => ({ ...p, [key]: !p[key] }));

  const availableLayouts = useMemo(() => listLayouts(beamline), [beamline, currentLayout]);

  // Load layout when selected
  useEffect(() => {
    if (currentLayout) {
      const saved = loadNamedLayout(beamline, currentLayout);
      if (saved) {
        setNodes(saved.nodes || []);
        setEdges(saved.edges || []);
        setDirty(false);
        return;
      }
    }
    setNodes([]);
    setEdges([]);
    setDirty(false);
  }, [beamline, currentLayout]);

  // ─── Keyboard shortcuts ──────────────────────────────────────────

  useEffect(() => {
    const handler = (e) => {
      if (!editMode) return;
      // Ignore when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key === 'c') { e.preventDefault(); handleCopy(); }
      else if (isMeta && e.key === 'x') { e.preventDefault(); handleCut(); }
      else if (isMeta && e.key === 'v') { e.preventDefault(); handlePaste(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  // ─── Copy / Cut / Paste ──────────────────────────────────────────

  const handleCopy = useCallback(() => {
    const selected = nodes.filter(n => n.selected);
    if (selected.length === 0) return;
    setClipboard(selected.map(n => JSON.parse(JSON.stringify(n))));
  }, [nodes]);

  const handleCut = useCallback(() => {
    const selected = nodes.filter(n => n.selected);
    if (selected.length === 0) return;
    setClipboard(selected.map(n => JSON.parse(JSON.stringify(n))));
    setNodes(nds => nds.filter(n => !n.selected));
    setEdges(eds => {
      const removedIds = new Set(selected.map(n => n.id));
      return eds.filter(e => !removedIds.has(e.source) && !removedIds.has(e.target));
    });
    markDirty();
  }, [nodes, setNodes, setEdges]);

  const handlePaste = useCallback(() => {
    if (clipboard.length === 0) return;
    const offset = 40;
    const idMap = {};
    const newNodes = clipboard.map(n => {
      const newId = `${n.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      idMap[n.id] = newId;
      return {
        ...n,
        id: newId,
        selected: false,
        position: { x: n.position.x + offset, y: n.position.y + offset },
        parentId: n.parentId ? (idMap[n.parentId] || n.parentId) : undefined,
      };
    });
    setNodes(nds => [...nds, ...newNodes]);
    markDirty();
  }, [clipboard, setNodes]);

  // ─── Layout management ───────────────────────────────────────────

  /** Build the export-format JSON data from current nodes/edges. */
  const buildExportData = useCallback(() => ({
    beamline,
    layout: currentLayout || 'untitled',
    elements: nodes.map(n => ({
      id: n.id, type: n.type,
      parentId: n.parentId,
      devices: resolveDevices(n.data),
      label: n.data.label,
      glyphType: n.data.glyphType,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      ...n.data,
    })),
    connections: edges.map(e => ({ from: e.source, to: e.target })),
  }), [beamline, currentLayout, nodes, edges]);

  const handleSave = useCallback(() => {
    if (!currentLayout) {
      const name = prompt('Enter layout name:', 'Layout 1');
      if (!name) return;
      setCurrentLayout(name);
      saveNamedLayout(beamline, name, { nodes, edges });
    } else {
      saveNamedLayout(beamline, currentLayout, { nodes, edges });
    }
    setDirty(false);
  }, [beamline, currentLayout, nodes, edges]);

  /** Helper: import remote layout data into the editor. */
  const importRemoteLayout = useCallback((data, ref, name) => {
    const imported = (data.elements || []).map(el => ({
      id: el.id || `el-${Math.random().toString(36).slice(2, 8)}`,
      type: el.type || 'device',
      position: { x: el.x || 0, y: el.y || 0 },
      parentId: el.parentId || undefined,
      ...(el.type === 'group'
        ? { style: { width: el.width || 200, height: el.height || 150 } }
        : {}),
      data: { ...el },
    }));
    const importedEdges = (data.connections || []).map((c, i) => ({
      id: `e-git-${i}`,
      source: c.from,
      target: c.to,
      type: 'default',
      style: { stroke: '#4488ff', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#4488ff' },
    }));
    setNodes(imported);
    setEdges(importedEdges);
    setGitRef(ref);
    saveNamedLayout(beamline, name, { nodes: imported, edges: importedEdges });
    setDirty(false);
    setGitDirty(false);
  }, [beamline, setNodes, setEdges]);

  /** Sync with git: check remote first, then push only if local changes exist. */
  const handleSyncToGit = useCallback(async () => {
    if (!canSync || !currentLayout) return;
    if (!canWrite) {
      alert('Login with a personal access token in Settings to push layouts to git.');
      return;
    }
    setSyncing(true);
    try {
      // 1. Always check remote first
      const check = await gitStorage.checkLayoutConflict(currentLayout, gitRef);

      // 2. Remote changed — handle conflict
      if (check.conflict) {
        if (!gitDirty) {
          // No local modifications — just pull the remote version
          importRemoteLayout(check.remoteData, check.remoteRef, currentLayout);
          alert(`Layout "${currentLayout}" updated from git (remote had changes).`);
          return;
        }
        // Local modifications exist AND remote changed — ask the user
        const action = prompt(
          `Remote layout "${currentLayout}" has been modified since your last sync, and you have local changes.\n\n` +
          `Choose an action:\n` +
          `  1 — Overwrite remote with your local version\n` +
          `  2 — Load remote version (discard local changes)\n` +
          `  3 — Cancel\n\n` +
          `Enter 1, 2, or 3:`
        );
        if (action === '2') {
          importRemoteLayout(check.remoteData, check.remoteRef, currentLayout);
          alert(`Loaded remote version of "${currentLayout}".`);
          return;
        }
        if (action !== '1') return; // Cancel
      }

      // 3. No local changes pending — nothing to push
      if (!gitDirty) {
        alert(`Layout "${currentLayout}" is up to date — no local changes to push.`);
        return;
      }

      // 4. Local changes exist — ask for commit message and push
      const msg = prompt('Commit message:', `Update layout: ${currentLayout}`);
      if (!msg) return;
      const data = buildExportData();
      const result = await gitStorage.saveLayout(currentLayout, data, msg, check.remoteRef || gitRef);
      setGitRef(result?.content?.sha || result?.file_path || null);
      saveNamedLayout(beamline, currentLayout, { nodes, edges });
      setDirty(false);
      setGitDirty(false);
      alert(`Layout "${currentLayout}" pushed to git.`);
    } catch (err) {
      console.error('[GitSync] Push failed:', err);
      alert(`Git push failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }, [canSync, canWrite, gitStorage, currentLayout, buildExportData, gitRef, gitDirty, beamline, nodes, edges, importRemoteLayout]);

  /** Fetch layout list from the remote git repository. */
  const refreshGitLayouts = useCallback(async () => {
    if (!canSync) return;
    try {
      const list = await gitStorage.listLayouts();
      setGitLayouts(list);
    } catch (err) {
      console.warn('[GitSync] Failed to list remote layouts:', err);
    }
  }, [canSync, gitStorage]);

  /** Load a layout from the git repository by name. */
  const handleLoadFromGit = useCallback(async (name) => {
    if (!canSync) return;
    if (dirty && !confirm('Discard unsaved changes?')) return;
    setSyncing(true);
    try {
      const { data, ref } = await gitStorage.loadLayout(name);
      importRemoteLayout(data, ref, name);
      setCurrentLayout(name);
      setLayoutManagerOpen(false);
    } catch (err) {
      console.error('[GitSync] Load failed:', err);
      alert(`Failed to load layout from git: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }, [canSync, gitStorage, dirty, importRemoteLayout]);


  const handleLoadLayout = useCallback((name) => {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    setCurrentLayout(name);
    setLayoutManagerOpen(false);
  }, [dirty]);

  const handleNewLayout = useCallback((name) => {
    saveNamedLayout(beamline, name, { nodes: [], edges: [] });
    setCurrentLayout(name);
    setNodes([]);
    setEdges([]);
    setDirty(false);
    setLayoutManagerOpen(false);
  }, [beamline, setNodes, setEdges]);

  // ─── Connections (straight lines) ────────────────────────────────

  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({
      ...params,
      type: 'default',
      style: { stroke: '#4488ff', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#4488ff' },
    }, eds));
    markDirty();
  }, [setEdges]);

  // ─── Node drag stop: reparent into/out of groups ─────────────────

  const onNodeDragStop = useCallback((event, draggedNode) => {
    markDirty();
    if (draggedNode.type === 'group') return;

    setNodes(nds => {
      const currentNode = nds.find(n => n.id === draggedNode.id);
      if (!currentNode) return nds;

      // Compute absolute position of the dragged node
      let absX = currentNode.position.x;
      let absY = currentNode.position.y;
      if (currentNode.parentId) {
        const parent = nds.find(n => n.id === currentNode.parentId);
        if (parent) {
          absX += parent.position.x;
          absY += parent.position.y;
        }
      }

      // Find if the node is inside any group
      const groups = nds.filter(n => n.type === 'group' && n.id !== currentNode.id);
      let targetGroup = null;
      for (const g of groups) {
        const gw = g.data.width || 300;
        const gh = g.data.height || 200;
        if (absX >= g.position.x && absX <= g.position.x + gw &&
            absY >= g.position.y && absY <= g.position.y + gh) {
          targetGroup = g;
          break;
        }
      }

      const currentParentId = currentNode.parentId;

      if (targetGroup && currentParentId !== targetGroup.id) {
        // Reparent to new group
        return nds.map(n => {
          if (n.id !== currentNode.id) return n;
          return {
            ...n,
            parentId: targetGroup.id,
            position: {
              x: absX - targetGroup.position.x,
              y: absY - targetGroup.position.y,
            },
          };
        });
      } else if (!targetGroup && currentParentId) {
        // Unparent — drag out of group
        return nds.map(n => {
          if (n.id !== currentNode.id) return n;
          const { parentId: _removed, ...rest } = n;
          return { ...rest, position: { x: absX, y: absY } };
        });
      }
      return nds;
    });
  }, [setNodes]);

  // ─── Export / Import ─────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const data = buildExportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beamline-layout-${currentLayout || 'untitled'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildExportData, currentLayout]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      console.info('[BeamlineLayoutImport] Starting import:', file.name);
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          const isBeamlineFormat = Array.isArray(data.elements);
          const isDashboardFormat = Array.isArray(data.widgets);

          let imported = [];
          let importedEdges = [];

          if (isBeamlineFormat) {
            imported = data.elements.map(el => ({
              id: el.id || `el-${Math.random().toString(36).slice(2, 8)}`,
              type: el.type || 'device',
              position: { x: el.x || 0, y: el.y || 0 },
              parentId: el.parentId,
              ...(el.type === 'group' ? { style: { zIndex: -1 } } : {}),
              data: {
                label: el.label || '?',
                devices: el.devices || (el.device ? [{ id: el.device, name: el.label }] : []),
                glyphType: el.glyphType || 'generic',
                width: el.width || 90,
                height: el.height || 60,
                rotation: el.rotation || 0,
                ...el,
              },
            }));
            importedEdges = (data.connections || []).map((c, i) => ({
              id: `e-import-${i}`,
              source: c.from,
              target: c.to,
              type: 'default',
              style: { stroke: '#4488ff', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#4488ff' },
            }));
          } else if (isDashboardFormat) {
            // Convert dashboard widgets to annotation nodes so /layout can visualize them.
            imported = data.widgets.map((w, i) => {
              const gx = w.layout?.x || 0;
              const gy = w.layout?.y || 0;
              const gw = w.layout?.w || 2;
              const gh = w.layout?.h || 1;
              const label = w.config?.text || w.config?.title || w.type || `Widget ${i + 1}`;
              return {
                id: `dw-${w.id || i}`,
                type: 'annotation',
                position: { x: gx * 120, y: gy * 70 },
                data: {
                  label,
                  annotationType: 'label',
                  fontSize: w.config?.fontSize || 14,
                  color: w.config?.foreground || '#e1e4ed',
                  width: gw * 110,
                  height: gh * 60,
                },
              };
            });
            importedEdges = [];
          } else {
            throw new Error('Unsupported JSON format. Expected BeamlineLayout (elements/connections) or Dashboard (widgets).');
          }

          if (imported.length === 0) {
            throw new Error('No elements found in imported file');
          }

          setNodes(imported);
          setEdges(importedEdges);
          markDirty();
          console.info('[BeamlineLayoutImport] Imported:', {
            file: file.name,
            nodeCount: imported.length,
            edgeCount: importedEdges.length,
            sourceFormat: isBeamlineFormat ? 'beamline' : 'dashboard',
          });
          alert(`Imported layout from ${isBeamlineFormat ? 'beamline' : 'dashboard'} JSON: ${imported.length} node${imported.length === 1 ? '' : 's'}, ${importedEdges.length} connection${importedEdges.length === 1 ? '' : 's'}.`);
        } catch (err) {
          console.error('[BeamlineLayoutImport] Import failed:', err);
          alert('Invalid layout JSON: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [setNodes, setEdges]);

  // ─── Drag-and-drop from palette ──────────────────────────────────

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/reactflow');
    if (!raw) return;
    try {
      const item = JSON.parse(raw);
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      if (item.kind === 'shape') {
        addShapeAt(item.shapeType, position);
      } else if (item.kind === 'annotation') {
        addAnnotationAt(item.annotationType, position);
      } else if (item.kind === 'group') {
        addGroupAt(position);
      } else if (item.kind === 'device') {
        addDeviceAt(item.device, position);
      } else if (item.kind === 'glyph') {
        const family = GLYPH_FAMILY_MAP[item.glyphType] || null;
        setPickerOpen({ glyphType: item.glyphType, label: item.label, dropPosition: position, familyFilter: family });
      }
    } catch { /* ignore bad data */ }
  }, [screenToFlowPosition]);

  // ─── Element creation at position ────────────────────────────────

  const addShapeAt = useCallback((shapeType, position) => {
    const id = `shape-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const typeMap = { line: 'shape-line', rect: 'shape-rect', circle: 'shape-circle', arc: 'shape-arc' };
    const dataDefaults = {
      line: { width: 200, height: 4, color: '#22c55e', rotation: 0 },
      rect: { width: 120, height: 60, color: '#ff8800', fill: 'rgba(255,136,0,0.15)', label: '', rotation: 0 },
      circle: { size: 40, color: '#4488ff', fill: 'rgba(68,136,255,0.1)', label: '', rotation: 0 },
      arc: { width: 80, height: 60, color: '#4488ff', sweep: 0, rotation: 0 },
    };
    setNodes(nds => [...nds, {
      id, type: typeMap[shapeType] || 'shape-rect', position,
      data: { ...dataDefaults[shapeType] },
    }]);
    markDirty();
  }, [setNodes]);

  const addAnnotationAt = useCallback((annotationType, position) => {
    const id = `ann-${Date.now()}`;
    if (annotationType === 'beam') {
      setNodes(nds => [...nds, {
        id, type: 'annotation', position,
        data: { label: '', annotationType: 'beam', width: 200, rotation: 0 },
      }]);
    } else {
      const text = prompt('Enter label text:', 'Label');
      if (!text) return;
      setNodes(nds => [...nds, {
        id, type: 'annotation', position,
        data: { label: text, annotationType: 'label', fontSize: 14, color: '#aaa', rotation: 0 },
      }]);
    }
    markDirty();
  }, [setNodes]);

  const addGroupAt = useCallback((position) => {
    const label = prompt('Enter module name:', 'Module');
    if (!label) return;
    const id = `grp-${Date.now()}`;
    setNodes(nds => [...nds, {
      id, type: 'group', position,
      data: { label, width: 300, height: 200, shape: 'rounded', dashed: true },
      style: { zIndex: -1 },
    }]);
    markDirty();
  }, [setNodes]);

  const addDeviceAt = useCallback((dev, position) => {
    setNodes(nds => [...nds, {
      id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'device',
      position,
      data: {
        label: dev.name,
        sublabel: dev.iocName,
        family: dev.family,
        glyphType: dev.template || dev.family,
        devices: [{ id: dev.id, name: dev.name, pvPrefix: dev.pvPrefix, family: dev.family, iocName: dev.iocName }],
        width: 90, height: 60, rotation: 0,
      },
    }]);
    markDirty();
  }, [setNodes]);

  const handlePaletteClick = useCallback((glyphType, label) => {
    const family = GLYPH_FAMILY_MAP[glyphType] || null;
    setPickerOpen({ glyphType, label, dropPosition: null, familyFilter: family });
  }, []);

  const placeDeviceFromPicker = useCallback((dev) => {
    const pos = pickerOpen?.dropPosition || { x: 200 + Math.random() * 300, y: 150 + Math.random() * 200 };
    setNodes(nds => [...nds, {
      id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'device',
      position: pos,
      data: {
        label: dev.name,
        sublabel: dev.iocName,
        family: dev.family,
        glyphType: pickerOpen?.glyphType || dev.template || dev.family,
        devices: [{ id: dev.id, name: dev.name, pvPrefix: dev.pvPrefix, family: dev.family, iocName: dev.iocName }],
        width: 90, height: 60, rotation: 0,
      },
    }]);
    setPickerOpen(null);
    markDirty();
  }, [setNodes, pickerOpen]);

  const placeUnlinked = useCallback(() => {
    if (!pickerOpen) return;
    const id = `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const name = prompt('Enter element name:', pickerOpen.label);
    if (!name) { setPickerOpen(null); return; }
    const pos = pickerOpen.dropPosition || { x: 200 + Math.random() * 300, y: 150 + Math.random() * 200 };
    setNodes(nds => [...nds, {
      id, type: 'device', position: pos,
      data: {
        label: name,
        glyphType: pickerOpen.glyphType,
        devices: [],
        width: 90, height: 60, rotation: 0,
      },
    }]);
    setPickerOpen(null);
    markDirty();
  }, [setNodes, pickerOpen]);

  // ─── Delete + Rotate selected ────────────────────────────────────

  const deleteSelected = useCallback(() => {
    setNodes(nds => nds.filter(n => !n.selected));
    setEdges(eds => eds.filter(e => !e.selected));
    markDirty();
  }, [setNodes, setEdges]);

  const rotateSelected = useCallback((degrees) => {
    setNodes(nds => nds.map(n => {
      if (!n.selected) return n;
      const cur = n.data.rotation || 0;
      return { ...n, data: { ...n.data, rotation: (cur + degrees + 360) % 360 } };
    }));
    markDirty();
  }, [setNodes]);

  // ─── Right-click context menu ────────────────────────────────────

  const onNodeContextMenu = useCallback((event, node) => {
    if (!editMode) return;
    event.preventDefault();
    const selectedNodes = nodes.filter(n => n.selected);
    const isMulti = selectedNodes.length > 1;

    const items = [
      { icon: '✎', label: 'Edit Properties', action: () => setPropsNode(node) },
      { separator: true },
      { icon: '📋', label: isMulti ? `Copy (${selectedNodes.length})` : 'Copy', shortcut: '⌘C', action: () => handleCopy() },
      { icon: '✂', label: isMulti ? `Cut (${selectedNodes.length})` : 'Cut', shortcut: '⌘X', action: () => handleCut() },
      { icon: '📄', label: 'Paste', shortcut: '⌘V', action: () => handlePaste(), disabled: clipboard.length === 0 },
      { separator: true },
      { icon: '🗑', label: isMulti ? `Delete (${selectedNodes.length})` : 'Delete', shortcut: '⌫', action: () => deleteSelected() },
    ];

    if (node.parentId) {
      items.splice(1, 0, {
        icon: '↗', label: 'Remove from Module', action: () => {
          setNodes(nds => {
            const parent = nds.find(n => n.id === node.parentId);
            return nds.map(n => {
              if (n.id !== node.id) return n;
              const { parentId: _removed, ...rest } = n;
              return {
                ...rest,
                position: {
                  x: n.position.x + (parent?.position.x || 0),
                  y: n.position.y + (parent?.position.y || 0),
                },
              };
            });
          });
          markDirty();
        }
      });
    }

    setContextMenu({ x: event.clientX, y: event.clientY, items });
  }, [editMode, nodes, clipboard, handleCopy, handleCut, handlePaste, deleteSelected, setNodes]);

  const onPaneContextMenu = useCallback((event) => {
    if (!editMode) return;
    event.preventDefault();
    setContextMenu({
      x: event.clientX, y: event.clientY,
      items: [
        { icon: '📄', label: 'Paste', shortcut: '⌘V', action: () => handlePaste(), disabled: clipboard.length === 0 },
        { separator: true },
        { icon: '✓', label: 'Select All', shortcut: '⌘A', action: () => {
          setNodes(nds => nds.map(n => ({ ...n, selected: true })));
        }},
      ],
    });
  }, [editMode, clipboard, handlePaste, setNodes]);

  // ─── Node click → detail / props ─────────────────────────────────

  const onNodeClick = useCallback((_, node) => {
    if (!editMode) {
      if (node.type === 'device') {
        const devs = resolveDevices(node.data);
        // Try catalogue lookup first; fall back to synthesized device entries (pvPrefix on element)
        const resolved = devs.map(d => devices.find(dev => dev.id === d.id) || d).filter(d => d.pvPrefix || d.family);
        if (resolved.length > 0) setDetailDevices(resolved);
      } else if (node.type === 'group') {
        // Collect all device nodes that are children of this group
        const childDevNodes = nodes.filter(n => n.parentId === node.id && n.type === 'device');
        const allDevs = [];
        const seenIds = new Set();
        childDevNodes.forEach(n => {
          resolveDevices(n.data).forEach(d => {
            const full = devices.find(dev => dev.id === d.id) || d;
            if ((full.pvPrefix || full.family) && !seenIds.has(full.id)) { allDevs.push(full); seenIds.add(full.id); }
          });
        });
        if (allDevs.length > 0) setDetailDevices(allDevs);
      }
    }
  }, [editMode, devices, nodes]);

  const onNodeDoubleClick = useCallback((_, node) => {
    if (!editMode) {
      if (node.type === 'device') {
        const devs = resolveDevices(node.data);
        const resolved = devs.map(d => devices.find(dev => dev.id === d.id) || d).filter(d => d.pvPrefix || d.family);
        if (resolved.length > 0) { setDetailDevices(resolved); return; }
      }
    }
    if (editMode) {
      setPropsNode(node);
    }
  }, [devices, editMode]);

  const saveNodeProps = useCallback((newData) => {
    setNodes(nds => nds.map(n => n.id === propsNode.id ? { ...n, data: { ...n.data, ...newData } } : n));
    setPropsNode(null);
    markDirty();
  }, [propsNode, setNodes]);

  // ─── Computed ────────────────────────────────────────────────────

  const unplacedDevices = useMemo(() => {
    const placedIds = new Set();
    nodes.forEach(n => { resolveDevices(n.data).forEach(d => placedIds.add(d.id)); });
    let filtered = devices;
    if (selectedZone) filtered = filtered.filter(d => d.zone === selectedZone || d.allZones?.includes(selectedZone));
    return filtered.filter(d => !placedIds.has(d.id));
  }, [devices, nodes, selectedZone]);

  const paletteByCategory = useMemo(() => {
    const map = {};
    GLYPH_TYPES.forEach(g => {
      const cat = g.category || 'other';
      if (!map[cat]) map[cat] = [];
      map[cat].push(g);
    });
    customGlyphs.forEach(g => {
      const cat = g.category || 'other';
      if (!map[cat]) map[cat] = [];
      map[cat].push({ type: g.type, label: g.label, icon: g.icon || '🎨', category: g.category });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customGlyphVersion]);

  const startDrag = (e, data) => {
    e.dataTransfer.setData('application/reactflow', JSON.stringify(data));
    e.dataTransfer.effectAllowed = 'move';
  };

  // ─── Render ──────────────────────────────────────────────────────

  const containerClass = `bll-container${schematicView ? ' bll-container--schematic' : ''}`;

  return (
    <div className={containerClass}>
      {/* Toolbar */}
      <div className="bll-toolbar">
        <div className="bll-toolbar-left">
          <button className="toolbar-btn" onClick={() => setLayoutManagerOpen(true)} title="Manage layouts">
            📐 {currentLayout || 'No layout'}
          </button>
          {/* Layout navigation in view mode */}
          {!editMode && availableLayouts.length > 1 && (
            <div className="bll-layout-nav">
              {availableLayouts.map(l => (
                <button key={l.name}
                  className={`bll-layout-nav-btn${l.name === currentLayout ? ' active' : ''}`}
                  onClick={() => handleLoadLayout(l.name)}>
                  {l.name}
                </button>
              ))}
            </div>
          )}
          <select className="filter-select" value={selectedZone} onChange={e => setSelectedZone(e.target.value)}>
            <option value="">All zones</option>
            {zones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <button className={`toolbar-btn ${editMode ? 'active' : ''}`} onClick={() => setEditMode(e => !e)}>
            {editMode ? '🔒 Lock' : '🔓 Edit'}
          </button>
          {editMode && (
            <button className={`toolbar-btn ${showPalette ? 'active' : ''}`} onClick={() => setShowPalette(s => !s)}>
              🎨 Palette
            </button>
          )}
          {!editMode && (
            <button className={`toolbar-btn ${schematicView ? 'active' : ''}`}
              onClick={() => setSchematicView(s => !s)} title="Schematic view (SVG only)">
              🔬 Schematic
            </button>
          )}
        </div>
        <div className="bll-toolbar-right">
          {editMode && (
            <>
              <button className="bl-btn bl-btn--sm" onClick={deleteSelected} title="Delete selected">🗑 Delete</button>
              <button className="bl-btn bl-btn--sm" onClick={() => rotateSelected(90)} title="Rotate +90°">↻ Rotate</button>
              <button className="bl-btn bl-btn--sm" onClick={handleCopy} title="Copy selected">📋 Copy</button>
              <button className="bl-btn bl-btn--sm" onClick={handlePaste} title="Paste" disabled={clipboard.length === 0}>📄 Paste</button>
              <button className="bl-btn bl-btn--sm" onClick={() => setCustomGlyphModalOpen(true)} title="Manage custom glyphs">🎨 Custom</button>
            </>
          )}
          <button className="bl-btn bl-btn--sm" onClick={handleImport} title="Import layout">📥 Import</button>
          <button className="bl-btn bl-btn--sm" onClick={handleExport} title="Export layout">📤 Export</button>
          {canSync && (
            <button className="bl-btn bl-btn--sm" onClick={handleSyncToGit} disabled={syncing || !currentLayout || !canWrite}
              title={canWrite ? 'Push layout to git repository' : 'Login with a PAT in Settings to push to git'}>
              {syncing ? '⏳' : '☁️'} Sync
            </button>
          )}
          {canSync && (
            <button className="bl-btn bl-btn--sm" onClick={async () => { await refreshGitLayouts(); setLayoutManagerOpen(true); }}
              title="Load layout from git repository">
              ☁️ Load
            </button>
          )}
          <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleSave} disabled={!dirty}>
            💾 Save{dirty ? ' *' : ''}
          </button>
        </div>
      </div>

      <div className="bll-main" ref={reactFlowWrapper}>
        {/* Palette sidebar */}
        {editMode && showPalette && (
          <div className="bll-palette">
            {/* Drawing shapes */}
            <div className="bll-palette-section">
              <div className="bll-palette-title" onClick={() => toggleSection('shapes')}>
                {collapsedSections.shapes ? '▸' : '▾'} Shapes
              </div>
              {!collapsedSections.shapes && (
                <div className="bll-palette-grid">
                  <button className="bll-palette-item" draggable
                    onDragStart={e => startDrag(e, { kind: 'shape', shapeType: 'line' })}
                    onClick={() => addShapeAt('line', { x: 200, y: 200 })} title="Line">
                    <svg width="24" height="16"><line x1="2" y1="8" x2="22" y2="8" stroke="#22c55e" strokeWidth="3"/></svg>
                    <span className="bll-palette-label">Line</span>
                  </button>
                  <button className="bll-palette-item" draggable
                    onDragStart={e => startDrag(e, { kind: 'shape', shapeType: 'rect' })}
                    onClick={() => addShapeAt('rect', { x: 200, y: 200 })} title="Rectangle">
                    <svg width="24" height="18"><rect x="1" y="1" width="22" height="16" rx="2" fill="rgba(255,136,0,0.15)" stroke="#ff8800" strokeWidth="1.5"/></svg>
                    <span className="bll-palette-label">Rectangle</span>
                  </button>
                  <button className="bll-palette-item" draggable
                    onDragStart={e => startDrag(e, { kind: 'shape', shapeType: 'circle' })}
                    onClick={() => addShapeAt('circle', { x: 200, y: 200 })} title="Circle">
                    <svg width="22" height="22"><circle cx="11" cy="11" r="9" fill="rgba(68,136,255,0.1)" stroke="#4488ff" strokeWidth="1.5"/></svg>
                    <span className="bll-palette-label">Circle</span>
                  </button>
                  <button className="bll-palette-item" draggable
                    onDragStart={e => startDrag(e, { kind: 'shape', shapeType: 'arc' })}
                    onClick={() => addShapeAt('arc', { x: 200, y: 200 })} title="Arc">
                    <svg width="24" height="18"><path d="M2,16 Q12,0 22,16" fill="none" stroke="#4488ff" strokeWidth="1.5"/></svg>
                    <span className="bll-palette-label">Arc</span>
                  </button>
                </div>
              )}
            </div>

            {/* Annotations & Modules */}
            <div className="bll-palette-section">
              <div className="bll-palette-title" onClick={() => toggleSection('annotations')}>
                {collapsedSections.annotations ? '▸' : '▾'} Annotations
              </div>
              {!collapsedSections.annotations && (
                <div className="bll-palette-grid">
                  <button className="bll-palette-item" draggable
                    onDragStart={e => startDrag(e, { kind: 'annotation', annotationType: 'label' })}
                    onClick={() => addAnnotationAt('label', { x: 200, y: 100 })}>
                    <span className="bll-palette-icon">🏷</span>
                    <span className="bll-palette-label">Label</span>
                  </button>
                  <button className="bll-palette-item" draggable
                    onDragStart={e => startDrag(e, { kind: 'annotation', annotationType: 'beam' })}
                    onClick={() => addAnnotationAt('beam', { x: 200, y: 200 })}>
                    <span className="bll-palette-icon">→</span>
                    <span className="bll-palette-label">Beam</span>
                  </button>
                  <button className="bll-palette-item" draggable
                    onDragStart={e => startDrag(e, { kind: 'group' })}
                    onClick={() => addGroupAt({ x: 100, y: 100 })}>
                    <span className="bll-palette-icon">▢</span>
                    <span className="bll-palette-label">Module</span>
                  </button>
                </div>
              )}
            </div>

            {/* Component categories */}
            {PALETTE_CATEGORIES.map(cat => {
              const items = paletteByCategory[cat.key];
              if (!items?.length) return null;
              const isCollapsed = collapsedSections[cat.key];
              return (
                <div key={cat.key} className="bll-palette-section">
                  <div className="bll-palette-title" onClick={() => toggleSection(cat.key)}>
                    {isCollapsed ? '▸' : '▾'} {cat.label}
                  </div>
                  {!isCollapsed && (
                    <div className="bll-palette-grid">
                      {items.map(g => (
                        <button key={g.type} className="bll-palette-item" draggable
                          onDragStart={e => startDrag(e, { kind: 'glyph', glyphType: g.type, label: g.label })}
                          onClick={() => handlePaletteClick(g.type, g.label)} title={g.label}>
                          <span className="bll-palette-icon">{g.icon}</span>
                          <span className="bll-palette-label">{g.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Unplaced config devices */}
            {unplacedDevices.length > 0 && (
              <div className="bll-palette-section">
                <div className="bll-palette-title" onClick={() => toggleSection('devices')}>
                  {collapsedSections.devices ? '▸' : '▾'} Config Devices ({unplacedDevices.length})
                </div>
                {!collapsedSections.devices && (
                  <div className="bll-palette-devlist">
                    {unplacedDevices.slice(0, 50).map(dev => (
                      <button key={dev.id} className="bll-palette-dev" draggable
                        onDragStart={e => startDrag(e, { kind: 'device', device: { id: dev.id, name: dev.name, iocName: dev.iocName, family: dev.family, template: dev.template, pvPrefix: dev.pvPrefix, zone: dev.zone } })}
                        onClick={() => addDeviceAt(dev, { x: 200 + Math.random() * 300, y: 150 + Math.random() * 200 })}
                        title={`${dev.pvPrefix} (${dev.family})`}>
                        <span className="bll-palette-dev-icon">
                          {dev.family === 'cam' ? '📷' : dev.family === 'mot' ? '⚙' : dev.family === 'bpm' ? '◎' : '🔧'}
                        </span>
                        <span className="bll-palette-dev-name">{dev.name}</span>
                      </button>
                    ))}
                    {unplacedDevices.length > 50 && <span className="bll-palette-more">+{unplacedDevices.length - 50} more</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* React Flow canvas */}
        <div className="bll-canvas" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={editMode ? onNodesChange : undefined}
            onEdgesChange={editMode ? onEdgesChange : undefined}
            onConnect={editMode ? onConnect : undefined}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeContextMenu={onNodeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            onPaneClick={() => setContextMenu(null)}
            nodeTypes={nodeTypes}
            nodesDraggable={editMode}
            nodesConnectable={editMode}
            elementsSelectable={editMode}
            selectionOnDrag={editMode}
            panOnDrag={editMode ? [1, 2] : true}
            selectionMode="partial"
            fitView
            snapToGrid
            snapGrid={[10, 10]}
            deleteKeyCode={null}
            attributionPosition="bottom-left"
          >
            <Background color="#333" gap={20} size={1} />
            <Controls />
            <MiniMap
              nodeColor={node => {
                if (node.type === 'group') return '#333';
                if (node.type?.startsWith('shape-')) return '#666';
                const cat = getCategoryForGlyph(node.data?.glyphType);
                return CATEGORY_COLORS[cat]?.border || '#4488ff';
              }}
              style={{ background: '#111' }}
            />
            <Panel position="top-right">
              <div className="bll-legend">
                {Object.entries(STATUS_COLORS).map(([key, color]) => (
                  <span key={key} className="bll-legend-item">
                    <span className="bll-legend-dot" style={{ background: color }} />
                    {key}
                  </span>
                ))}
              </div>
            </Panel>
            {nodes.length === 0 && (
              <Panel position="top-center">
                <div className="bll-empty-hint">
                  {currentLayout
                    ? 'Drag elements from the palette or click to add'
                    : 'Open Layout Manager (📐) to create or load a layout'}
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items}
          onClose={() => setContextMenu(null)} />
      )}

      {/* Layout Manager Modal */}
      {layoutManagerOpen && (
        <LayoutManagerModal beamline={beamline} currentLayout={currentLayout}
          onLoad={handleLoadLayout} onNew={handleNewLayout}
          onClose={() => setLayoutManagerOpen(false)}
          gitLayouts={gitLayouts} onLoadFromGit={handleLoadFromGit} />
      )}

      {/* Device picker modal */}
      {pickerOpen && (
        <DevicePickerModal devices={devices} glyphType={pickerOpen.glyphType}
          familyFilter={pickerOpen.familyFilter}
          onSelect={placeDeviceFromPicker} onSkip={placeUnlinked}
          onCancel={() => setPickerOpen(null)} />
      )}

      {/* Node properties modal */}
      {propsNode && (
        <NodePropsModal node={propsNode} allDevices={devices} allNodes={nodes}
          onSave={saveNodeProps} onCancel={() => setPropsNode(null)} />
      )}

      {/* Custom glyph modal */}
      {customGlyphModalOpen && (
        <CustomGlyphModal onClose={() => setCustomGlyphModalOpen(false)}
          onSave={() => setCustomGlyphVersion(v => v + 1)} />
      )}

      {/* Multi-device detail modal */}
      {detailDevices && (
        <div className="widget-modal-overlay" onClick={() => setDetailDevices(null)}>
          <div className="widget-modal bll-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="widget-modal-header">
              <span className="widget-title">
                {detailDevices.length === 1 ? detailDevices[0].name : `${detailDevices.length} Devices`}
              </span>
              <button className="widget-btn" onClick={() => setDetailDevices(null)}>✕</button>
            </div>
            <div className="widget-modal-body bll-detail-devices">
              {detailDevices.map(dev => (
                <div key={dev.id} className="bll-detail-device-section">
                  {detailDevices.length > 1 && <h4 className="bll-detail-device-title">{dev.name}</h4>}
                  <DeviceDetail device={dev} client={pvwsClient} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Exported Component ─────────────────────────────────────────────────

export default function BeamlineLayout() {
  return (
    <ReactFlowProvider>
      <LayoutEditor />
    </ReactFlowProvider>
  );
}

// ─── Device Detail Widget ───────────────────────────────────────────────

function DeviceDetail({ device, client }) {
  const widgetType = deviceToWidgetType(device);
  const Component = getWidgetComponent(widgetType, device);
  const config = {
    ...deviceToWidgetConfig(device),
    viewMode: 'detail',
  };
  const widget = { id: `detail-${device.id}`, type: widgetType, config };

  return (
    <WidgetFrame widget={widget} editMode={false} client={client}>
      <Component config={config} client={client} />
    </WidgetFrame>
  );
}
