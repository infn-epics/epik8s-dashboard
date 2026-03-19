import { useState, useCallback, useEffect } from 'react';
import { saveLayout, loadLayout, generateAutoLayout } from '../services/layoutPersistence.js';

/**
 * Hook to manage layout state for a view + scope.
 * Loads saved layout from localStorage, falls back to auto-generated.
 */
export function useLayout(viewName, scope, devices, cols = 12) {
  const [layout, setLayout] = useState([]);

  // Load or generate layout when devices/scope changes
  useEffect(() => {
    if (!devices || devices.length === 0) {
      setLayout([]);
      return;
    }

    const saved = loadLayout(viewName, scope);
    if (saved && saved.length > 0) {
      // Merge: keep saved positions for existing devices, add new ones
      const savedIds = new Set(saved.map((l) => l.i));
      const newDevices = devices.filter((d) => !savedIds.has(d.id));
      const autoNew = generateAutoLayout(newDevices, cols);
      setLayout([...saved, ...autoNew]);
    } else {
      setLayout(generateAutoLayout(devices, cols));
    }
  }, [viewName, scope, devices, cols]);

  const onLayoutChange = useCallback(
    (newLayout) => {
      setLayout(newLayout);
      saveLayout(viewName, scope, newLayout);
    },
    [viewName, scope],
  );

  const resetLayout = useCallback(() => {
    if (!devices) return;
    const auto = generateAutoLayout(devices, cols);
    setLayout(auto);
    saveLayout(viewName, scope, auto);
  }, [viewName, scope, devices, cols]);

  return { layout, onLayoutChange, resetLayout };
}
