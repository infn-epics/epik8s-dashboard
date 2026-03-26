import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import DashboardGrid from '../layout/DashboardGrid.jsx';
import { useLayout } from '../../hooks/useLayout.js';
import { getWidgetComponent as getWidgetComp, deviceToWidgetType } from '../../widgets/registry.js';
import WidgetFrame from '../../widgets/WidgetFrame.jsx';
import { deviceToWidgetConfig } from '../../models/dashboard.js';
import { groupDevicesBy } from '../../models/device.js';
import BeamlineEditor from './BeamlineEditor.jsx';
import BeamlineLayout from './BeamlineLayout.jsx';
import RoleGuard from '../common/RoleGuard.jsx';

const FAMILY_ICONS = { cam: '📷', mot: '⚙', bpm: '📡', mag: '🧲', vac: '💨', generic: '🔧' };
const FAMILY_COLORS = { cam: '#3b82f6', mot: '#f59e0b', bpm: '#10b981', mag: '#8b5cf6', vac: '#ec4899', generic: '#6b7280' };

/**
 * BeamlineView - Zone-based beamline overview.
 * Summary cards + expandable widget grids.
 */
export default function BeamlineView() {
  const { devices, zones, pvwsClient } = useApp();
  const [editMode, setEditMode] = useState(false);
  const [selectedZone, setSelectedZone] = useState('');
  const [viewMode, setViewMode] = useState('summary');

  const grouped = useMemo(() => groupDevicesBy(devices, 'zone'), [devices]);
  const allZones = zones.length > 0 ? zones : Object.keys(grouped);
  const displayZones = selectedZone ? [selectedZone] : allZones;

  return (
    <div className="beamline-view">
      <div className="view-toolbar">
        <span className="view-toolbar-title">Beamline Overview</span>
        <div className="toolbar-controls">
          {viewMode !== 'editor' && viewMode !== 'layout' && (
            <select className="filter-select" value={selectedZone} onChange={(e) => setSelectedZone(e.target.value)}>
              <option value="">All zones ({allZones.length})</option>
              {allZones.map((z) => (
                <option key={z} value={z}>{z} ({(grouped[z] || []).length})</option>
              ))}
            </select>
          )}
          <div className="toolbar-toggle-group">
            <button className={`toolbar-btn ${viewMode === 'summary' ? 'active' : ''}`} onClick={() => setViewMode('summary')}>≡ Summary</button>
            <button className={`toolbar-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>⊞ Widgets</button>
            <button className={`toolbar-btn ${viewMode === 'layout' ? 'active' : ''}`} onClick={() => setViewMode('layout')}>🗺 Layout</button>
            <RoleGuard require="operator">
              <button className={`toolbar-btn ${viewMode === 'editor' ? 'active' : ''}`} onClick={() => setViewMode('editor')}>📝 Editor</button>
            </RoleGuard>
          </div>
          {viewMode === 'grid' && (
            <RoleGuard require="operator">
              <button className={`toolbar-btn ${editMode ? 'active' : ''}`} onClick={() => setEditMode((e) => !e)}>
                {editMode ? '🔒 Lock' : '🔓 Edit'}
              </button>
            </RoleGuard>
          )}
        </div>
      </div>

      {viewMode === 'editor' ? (
        <BeamlineEditor />
      ) : viewMode === 'layout' ? (
        <BeamlineLayout />
      ) : (
        <div className="view-content beamline-zones">
          {displayZones.map((zone) => {
            const zoneDevices = grouped[zone] || [];
            if (zoneDevices.length === 0) return null;
            return viewMode === 'summary' ? (
              <ZoneSummaryCard key={zone} zone={zone} devices={zoneDevices} onSelectZone={() => { setSelectedZone(zone); setViewMode('grid'); }} />
            ) : (
              <ZoneGridSection key={zone} zone={zone} devices={zoneDevices} client={pvwsClient} editMode={editMode} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ZoneSummaryCard({ zone, devices, onSelectZone }) {
  const byFamily = useMemo(() => groupDevicesBy(devices, 'family'), [devices]);
  const iocNames = useMemo(() => [...new Set(devices.map((d) => d.iocName))], [devices]);

  return (
    <div className="zone-card" onClick={onSelectZone}>
      <div className="zone-card-header">
        <span className="zone-card-name">{zone}</span>
        <span className="zone-card-count">{devices.length} devices</span>
        <span className="zone-card-arrow">›</span>
      </div>
      <div className="zone-card-families">
        {Object.entries(byFamily).map(([family, devs]) => (
          <span key={family} className="zone-family-badge" style={{ '--badge-color': FAMILY_COLORS[family] || FAMILY_COLORS.generic }}>
            {FAMILY_ICONS[family] || '🔧'} {family} × {devs.length}
          </span>
        ))}
      </div>
      <div className="zone-card-devices">
        {devices.slice(0, 8).map((d) => (
          <span key={d.id} className="zone-device-pill" style={{ borderColor: FAMILY_COLORS[d.family] || FAMILY_COLORS.generic }}>{d.name}</span>
        ))}
        {devices.length > 8 && <span className="zone-device-pill zone-device-pill--more">+{devices.length - 8} more</span>}
      </div>
      <div className="zone-card-iocs">
        <span className="zone-card-ioc-label">IOCs:</span>
        {iocNames.map((n) => <span key={n} className="zone-ioc-tag">{n}</span>)}
      </div>
    </div>
  );
}

function ZoneGridSection({ zone, devices, client, editMode }) {
  const { layout, onLayoutChange, resetLayout } = useLayout('beamline', zone, devices, 12);
  const byFamily = useMemo(() => groupDevicesBy(devices, 'family'), [devices]);

  return (
    <div className="zone-section">
      <div className="zone-header">
        <h3 className="zone-title">{zone}</h3>
        <div className="zone-header-badges">
          {Object.entries(byFamily).map(([family, devs]) => (
            <span key={family} className="zone-family-badge zone-family-badge--small" style={{ '--badge-color': FAMILY_COLORS[family] || FAMILY_COLORS.generic }}>
              {FAMILY_ICONS[family] || '🔧'} {devs.length}
            </span>
          ))}
        </div>
        <span className="zone-count">{devices.length} device(s)</span>
        <button className="toolbar-btn toolbar-btn--small" onClick={resetLayout} title="Reset layout">↻</button>
      </div>
      <DashboardGrid layout={layout} onLayoutChange={onLayoutChange} isDraggable={editMode} isResizable={editMode} rowHeight={50}>
        {devices.map((device) => {
          const widgetType = deviceToWidgetType(device);
            const Component = getWidgetComp(widgetType, device);
          const config = deviceToWidgetConfig(device);
          const widget = { id: device.id, type: widgetType, config };
          return (
            <div key={device.id}>
              <WidgetFrame widget={widget} editMode={editMode} client={client}>
                <Component config={config} client={client} />
              </WidgetFrame>
            </div>
          );
        })}
      </DashboardGrid>
    </div>
  );
}
