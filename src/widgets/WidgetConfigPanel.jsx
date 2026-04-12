import { useState, useMemo, useRef, useEffect } from 'react';
import { getWidgetType, getWidgetTypes, getDefaultConfig, CATEGORY_ORDER } from './registry.js';
import { useApp } from '../context/AppContext.jsx';

/**
 * WidgetConfigPanel — Phoebus-like property editor for a widget instance.
 *
 * Features:
 *  - Groups properties by group (General, PV, Style, Widget, Macros, Data)
 *  - PV name fields get autocomplete from YAML-discovered devices
 *  - Renders appropriate controls per property type
 *
 * Props:
 *  - widget: { id, type, config }
 *  - onSave: (widgetId, newConfig) => void
 *  - onReplace: (widgetId, newType, newConfig) => void
 *  - onClose: () => void
 */
export default function WidgetConfigPanel({ widget, onSave, onReplace, onClose }) {
  const typeDef = getWidgetType(widget.type);
  const widgetTypes = useMemo(() => getWidgetTypes(), []);
  const [targetType, setTargetType] = useState(widget.type);
  const [config, setConfig] = useState({ ...widget.config });
  const { devices } = useApp();

  useEffect(() => {
    setTargetType(widget.type);
    setConfig({ ...widget.config });
  }, [widget]);

  // Build PV name suggestions from devices
  const pvSuggestions = useMemo(() => {
    if (!devices || devices.length === 0) return [];
    const suggestions = [];
    for (const d of devices) {
      if (d.pvPrefix) {
        suggestions.push({ label: `${d.name} (${d.family})`, value: d.pvPrefix, family: d.family, streamUrl: d.streamUrl || '' });
      }
    }
    return suggestions;
  }, [devices]);

  if (!typeDef) return null;

  const setProp = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  // When a device is selected from autocomplete for pvPrefix, also auto-fill related fields
  const handlePvSelect = (key, value, suggestion) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-fill streamUrl for camera widgets
      if (key === 'pvPrefix' && suggestion?.streamUrl && typeDef.family === 'cam') {
        next.streamUrl = suggestion.streamUrl;
      }
      return next;
    });
  };

  const handleSave = () => {
    onSave(widget.id, config);
    onClose();
  };

  const handleReplace = () => {
    if (!onReplace || !targetType || targetType === widget.type) return;
    const mergedConfig = buildCompatibleConfig(widget.type, targetType, config);
    onReplace(widget.id, targetType, mergedConfig);
  };

  // Group properties
  const groups = useMemo(() => {
    const g = {};
    for (const prop of typeDef.properties) {
      const group = prop.group || 'Other';
      if (!g[group]) g[group] = [];
      g[group].push(prop);
    }
    return g;
  }, [typeDef]);

  const groupOrder = ['General', 'PV', 'Device', 'Widget', 'Data', 'Style', 'Macros', 'Other'];

  return (
    <div className="config-panel-overlay" onClick={onClose}>
      <div className="config-panel" onClick={(e) => e.stopPropagation()}>
        <div className="config-panel-header">
          <span>{typeDef.icon} {typeDef.name}</span>
          <button className="widget-btn" onClick={onClose}>✕</button>
        </div>

        <div className="config-panel-body">
          {/* Widget type info */}
          <div className="config-type-info">
            <span className="config-type-badge">{typeDef.icon} {typeDef.name}</span>
            <span className="config-type-cat">{typeDef.category}</span>
          </div>
          <div className="config-replace-row">
            <label className="config-label">Replace with</label>
            <div className="config-replace-controls">
              <select
                className="config-input"
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
              >
                {CATEGORY_ORDER.map((category) => {
                  const typesInCategory = widgetTypes.filter((wt) => wt.category === category);
                  if (typesInCategory.length === 0) return null;
                  return (
                    <optgroup key={category} label={category}>
                      {typesInCategory.map((wt) => (
                        <option key={wt.type} value={wt.type}>
                          {wt.icon} {wt.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              <button
                className="btn"
                onClick={handleReplace}
                disabled={!onReplace || targetType === widget.type}
                title="Replace widget type and keep compatible properties"
              >
                Replace Type
              </button>
            </div>
          </div>
          {typeDef.description && (
            <div className="config-description">{typeDef.description}</div>
          )}

          {/* Property groups */}
          {groupOrder.filter(g => groups[g]).map((groupName) => (
            <PropertyGroup key={groupName} name={groupName}>
              {groups[groupName].map((prop) => (
                <PropertyField
                  key={prop.key}
                  prop={prop}
                  value={config[prop.key]}
                  onChange={(v) => setProp(prop.key, v)}
                  onPvSelect={(v, suggestion) => handlePvSelect(prop.key, v, suggestion)}
                  pvSuggestions={prop.type === 'pv' ? pvSuggestions : null}
                  widgetFamily={typeDef.family || widget.config?.family}
                />
              ))}
            </PropertyGroup>
          ))}
        </div>

        <div className="config-panel-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

function buildCompatibleConfig(sourceType, targetType, currentConfig) {
  const targetDef = getWidgetType(targetType);
  if (!targetDef) return { ...currentConfig };

  const defaultTargetConfig = getDefaultConfig(targetType);
  const allowedKeys = new Set((targetDef.properties || []).map((p) => p.key));

  const compatible = {};
  for (const [key, value] of Object.entries(currentConfig || {})) {
    if (allowedKeys.has(key) && value !== undefined) {
      compatible[key] = value;
    }
  }

  // Keep user-facing title/tooltip when present in target schema.
  if (allowedKeys.has('title') && currentConfig?.title) compatible.title = currentConfig.title;
  if (allowedKeys.has('tooltip') && currentConfig?.tooltip) compatible.tooltip = currentConfig.tooltip;

  // Typical PV mapping fallback between single PV and prefix-based widgets.
  if (allowedKeys.has('pv_name') && !compatible.pv_name && currentConfig?.pvPrefix) {
    compatible.pv_name = currentConfig.pvPrefix;
  }
  if (allowedKeys.has('pvPrefix') && !compatible.pvPrefix && currentConfig?.pv_name) {
    compatible.pvPrefix = currentConfig.pv_name;
  }

  // Preserve source widget type metadata if the target supports it.
  if (allowedKeys.has('type') && sourceType) {
    compatible.type = currentConfig?.type || sourceType;
  }

  return {
    ...defaultTargetConfig,
    ...compatible,
  };
}

/** Collapsible property group */
function PropertyGroup({ name, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="config-group">
      <button className="config-group-header" onClick={() => setOpen(o => !o)}>
        <span className="config-group-arrow">{open ? '▾' : '▸'}</span>
        <span className="config-group-title">{name}</span>
      </button>
      {open && <div className="config-group-body">{children}</div>}
    </div>
  );
}

/** Render a single property field based on its type. */
function PropertyField({ prop, value, onChange, onPvSelect, pvSuggestions, widgetFamily }) {
  const val = value ?? prop.default ?? '';

  switch (prop.type) {
    case 'pv':
      return (
        <div className="config-field">
          <label className="config-label">
            {prop.label}
            {prop.required && <span className="config-required">*</span>}
          </label>
          <PvInput
            value={val}
            onChange={onChange}
            onSelect={onPvSelect}
            suggestions={pvSuggestions || []}
            widgetFamily={widgetFamily}
            placeholder={prop.placeholder || 'IOC:DEVICE:Signal'}
          />
        </div>
      );

    case 'string':
      return (
        <div className="config-field">
          <label className="config-label">
            {prop.label}
            {prop.required && <span className="config-required">*</span>}
          </label>
          <input
            type="text"
            className="config-input"
            value={val}
            onChange={(e) => onChange(e.target.value)}
            placeholder={prop.placeholder || ''}
          />
        </div>
      );

    case 'text':
      return (
        <div className="config-field">
          <label className="config-label">{prop.label}</label>
          <textarea
            className="config-input config-textarea"
            value={val}
            onChange={(e) => onChange(e.target.value)}
            placeholder={prop.placeholder || ''}
            rows={4}
          />
        </div>
      );

    case 'number':
      return (
        <div className="config-field">
          <label className="config-label">{prop.label}</label>
          <input
            type="number"
            className="config-input"
            value={val}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            min={prop.min}
            max={prop.max}
            step={prop.step || 'any'}
          />
        </div>
      );

    case 'boolean':
      return (
        <div className="config-field config-field--inline">
          <label className="config-label">{prop.label}</label>
          <input
            type="checkbox"
            className="config-checkbox"
            checked={!!val}
            onChange={(e) => onChange(e.target.checked)}
          />
        </div>
      );

    case 'select':
      return (
        <div className="config-field">
          <label className="config-label">{prop.label}</label>
          <select
            className="config-input"
            value={val}
            onChange={(e) => onChange(e.target.value)}
          >
            {(prop.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );

    case 'color':
      return (
        <div className="config-field config-field--inline">
          <label className="config-label">{prop.label}</label>
          <div className="config-color-row">
            <input
              type="color"
              className="config-color"
              value={val || '#ffffff'}
              onChange={(e) => onChange(e.target.value)}
            />
            <input
              type="text"
              className="config-input config-color-text"
              value={val}
              onChange={(e) => onChange(e.target.value)}
              placeholder="#ffffff"
            />
          </div>
        </div>
      );

    default:
      return (
        <div className="config-field">
          <label className="config-label">{prop.label}</label>
          <input
            type="text"
            className="config-input"
            value={String(val)}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
  }
}

/**
 * PvInput — Text input with autocomplete dropdown from YAML devices.
 * Filters suggestions by typed text and optionally prioritizes matching device family.
 */
function PvInput({ value, onChange, onSelect, suggestions, widgetFamily, placeholder }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState('');
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    const q = (filter || value || '').toLowerCase();
    let result = suggestions;
    if (q) {
      result = suggestions.filter(s =>
        s.value.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)
      );
    }
    // Sort: matching family first
    if (widgetFamily) {
      result = [...result].sort((a, b) => {
        const aMatch = a.family === widgetFamily ? 0 : 1;
        const bMatch = b.family === widgetFamily ? 0 : 1;
        return aMatch - bMatch;
      });
    }
    return result.slice(0, 20);
  }, [suggestions, filter, value, widgetFamily]);

  return (
    <div className="pv-input-wrapper">
      <input
        ref={inputRef}
        type="text"
        className="config-input config-input--pv"
        value={value || ''}
        onChange={(e) => { onChange(e.target.value); setFilter(e.target.value); }}
        onFocus={() => setShowDropdown(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      <span className="pv-input-icon" title="PV name">⚡</span>
      {showDropdown && filtered.length > 0 && (
        <div ref={dropdownRef} className="pv-autocomplete">
          {filtered.map((s) => (
            <button
              key={s.value}
              className={`pv-autocomplete-item ${s.family === widgetFamily ? 'pv-autocomplete-item--match' : ''}`}
              onClick={() => { onSelect ? onSelect(s.value, s) : onChange(s.value); setShowDropdown(false); }}
            >
              <span className="pv-ac-label">{s.label}</span>
              <span className="pv-ac-value">{s.value}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
