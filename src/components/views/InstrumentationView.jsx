import { useState, useCallback } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import DashboardGrid from '../layout/DashboardGrid.jsx';
import { useLayout } from '../../hooks/useLayout.js';
import { getWidgetComponent as getWidgetComp, familyToWidgetType } from '../../widgets/registry.js';
import { widgetSizeMap } from '../../widgets/registry.js';
import WidgetFrame from '../../widgets/WidgetFrame.jsx';
import { deviceToWidgetConfig } from '../../models/dashboard.js';
import SearchFilter from '../common/SearchFilter.jsx';
import RoleGuard from '../common/RoleGuard.jsx';

const LAYOUT_MODE_KEY = 'epik8s-instr-layout-mode';

/**
 * InstrumentationView - Filterable/groupable device dashboard.
 * Supports grid layout (react-grid-layout) and row strip layout
 * where each device's essential PVs are shown in a compact horizontal row.
 */
export default function InstrumentationView() {
  const { devices, pvwsClient } = useApp();
  const [filtered, setFiltered] = useState(devices);
  const [hiddenIds, setHiddenIds] = useState(new Set());
  const [editMode, setEditMode] = useState(false);
  const [layoutMode, setLayoutMode] = useState(
    () => localStorage.getItem(LAYOUT_MODE_KEY) || 'grid'
  );

  const visibleDevices = filtered.filter((d) => !hiddenIds.has(d.id));
  const { layout, onLayoutChange, resetLayout } = useLayout(
    'instrumentation',
    'all',
    visibleDevices,
    12,
  );

  const handleFilter = useCallback((result) => {
    setFiltered(result);
  }, []);

  const hideWidget = (id) => {
    setHiddenIds((prev) => new Set(prev).add(id));
  };

  const showAll = () => setHiddenIds(new Set());

  const toggleLayoutMode = () => {
    setLayoutMode(prev => {
      const next = prev === 'grid' ? 'row' : 'grid';
      localStorage.setItem(LAYOUT_MODE_KEY, next);
      return next;
    });
  };

  return (
    <div className="instrumentation-view">
      <div className="view-toolbar">
        <span className="view-toolbar-title">Instrumentation</span>
        <div className="toolbar-controls">
          <SearchFilter devices={devices} onFilter={handleFilter} />
          <button
            className={`toolbar-btn ${layoutMode === 'row' ? 'active' : ''}`}
            onClick={toggleLayoutMode}
            title={layoutMode === 'grid' ? 'Switch to row strip' : 'Switch to grid'}
          >
            {layoutMode === 'grid' ? '☰ Row' : '⊞ Grid'}
          </button>
          <RoleGuard require="operator">
            <button
              className={`toolbar-btn ${editMode ? 'active' : ''}`}
              onClick={() => setEditMode((e) => !e)}
            >
              {editMode ? '🔒 Lock' : '🔓 Edit'}
            </button>
          </RoleGuard>
          <button className="toolbar-btn" onClick={resetLayout} title="Reset to auto layout">
            ↻ Reset
          </button>
          {hiddenIds.size > 0 && (
            <button className="toolbar-btn" onClick={showAll}>
              Show all ({hiddenIds.size} hidden)
            </button>
          )}
        </div>
      </div>

      <div className="view-content">
        {visibleDevices.length === 0 ? (
          <div className="view-empty">
            <p>No devices match the current filter.</p>
          </div>
        ) : layoutMode === 'row' ? (
          <div className="instr-row-strip">
            {visibleDevices.map((device) => {
              const widgetType = familyToWidgetType(device.family);
              const Component = getWidgetComp(widgetType);
              const config = { ...deviceToWidgetConfig(device), viewMode: 'essential' };
              const widget = { id: device.id, type: widgetType, config };
              return (
                <div key={device.id} className="instr-row-card">
                  <WidgetFrame
                    widget={widget}
                    editMode={editMode}
                    client={pvwsClient}
                    onRemove={() => hideWidget(device.id)}
                  >
                    <Component config={config} client={pvwsClient} />
                  </WidgetFrame>
                </div>
              );
            })}
          </div>
        ) : (
          <DashboardGrid
            layout={layout}
            onLayoutChange={onLayoutChange}
            isDraggable={editMode}
            isResizable={editMode}
          >
            {visibleDevices.map((device) => {
              const widgetType = familyToWidgetType(device.family);
              const Component = getWidgetComp(widgetType);
              const config = deviceToWidgetConfig(device);
              const widget = { id: device.id, type: widgetType, config };
              return (
                <div key={device.id}>
                  <WidgetFrame
                    widget={widget}
                    editMode={editMode}
                    client={pvwsClient}
                    onRemove={() => hideWidget(device.id)}
                  >
                    <Component
                      config={config}
                      client={pvwsClient}
                    />
                  </WidgetFrame>
                </div>
              );
            })}
          </DashboardGrid>
        )}
      </div>
    </div>
  );
}
