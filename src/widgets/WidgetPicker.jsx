import { useState, useMemo } from 'react';
import { getWidgetTypesByCategory, getDefaultConfig, CATEGORY_ORDER, deviceToWidgetType } from './registry.js';
import { deviceToWidgetConfig } from '../models/dashboard.js';

/**
 * WidgetPicker — modal dialog for browsing widget types and adding one.
 *
 * Two tabs:
 *  - Widget Types: browsable by Phoebus-like categories (Basic, Numeric, Plot, Devices)
 *  - From Config: picks from YAML-discovered devices. PV fields are pre-filled.
 *
 * Props:
 *  - onAdd: (type, config) => void
 *  - onClose: () => void
 *  - devices: optional device list for quick-add from YAML
 */
export default function WidgetPicker({ onAdd, onClose, devices = [] }) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('types');
  const categories = getWidgetTypesByCategory();

  const filteredCategories = useMemo(() => {
    const result = {};
    for (const cat of CATEGORY_ORDER) {
      const types = categories[cat] || [];
      const filtered = types.filter(
        (t) => !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.description.toLowerCase().includes(search.toLowerCase()),
      );
      if (filtered.length > 0) result[cat] = filtered;
    }
    return result;
  }, [categories, search]);

  const filteredDevices = useMemo(() =>
    devices.filter(
      (d) => !search ||
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        d.pvPrefix.toLowerCase().includes(search.toLowerCase()) ||
        d.iocName.toLowerCase().includes(search.toLowerCase()),
    ),
    [devices, search],
  );

  const handleSelectType = (type) => {
    const config = getDefaultConfig(type);
    onAdd(type, config);
    onClose();
  };

  const handleSelectDevice = (device) => {
    const type = deviceToWidgetType(device);
    const config = deviceToWidgetConfig(device);
    onAdd(type, config);
    onClose();
  };

  const FAMILY_ICONS = { cam: '📷', mot: '⚙', bpm: '📡', vac: '💨', mag: '⚡' };

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <h3>Add Widget</h3>
          <button className="picker-close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="picker-tabs">
          <button className={`picker-tab ${tab === 'types' ? 'picker-tab--active' : ''}`} onClick={() => setTab('types')}>
            Widget Types
          </button>
          {devices.length > 0 && (
            <button className={`picker-tab ${tab === 'devices' ? 'picker-tab--active' : ''}`} onClick={() => setTab('devices')}>
              From Config ({devices.length})
            </button>
          )}
        </div>

        {/* Search */}
        <div className="picker-search">
          <input
            type="text"
            placeholder={tab === 'types' ? 'Search widgets…' : 'Search devices…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        {/* Content */}
        <div className="picker-body">
          {tab === 'types' ? (
            Object.entries(filteredCategories).map(([cat, types]) => (
              <div key={cat} className="picker-category">
                <div className="picker-category-title">{cat}</div>
                <div className="picker-grid">
                  {types.map((wt) => (
                    <button key={wt.type} className="picker-card" onClick={() => handleSelectType(wt.type)}>
                      <span className="picker-card-icon">{wt.icon}</span>
                      <span className="picker-card-name">{wt.name}</span>
                      <span className="picker-card-desc">{wt.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="picker-device-list">
              {filteredDevices.length === 0 ? (
                <div className="picker-empty">No devices match</div>
              ) : (
                filteredDevices.map((dev) => (
                  <button key={dev.id} className="picker-device-item" onClick={() => handleSelectDevice(dev)}>
                    <span className="picker-device-icon">
                      {FAMILY_ICONS[dev.family] || '🔧'}
                    </span>
                    <div className="picker-device-info">
                      <span className="picker-device-name">{dev.name}</span>
                      <span className="picker-device-pv">{dev.pvPrefix}</span>
                    </div>
                    <span className="picker-device-family">{dev.family}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
