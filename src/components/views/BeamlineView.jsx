import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import DashboardGrid from '../layout/DashboardGrid.jsx';
import { useLayout } from '../../hooks/useLayout.js';
import { getWidgetComponent, widgetSizeMap } from '../widgets/WidgetRegistry.js';
import { groupDevicesBy } from '../../models/device.js';

/**
 * BeamlineView - Zone-based device layout.
 * Groups all devices by zone and renders each zone as a labeled section
 * with a drag/drop/resize grid.
 */
export default function BeamlineView() {
  const { devices, zones, pvwsClient } = useApp();
  const [editMode, setEditMode] = useState(false);
  const [selectedZone, setSelectedZone] = useState('');

  const grouped = useMemo(() => groupDevicesBy(devices, 'zone'), [devices]);

  // Determine which zones to show
  const displayZones = selectedZone
    ? [selectedZone]
    : zones.length > 0
    ? zones
    : Object.keys(grouped);

  return (
    <div className="beamline-view">
      <div className="view-toolbar">
        <span className="view-toolbar-title">Beamline Overview</span>
        <div className="toolbar-controls">
          <select
            className="filter-select"
            value={selectedZone}
            onChange={(e) => setSelectedZone(e.target.value)}
          >
            <option value="">All zones</option>
            {(zones.length > 0 ? zones : Object.keys(grouped)).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <button
            className={`toolbar-btn ${editMode ? 'active' : ''}`}
            onClick={() => setEditMode((e) => !e)}
          >
            {editMode ? '🔒 Lock' : '🔓 Edit'}
          </button>
        </div>
      </div>

      <div className="view-content beamline-zones">
        {displayZones.map((zone) => {
          const zoneDevices = grouped[zone] || [];
          if (zoneDevices.length === 0) return null;

          return (
            <ZoneSection
              key={zone}
              zone={zone}
              devices={zoneDevices}
              client={pvwsClient}
              editMode={editMode}
            />
          );
        })}

        {/* Ungrouped devices */}
        {grouped['ungrouped'] && grouped['ungrouped'].length > 0 && !selectedZone && (
          <ZoneSection
            zone="Ungrouped"
            devices={grouped['ungrouped']}
            client={pvwsClient}
            editMode={editMode}
          />
        )}
      </div>
    </div>
  );
}

function ZoneSection({ zone, devices, client, editMode }) {
  const { layout, onLayoutChange, resetLayout } = useLayout(
    'beamline',
    zone,
    devices,
    12,
  );

  return (
    <div className="zone-section">
      <div className="zone-header">
        <h3 className="zone-title">Zone: {zone}</h3>
        <span className="zone-count">{devices.length} device(s)</span>
        <button className="toolbar-btn toolbar-btn--small" onClick={resetLayout}>
          ↻
        </button>
      </div>
      <DashboardGrid
        layout={layout}
        onLayoutChange={onLayoutChange}
        isDraggable={editMode}
        isResizable={editMode}
        rowHeight={50}
      >
        {devices.map((device) => {
          const WidgetComp = getWidgetComponent(device);
          return (
            <div key={device.id}>
              <WidgetComp device={device} client={client} />
            </div>
          );
        })}
      </DashboardGrid>
    </div>
  );
}
