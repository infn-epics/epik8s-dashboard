/**
 * Layout persistence using localStorage.
 *
 * Layouts are stored per view + zone/filter key.
 * Key format: "epik8s-layout:<view>:<scope>"
 */

const STORAGE_PREFIX = 'epik8s-layout';

function makeKey(view, scope = 'default') {
  return `${STORAGE_PREFIX}:${view}:${scope}`;
}

/**
 * Save layout to localStorage.
 * @param {string} view - View name (camera, instrumentation, beamline)
 * @param {string} scope - Zone or filter context
 * @param {Array} layout - react-grid-layout layout array
 */
export function saveLayout(view, scope, layout) {
  try {
    const key = makeKey(view, scope);
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // quota exceeded or private browsing — silently ignore
  }
}

/**
 * Load layout from localStorage.
 * @returns {Array|null} Layout array or null if not found
 */
export function loadLayout(view, scope) {
  try {
    const key = makeKey(view, scope);
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Remove a saved layout.
 */
export function clearLayout(view, scope) {
  try {
    const key = makeKey(view, scope);
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Generate automatic layout for a list of devices.
 * Places widgets in a grid, respecting column count.
 * @param {Array} devices - Device objects with id
 * @param {number} cols - Grid columns (default 12)
 * @param {Object} sizeMap - Map of device family to {w, h} defaults
 * @returns {Array} react-grid-layout compatible layout
 */
export function generateAutoLayout(devices, cols = 12, sizeMap = {}) {
  const defaultSize = { w: 3, h: 4 };
  const layout = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const dev of devices) {
    const size = sizeMap[dev.family] || sizeMap[dev.type] || defaultSize;
    const w = Math.min(size.w, cols);
    const h = size.h;

    // Wrap to next row if doesn't fit
    if (x + w > cols) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }

    layout.push({
      i: dev.id,
      x,
      y,
      w,
      h,
      minW: 2,
      minH: 2,
    });

    x += w;
    rowHeight = Math.max(rowHeight, h);
  }

  return layout;
}
