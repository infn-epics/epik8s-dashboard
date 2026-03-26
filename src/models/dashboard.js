/**
 * Dashboard and widget model helpers.
 *
 * A Dashboard JSON structure:
 * {
 *   id, name, description, createdAt, updatedAt,
 *   widgets: [{ id, type, config: {...}, layout: {x,y,w,h} }]
 * }
 */

export function generateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Create a new empty dashboard. */
export function createDashboard(name = 'New Dashboard', description = '') {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    description,
    createdAt: now,
    updatedAt: now,
    widgets: [],
  };
}

/** Deep-clone a dashboard with a new id + name. */
export function cloneDashboard(dashboard, newName) {
  const now = new Date().toISOString();
  return {
    ...JSON.parse(JSON.stringify(dashboard)),
    id: generateId(),
    name: newName || `${dashboard.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
}

/** Create a widget instance from a registry definition and user config. */
export function createWidget(type, config = {}, layout = {}) {
  return {
    id: generateId(),
    type,
    config: { ...config },
    layout: { x: 0, y: 0, w: 3, h: 4, minW: 2, minH: 2, ...layout },
  };
}

/**
 * Convert a device object (from YAML) into a widget config object.
 * Used by auto-generated views to bridge device → widget.
 */
export function deviceToWidgetConfig(device) {
  const rawType = (device.type || '').toString().toLowerCase();
  let pvName = device.pvPrefix;

  if (rawType === 'di') pvName = `${device.pvPrefix}:STATE_RB`;
  else if (rawType === 'do' || rawType === 'rly') pvName = `${device.pvPrefix}:STATE_SP`;
  else if (rawType === 'ao') pvName = `${device.pvPrefix}:TEMP_SP`;
  else if (rawType === 'ai' || rawType === 'rtd') pvName = `${device.pvPrefix}:TEMP_RB`;

  return {
    title: device.name,
    subtitle: `${device.iocName} • ${device.zone || ''}`,
    pvPrefix: device.pvPrefix,
    pv_name: pvName,
    deviceId: device.id,
    family: device.family,
    type: device.type,
    zone: device.zone,
    iocName: device.iocName,
    streamUrl: device.streamUrl,
    streamEnabled: device.streamEnabled,
    min: device.params?.dllm,
    max: device.params?.dhlm,
    precision: device.params?.prec,
    poi: device.poi || [],
  };
}

/**
 * Auto-generate a dashboard from a list of devices.
 * Maps each device to its appropriate widget type.
 */
export function generateDashboardFromDevices(name, devices, cols = 12) {
  const FAMILY_TO_TYPE = {
    cam: 'camera',
    mot: 'motor',
    bpm: 'bpm',
    vac: 'vacuum',
    mag: 'power-supply',
    generic: 'generic-pv',
  };
  const IO_TYPE_TO_WIDGET = {
    di: 'led',
    do: 'boolean-button',
    rly: 'boolean-button',
    ao: 'text-entry',
    ai: 'text-update',
    rtd: 'text-update',
  };
  const SIZE_MAP = {
    camera: { w: 4, h: 5 },
    motor: { w: 3, h: 4 },
    bpm: { w: 3, h: 3 },
    vacuum: { w: 3, h: 3 },
    'power-supply': { w: 3, h: 3 },
    'generic-pv': { w: 3, h: 3 },
  };

  const widgets = [];
  let x = 0, y = 0, rowH = 0;

  for (const dev of devices) {
    const rawType = (dev.type || '').toString().toLowerCase();
    const type = dev.family === 'io'
      ? (IO_TYPE_TO_WIDGET[rawType] || 'generic-pv')
      : (FAMILY_TO_TYPE[dev.family] || 'generic-pv');
    const size = SIZE_MAP[type] || { w: 3, h: 3 };
    const w = Math.min(size.w, cols);

    if (x + w > cols) { x = 0; y += rowH; rowH = 0; }

    widgets.push(createWidget(type, deviceToWidgetConfig(dev), {
      x, y, w, h: size.h,
    }));

    x += w;
    rowH = Math.max(rowH, size.h);
  }

  const dash = createDashboard(name);
  dash.widgets = widgets;
  return dash;
}
