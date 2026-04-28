import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  listDashboards,
  getDashboard,
  saveDashboard,
  deleteDashboard as deleteDashStorage,
  getActiveDashboardId,
  setActiveDashboardId,
} from '../services/dashboardStorage.js';
import { createDashboard, cloneDashboard, createWidget, generateId } from '../models/dashboard.js';

const DashboardContext = createContext(null);

/**
 * DashboardProvider — manages dashboard CRUD and the active dashboard.
 */
export function DashboardProvider({ children }) {
  const [dashboards, setDashboards] = useState([]);
  const [activeDashboard, setActiveDashboard] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const refreshRef = useRef(0);

  // Load dashboards from storage
  const refreshList = useCallback(() => {
    setDashboards(listDashboards());
    refreshRef.current++;
  }, []);

  useEffect(() => {
    refreshList();
    // Restore last active dashboard
    const activeId = getActiveDashboardId();
    if (activeId) {
      const dash = getDashboard(activeId);
      if (dash) setActiveDashboard(dash);
    }
  }, [refreshList]);

  const openDashboard = useCallback((id) => {
    const dash = getDashboard(id);
    if (dash) {
      setActiveDashboard(dash);
      setActiveDashboardId(id);
    }
  }, []);

  const closeDashboard = useCallback(() => {
    setActiveDashboard(null);
    setActiveDashboardId(null);
  }, []);

  const addDashboard = useCallback((name = 'New Dashboard', description = '') => {
    const dash = createDashboard(name, description);
    saveDashboard(dash);
    refreshList();
    setActiveDashboard(dash);
    setActiveDashboardId(dash.id);
    return dash;
  }, [refreshList]);

  const updateDashboard = useCallback((dashboard) => {
    saveDashboard(dashboard);
    refreshList();
    if (activeDashboard?.id === dashboard.id) {
      setActiveDashboard({ ...dashboard });
    }
  }, [refreshList, activeDashboard]);

  const removeDashboard = useCallback((id) => {
    deleteDashStorage(id);
    refreshList();
    if (activeDashboard?.id === id) {
      setActiveDashboard(null);
    }
  }, [refreshList, activeDashboard]);

  const duplicateDashboard = useCallback((id) => {
    const original = getDashboard(id);
    if (!original) return null;
    const copy = cloneDashboard(original);
    saveDashboard(copy);
    refreshList();
    return copy;
  }, [refreshList]);

  const renameDashboard = useCallback((id, newName) => {
    const dash = getDashboard(id);
    if (!dash) return;
    dash.name = newName;
    saveDashboard(dash);
    refreshList();
    if (activeDashboard?.id === id) {
      setActiveDashboard({ ...dash });
    }
  }, [refreshList, activeDashboard]);

  // --- Widget operations on active dashboard ---

  const addWidget = useCallback((type, config = {}, layout = {}) => {
    if (!activeDashboard) return;
    const widget = createWidget(type, config, layout);
    const updated = {
      ...activeDashboard,
      widgets: [...activeDashboard.widgets, widget],
    };
    saveDashboard(updated);
    setActiveDashboard(updated);
    refreshList();
    return widget;
  }, [activeDashboard, refreshList]);

  const updateWidget = useCallback((widgetId, changes) => {
    if (!activeDashboard) return;
    const updated = {
      ...activeDashboard,
      widgets: activeDashboard.widgets.map((w) =>
        w.id === widgetId ? { ...w, ...changes } : w,
      ),
    };
    saveDashboard(updated);
    setActiveDashboard(updated);
    refreshList();
  }, [activeDashboard, refreshList]);

  const updateWidgetConfig = useCallback((widgetId, configChanges) => {
    if (!activeDashboard) return;
    const updated = {
      ...activeDashboard,
      widgets: activeDashboard.widgets.map((w) =>
        w.id === widgetId
          ? { ...w, config: { ...w.config, ...configChanges } }
          : w,
      ),
    };
    saveDashboard(updated);
    setActiveDashboard(updated);
    refreshList();
  }, [activeDashboard, refreshList]);

  const removeWidget = useCallback((widgetId) => {
    if (!activeDashboard) return;
    const updated = {
      ...activeDashboard,
      widgets: activeDashboard.widgets.filter((w) => w.id !== widgetId),
    };
    saveDashboard(updated);
    setActiveDashboard(updated);
    refreshList();
  }, [activeDashboard, refreshList]);

  const updateLayout = useCallback((gridLayout) => {
    if (!activeDashboard) return;
    const layoutMap = {};
    for (const item of gridLayout) {
      layoutMap[item.i] = { x: item.x, y: item.y, w: item.w, h: item.h };
    }
    const updated = {
      ...activeDashboard,
      widgets: activeDashboard.widgets.map((w) => ({
        ...w,
        layout: layoutMap[w.id] ? { ...w.layout, ...layoutMap[w.id] } : w.layout,
      })),
    };
    saveDashboard(updated);
    setActiveDashboard(updated);
    refreshList();
  }, [activeDashboard, refreshList]);

  const value = {
    dashboards,
    activeDashboard,
    editMode,
    setEditMode,
    openDashboard,
    closeDashboard,
    addDashboard,
    updateDashboard,
    removeDashboard,
    duplicateDashboard,
    renameDashboard,
    addWidget,
    updateWidget,
    updateWidgetConfig,
    removeWidget,
    updateLayout,
    refreshList,
  };

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}
