/**
 * Widget Type Registry — Phoebus-inspired widget system.
 *
 * All widgets share a universal base property model:
 *  - PV binding (pv_name, alarm_sensitive)
 *  - Style (foreground, background, font, fontSize)
 *  - Visibility/enable rules (visible, enabled, tooltip)
 *  - Macros (macro substitution for PV names)
 *
 * Categories mirror Phoebus:
 *  - Basic (Label, Text Update, Text Entry, Boolean Button, Action Button, Combo Box, LED)
 *  - Numeric/Control (Slider, Gauge)
 *  - Plot/Data (XY Plot / Data Browser)
 *  - Devices (Camera, Motor, BPM, Vacuum, Power Supply, Charge Monitor)
 */

/* === Widget type imports (auto-discovered from families tree) === */
const FAMILY_WIDGET_MODULES = import.meta.glob('./families/**/*.jsx', { eager: true });

function familyWidget(path, fallback = null) {
  return FAMILY_WIDGET_MODULES[path]?.default || fallback;
}

const GenericPVWidget = familyWidget('./families/generic/GenericPV.jsx') || familyWidget('./families/io/Generic.jsx');
const LabelWidget = familyWidget('./families/basic/Label.jsx', GenericPVWidget);
const TextUpdateWidget = familyWidget('./families/basic/TextUpdate.jsx', GenericPVWidget);
const TextEntryWidget = familyWidget('./families/basic/TextEntry.jsx', GenericPVWidget);
const BooleanButtonWidget = familyWidget('./families/basic/BooleanButton.jsx', GenericPVWidget);
const ActionButtonWidget = familyWidget('./families/basic/ActionButton.jsx', GenericPVWidget);
const ComboBoxWidget = familyWidget('./families/basic/ComboBox.jsx', GenericPVWidget);
const LEDWidget = familyWidget('./families/basic/LED.jsx', GenericPVWidget);
const SliderWidget = familyWidget('./families/numeric/Slider.jsx', GenericPVWidget);
const GaugeWidget = familyWidget('./families/numeric/Gauge.jsx', GenericPVWidget);
const DataBrowserWidget = familyWidget('./families/plot/DataBrowser.jsx', GenericPVWidget);
const CameraWidget = familyWidget('./families/cam/Camera.jsx', GenericPVWidget);
const MotorWidget = familyWidget('./families/mot/Motor.jsx', GenericPVWidget);
const BPMWidget = familyWidget('./families/bpm/BPM.jsx', GenericPVWidget);
const VacuumWidget = familyWidget('./families/vac/Vacuum.jsx', GenericPVWidget);
const PowerSupplyWidget = familyWidget('./families/mag/PowerSupply.jsx', GenericPVWidget);
const ChargeMonitorWidget = familyWidget('./families/generic/ChargeMonitor.jsx', GenericPVWidget);
const LLRFWidget = familyWidget('./families/rf/LLRF.jsx', GenericPVWidget);
const TimingWidget = familyWidget('./families/timing/Timing.jsx', GenericPVWidget);
const CoolingWidget = familyWidget('./families/cool/Generic.jsx', GenericPVWidget);

/* ==========================================
   Universal Base Properties (Phoebus-like)
   ========================================== */

/** Properties shared by every widget. Prepended to each type's own properties. */
const BASE_PROPERTIES = [
  { key: 'title', label: 'Name', type: 'string', default: '', group: 'General' },
  { key: 'visible', label: 'Visible', type: 'boolean', default: true, group: 'General' },
  { key: 'tooltip', label: 'Tooltip', type: 'string', default: '', group: 'General' },
  { key: 'frameless', label: 'Frameless', type: 'boolean', default: false, group: 'Style' },
];

/** Style properties. */
const STYLE_PROPERTIES = [
  { key: 'foreground', label: 'Foreground', type: 'color', default: '', group: 'Style' },
  { key: 'background', label: 'Background', type: 'color', default: '', group: 'Style' },
  { key: 'fontSize', label: 'Font Size', type: 'number', default: 14, min: 8, max: 72, group: 'Style' },
];

/** PV binding properties for widgets that bind to a single PV. */
const PV_PROPERTIES = [
  { key: 'pv_name', label: 'PV Name', type: 'pv', required: true, group: 'PV', placeholder: 'IOC:DEVICE:Signal' },
  { key: 'alarm_sensitive', label: 'Alarm Sensitive', type: 'boolean', default: true, group: 'PV' },
];

/** PV prefix properties for device widgets. */
const PV_PREFIX_PROPERTIES = [
  { key: 'pvPrefix', label: 'Device Prefix', type: 'pv', required: true, group: 'Device', placeholder: 'IOC:DEVICE' },
  { key: 'alarm_sensitive', label: 'Alarm Sensitive', type: 'boolean', default: true, group: 'Device' },
];

/** Macro properties. */
const MACRO_PROPERTIES = [
  { key: 'macros', label: 'Macros (JSON)', type: 'text', default: '', group: 'Macros', placeholder: '{"DEVICE":"CAM01"}' },
];

/** View mode property for device widgets. */
const VIEW_MODE_PROPERTY = [
  { key: 'viewMode', label: 'View Mode', type: 'select', default: 'essential', options: ['essential', 'detail'], group: 'Widget' },
];

/** Numeric display properties for readback widgets. */
const NUMERIC_DISPLAY_PROPERTIES = [
  { key: 'format', label: 'Format', type: 'select', default: 'decimal', options: ['decimal', 'exponential', 'engineering', 'hex', 'string'], group: 'Widget' },
  { key: 'precision', label: 'Precision', type: 'number', default: 2, min: 0, max: 10, group: 'Widget' },
  { key: 'showUnits', label: 'Show EGU', type: 'boolean', default: true, group: 'Widget' },
  { key: 'units', label: 'Units', type: 'string', default: '', group: 'Widget' },
];

/** Combine base + given arrays. */
function props(...arrays) {
  return [...BASE_PROPERTIES, ...arrays.flat()];
}

/* ==========================================
   Widget Type Definitions
   ========================================== */

const WIDGET_TYPES = {

  /* ===== Basic Widgets ===== */

  'label': {
    type: 'label',
    name: 'Label',
    icon: '🏷',
    category: 'Basic',
    description: 'Static text label',
    dataSource: null,
    defaultSize: { w: 2, h: 1, minW: 1, minH: 1 },
    properties: props(STYLE_PROPERTIES, [
      { key: 'text', label: 'Text', type: 'string', default: 'Label', group: 'Widget' },
      { key: 'horizontal_alignment', label: 'Alignment', type: 'select', default: 'left', options: ['left', 'center', 'right'], group: 'Widget' },
    ]),
    component: LabelWidget,
  },

  'text-update': {
    type: 'text-update',
    name: 'Text Update',
    icon: '📊',
    category: 'Basic',
    description: 'Displays a PV value (read-only)',
    dataSource: 'pvws',
    defaultSize: { w: 2, h: 1, minW: 1, minH: 1 },
    properties: props(PV_PROPERTIES, STYLE_PROPERTIES, NUMERIC_DISPLAY_PROPERTIES),
    component: TextUpdateWidget,
  },

  'text-entry': {
    type: 'text-entry',
    name: 'Text Entry',
    icon: '✏️',
    category: 'Basic',
    description: 'Write a value to a PV',
    dataSource: 'pvws',
    defaultSize: { w: 2, h: 1, minW: 1, minH: 1 },
    properties: props(PV_PROPERTIES, STYLE_PROPERTIES, [
      { key: 'format', label: 'Format', type: 'select', default: 'float', options: ['float', 'integer', 'string'], group: 'Widget' },
      { key: 'placeholder', label: 'Placeholder', type: 'string', default: '', group: 'Widget' },
    ]),
    component: TextEntryWidget,
  },

  'boolean-button': {
    type: 'boolean-button',
    name: 'Boolean Button',
    icon: '🔘',
    category: 'Basic',
    description: 'Toggle a boolean PV ON/OFF',
    dataSource: 'pvws',
    defaultSize: { w: 2, h: 1, minW: 1, minH: 1 },
    properties: props(PV_PROPERTIES, STYLE_PROPERTIES, [
      { key: 'on_label', label: 'ON Label', type: 'string', default: 'ON', group: 'Widget' },
      { key: 'off_label', label: 'OFF Label', type: 'string', default: 'OFF', group: 'Widget' },
      { key: 'on_value', label: 'ON Value', type: 'number', default: 1, group: 'Widget' },
      { key: 'off_value', label: 'OFF Value', type: 'number', default: 0, group: 'Widget' },
      { key: 'on_color', label: 'ON Color', type: 'color', default: '#34d399', group: 'Widget' },
      { key: 'off_color', label: 'OFF Color', type: 'color', default: '#6b7280', group: 'Widget' },
    ]),
    component: BooleanButtonWidget,
  },

  'action-button': {
    type: 'action-button',
    name: 'Action Button',
    icon: '⏯',
    category: 'Basic',
    description: 'Write a fixed value to a PV on click',
    dataSource: 'pvws',
    defaultSize: { w: 2, h: 1, minW: 1, minH: 1 },
    properties: props(PV_PROPERTIES, STYLE_PROPERTIES, [
      { key: 'label', label: 'Button Label', type: 'string', default: 'Execute', group: 'Widget' },
      { key: 'value', label: 'Write Value', type: 'string', default: '1', group: 'Widget' },
      { key: 'confirm', label: 'Require Confirm', type: 'boolean', default: false, group: 'Widget' },
      { key: 'confirm_message', label: 'Confirm Message', type: 'string', default: 'Are you sure?', group: 'Widget' },
    ]),
    component: ActionButtonWidget,
  },

  'combo-box': {
    type: 'combo-box',
    name: 'Combo Box',
    icon: '📋',
    category: 'Basic',
    description: 'Select a value from a list and write to PV',
    dataSource: 'pvws',
    defaultSize: { w: 2, h: 1, minW: 1, minH: 1 },
    properties: props(PV_PROPERTIES, STYLE_PROPERTIES, [
      { key: 'items', label: 'Items (one per line)', type: 'text', default: '', group: 'Widget', placeholder: 'AUTO\nMANUAL\nREMOTE' },
    ]),
    component: ComboBoxWidget,
  },

  'led': {
    type: 'led',
    name: 'LED',
    icon: '🔴',
    category: 'Basic',
    description: 'Status indicator LED bound to a PV',
    dataSource: 'pvws',
    defaultSize: { w: 1, h: 1, minW: 1, minH: 1 },
    properties: props(PV_PROPERTIES, [
      { key: 'on_color', label: 'ON Color', type: 'color', default: '#34d399', group: 'Widget' },
      { key: 'off_color', label: 'OFF Color', type: 'color', default: '#ef4444', group: 'Widget' },
      { key: 'threshold', label: 'ON Threshold', type: 'number', default: 0.5, group: 'Widget' },
      { key: 'shape', label: 'Shape', type: 'select', default: 'circle', options: ['circle', 'square'], group: 'Widget' },
      { key: 'showLabel', label: 'Show Label', type: 'boolean', default: true, group: 'Widget' },
    ]),
    component: LEDWidget,
  },

  /* ===== Numeric / Control Widgets ===== */

  'slider': {
    type: 'slider',
    name: 'Slider',
    icon: '🎚',
    category: 'Numeric',
    description: 'Slider control to write a numeric PV',
    dataSource: 'pvws',
    defaultSize: { w: 3, h: 2, minW: 2, minH: 1 },
    properties: props(PV_PROPERTIES, STYLE_PROPERTIES, [
      { key: 'min', label: 'Min', type: 'number', default: 0, group: 'Widget' },
      { key: 'max', label: 'Max', type: 'number', default: 100, group: 'Widget' },
      { key: 'step', label: 'Step', type: 'number', default: 1, group: 'Widget' },
      { key: 'showValue', label: 'Show Value', type: 'boolean', default: true, group: 'Widget' },
      { key: 'showLimits', label: 'Show Limits', type: 'boolean', default: true, group: 'Widget' },
      ...NUMERIC_DISPLAY_PROPERTIES,
    ]),
    component: SliderWidget,
  },

  'gauge': {
    type: 'gauge',
    name: 'Gauge',
    icon: '🌡',
    category: 'Numeric',
    description: 'Gauge display for a numeric PV',
    dataSource: 'pvws',
    defaultSize: { w: 2, h: 3, minW: 2, minH: 2 },
    properties: props(PV_PROPERTIES, STYLE_PROPERTIES, [
      { key: 'min', label: 'Min', type: 'number', default: 0, group: 'Widget' },
      { key: 'max', label: 'Max', type: 'number', default: 100, group: 'Widget' },
      { key: 'warningHigh', label: 'Warning High', type: 'number', default: 80, group: 'Widget' },
      { key: 'alarmHigh', label: 'Alarm High', type: 'number', default: 90, group: 'Widget' },
      { key: 'showTicks', label: 'Show Ticks', type: 'boolean', default: true, group: 'Widget' },
      ...NUMERIC_DISPLAY_PROPERTIES,
    ]),
    component: GaugeWidget,
  },

  /* ===== Plot / Data Visualization ===== */

  'data-browser': {
    type: 'data-browser',
    name: 'Data Browser',
    icon: '📈',
    category: 'Plot',
    description: 'Time-series plot from EPICS Archiver (multi-PV)',
    dataSource: 'archiver',
    defaultSize: { w: 6, h: 4, minW: 3, minH: 3 },
    properties: props(MACRO_PROPERTIES, [
      { key: 'pvs', label: 'PVs (one per line)', type: 'text', required: true, group: 'Data', placeholder: 'BPM01:X\nBPM01:Y' },
      { key: 'timeRange', label: 'Time Range', type: 'select', default: '1h', options: ['5m', '15m', '1h', '6h', '24h', '7d', '30d'], group: 'Data' },
      { key: 'refreshInterval', label: 'Refresh (sec)', type: 'number', default: 30, min: 0, group: 'Data' },
      { key: 'archive', label: 'Use Archiver', type: 'boolean', default: true, group: 'Data' },
      { key: 'showGrid', label: 'Show Grid', type: 'boolean', default: true, group: 'Widget' },
      { key: 'showLegend', label: 'Show Legend', type: 'boolean', default: true, group: 'Widget' },
      { key: 'colors', label: 'Line Colors (one per line)', type: 'text', default: '#4f8ff7\n#34d399\n#f59e0b\n#ef4444\n#8b5cf6', group: 'Widget' },
    ]),
    component: DataBrowserWidget,
  },

  /* ===== Device-Specific Widgets ===== */

  camera: {
    type: 'camera',
    name: 'Camera (AreaDetector)',
    icon: '📷',
    category: 'Devices',
    family: 'cam',
    connectionSuffix: ':Acquire',
    description: 'MJPEG stream with acquire/exposure/gain controls',
    dataSource: 'pvws',
    defaultSize: { w: 4, h: 5, minW: 3, minH: 3 },
    properties: props(PV_PREFIX_PROPERTIES, STYLE_PROPERTIES, VIEW_MODE_PROPERTY, [
      { key: 'streamUrl', label: 'Stream URL', type: 'string', placeholder: '//host/DEVICE.STREAM.mjpg', group: 'Widget' },
      { key: 'streamEnabled', label: 'Has Stream', type: 'boolean', default: true, group: 'Widget' },
    ]),
    component: CameraWidget,
  },

  motor: {
    type: 'motor',
    name: 'Motor',
    icon: '⚙',
    category: 'Devices',
    family: 'mot',
    connectionSuffix: '.RBV',
    description: 'Motor position, setpoint, jog, stop, home, expert params',
    dataSource: 'pvws',
    defaultSize: { w: 4, h: 6, minW: 3, minH: 4 },
    properties: props(PV_PREFIX_PROPERTIES, STYLE_PROPERTIES, VIEW_MODE_PROPERTY, [
      { key: 'precision', label: 'Precision', type: 'number', default: 4, min: 0, max: 10, group: 'Widget' },
      { key: 'format', label: 'Format', type: 'select', default: 'decimal', options: ['decimal', 'exponential', 'engineering', 'hex', 'string'], group: 'Widget' },
      { key: 'showUnits', label: 'Show EGU', type: 'boolean', default: true, group: 'Widget' },
      { key: 'showExpert', label: 'Show Expert Panel', type: 'boolean', default: false, group: 'Widget' },
    ]),
    component: MotorWidget,
  },

  bpm: {
    type: 'bpm',
    name: 'Beam Position Monitor',
    icon: '📡',
    category: 'Devices',
    family: 'bpm',
    connectionSuffix: ':X',
    description: 'X/Y position and charge display',
    dataSource: 'pvws',
    defaultSize: { w: 3, h: 3, minW: 2, minH: 2 },
    properties: props(PV_PREFIX_PROPERTIES, STYLE_PROPERTIES, VIEW_MODE_PROPERTY, [
      { key: 'precision', label: 'Precision', type: 'number', default: 3, group: 'Widget' },
      { key: 'format', label: 'Format', type: 'select', default: 'decimal', options: ['decimal', 'exponential', 'engineering', 'hex', 'string'], group: 'Widget' },
      { key: 'showUnits', label: 'Show EGU', type: 'boolean', default: true, group: 'Widget' },
      { key: 'showCharge', label: 'Show Charge', type: 'boolean', default: true, group: 'Widget' },
    ]),
    component: BPMWidget,
  },

  vacuum: {
    type: 'vacuum',
    name: 'Vacuum',
    icon: '💨',
    category: 'Devices',
    family: 'vac',
    connectionSuffix: ':PRES_RB',
    description: 'Pressure display and enum status',
    dataSource: 'pvws',
    defaultSize: { w: 3, h: 3, minW: 2, minH: 2 },
    properties: props(PV_PREFIX_PROPERTIES, STYLE_PROPERTIES, VIEW_MODE_PROPERTY, [
      { key: 'pressureUnit', label: 'Pressure Unit', type: 'select', default: 'mbar', options: ['mbar', 'torr', 'Pa', 'atm'], group: 'Widget' },
      { key: 'pressureFormat', label: 'Pressure Format', type: 'select', default: 'exponential', options: ['decimal', 'exponential', 'engineering', 'string'], group: 'Widget' },
      { key: 'precision', label: 'Precision', type: 'number', default: 2, min: 0, max: 10, group: 'Widget' },
      { key: 'showUnits', label: 'Show EGU', type: 'boolean', default: true, group: 'Widget' },
      { key: 'alarmThreshold', label: 'Alarm Threshold', type: 'number', default: 1e-5, group: 'Widget' },
    ]),
    component: VacuumWidget,
  },

  cooling: {
    type: 'cooling',
    name: 'Cooling Channel',
    icon: '❄️',
    category: 'Devices',
    family: 'cool',
    connectionSuffix: ':TEMP_RB',
    description: 'Cooling channel with TEMP/STATE readback and setpoints',
    dataSource: 'pvws',
    defaultSize: { w: 3, h: 3, minW: 2, minH: 2 },
    properties: props(PV_PREFIX_PROPERTIES, STYLE_PROPERTIES, VIEW_MODE_PROPERTY, [
      { key: 'format', label: 'Format', type: 'select', default: 'decimal', options: ['decimal', 'exponential', 'engineering', 'hex', 'string'], group: 'Widget' },
      { key: 'precision', label: 'Precision', type: 'number', default: 2, min: 0, max: 10, group: 'Widget' },
      { key: 'showUnits', label: 'Show EGU', type: 'boolean', default: true, group: 'Widget' },
      { key: 'units', label: 'Units', type: 'string', default: 'degC', group: 'Widget' },
    ]),
    component: CoolingWidget,
  },

  'power-supply': {
    type: 'power-supply',
    name: 'Power Supply',
    icon: '⚡',
    category: 'Devices',
    family: 'mag',
    connectionSuffix: ':Current',
    description: 'Current/voltage set/read, on/off control',
    dataSource: 'pvws',
    defaultSize: { w: 3, h: 4, minW: 2, minH: 3 },
    properties: props(PV_PREFIX_PROPERTIES, STYLE_PROPERTIES, VIEW_MODE_PROPERTY, [
      { key: 'maxCurrent', label: 'Max Current (A)', type: 'number', default: 100, group: 'Widget' },
      { key: 'maxVoltage', label: 'Max Voltage (V)', type: 'number', default: 50, group: 'Widget' },
      { key: 'precision', label: 'Precision', type: 'number', default: 3, group: 'Widget' },
      { key: 'format', label: 'Format', type: 'select', default: 'decimal', options: ['decimal', 'exponential', 'engineering', 'hex', 'string'], group: 'Widget' },
      { key: 'showUnits', label: 'Show EGU', type: 'boolean', default: true, group: 'Widget' },
    ]),
    component: PowerSupplyWidget,
  },

  'charge-monitor': {
    type: 'charge-monitor',
    name: 'Charge Monitor',
    icon: '🔋',
    category: 'Devices',
    family: 'generic',
    connectionSuffix: ':Charge',
    description: 'Charge display with optional trend',
    dataSource: 'pvws',
    defaultSize: { w: 3, h: 3, minW: 2, minH: 2 },
    properties: props(PV_PREFIX_PROPERTIES, STYLE_PROPERTIES, VIEW_MODE_PROPERTY, [
      { key: 'units', label: 'Units', type: 'string', default: 'pC', group: 'Widget' },
      { key: 'precision', label: 'Precision', type: 'number', default: 3, group: 'Widget' },
      { key: 'format', label: 'Format', type: 'select', default: 'decimal', options: ['decimal', 'exponential', 'engineering', 'hex', 'string'], group: 'Widget' },
      { key: 'showUnits', label: 'Show EGU', type: 'boolean', default: true, group: 'Widget' },
      { key: 'showTrend', label: 'Show Trend', type: 'boolean', default: true, group: 'Widget' },
      { key: 'trendLength', label: 'Trend Points', type: 'number', default: 50, min: 10, max: 200, group: 'Widget' },
    ]),
    component: ChargeMonitorWidget,
  },

  'generic-pv': {
    type: 'generic-pv',
    name: 'Generic Device',
    icon: '🔧',
    category: 'Devices',
    family: 'generic',
    connectionSuffix: '',
    description: 'Fallback widget for any PV/device prefix',
    dataSource: 'pvws',
    defaultSize: { w: 3, h: 3, minW: 2, minH: 2 },
    properties: props(PV_PREFIX_PROPERTIES, VIEW_MODE_PROPERTY),
    component: GenericPVWidget,
  },

  'llrf': {
    type: 'llrf',
    name: 'LLRF (Low-Level RF)',
    icon: '📡',
    category: 'Devices',
    family: 'rf',
    connectionSuffix: ':app:rf_ctrl',
    description: 'Libera LLRF — RF control, feedback loops, channel power/phase, conditioning',
    dataSource: 'pvws',
    defaultSize: { w: 4, h: 5, minW: 3, minH: 3 },
    properties: props(PV_PREFIX_PROPERTIES, STYLE_PROPERTIES, VIEW_MODE_PROPERTY, [
      { key: 'channel', label: 'Default Channel', type: 'select', default: 'ch1', options: ['ch1','ch2','ch3','ch4','ch5','ch6','ch7','ch8'], group: 'Widget' },
      { key: 'precision', label: 'Precision', type: 'number', default: 2, min: 0, max: 6, group: 'Widget' },
      { key: 'format', label: 'Format', type: 'select', default: 'decimal', options: ['decimal', 'exponential', 'engineering', 'hex', 'string'], group: 'Widget' },
      { key: 'showUnits', label: 'Show EGU', type: 'boolean', default: true, group: 'Widget' },
      { key: 'conditioningPrefix', label: 'Conditioning IOC Prefix', type: 'string', default: '', group: 'Widget', placeholder: 'SPARC:RF:CONDITIONING01' },
    ]),
    component: LLRFWidget,
  },

  'timing': {
    type: 'timing',
    name: 'Timing (MRF EVG/EVR)',
    icon: '⏱',
    category: 'Devices',
    family: 'timing',
    connectionSuffix: ':EvtClkPll-Sts',
    description: 'MRF timing — EVG clock, multiplexed counters, trigger events, EVR delay generators, outputs',
    dataSource: 'pvws',
    defaultSize: { w: 7, h: 6, minW: 5, minH: 4 },
    properties: props(PV_PREFIX_PROPERTIES, STYLE_PROPERTIES, VIEW_MODE_PROPERTY, [
      { key: 'evrPrefix', label: 'EVR Device Prefix', type: 'pv', default: '', group: 'Device', placeholder: 'MRF01:EVR' },
      { key: 'numDelayGens', label: 'Delay Generators', type: 'number', default: 9, min: 1, max: 16, group: 'Widget' },
      { key: 'precision', label: 'Precision', type: 'number', default: 2, min: 0, max: 6, group: 'Widget' },
      { key: 'format', label: 'Format', type: 'select', default: 'decimal', options: ['decimal', 'exponential', 'engineering', 'hex', 'string'], group: 'Widget' },
      { key: 'showUnits', label: 'Show EGU', type: 'boolean', default: true, group: 'Widget' },
    ]),
    component: TimingWidget,
  },
};

/* === Public API === */

/** Get all registered widget types. */
export function getWidgetTypes() {
  return Object.values(WIDGET_TYPES);
}

/** Get types grouped by category. */
export function getWidgetTypesByCategory() {
  const groups = {};
  for (const wt of Object.values(WIDGET_TYPES)) {
    if (!groups[wt.category]) groups[wt.category] = [];
    groups[wt.category].push(wt);
  }
  return groups;
}

/** Category display order. */
export const CATEGORY_ORDER = ['Basic', 'Numeric', 'Plot', 'Devices'];

/** Get a single widget type definition by type key. */
export function getWidgetType(type) {
  return WIDGET_TYPES[type] || null;
}

function resolveHierarchyComponent(device) {
  const family = (device?.family || '').toString().toLowerCase();
  const rawType = (device?.type || '').toString().toUpperCase();
  if (!family) return null;

  const specialized = rawType ? familyWidget(`./families/${family}/${rawType}.jsx`) : null;
  if (specialized) return specialized;

  const generic = familyWidget(`./families/${family}/Generic.jsx`);
  if (generic) return generic;

  return familyWidget('./families/generic/GenericPV.jsx') || null;
}

/** Get the React component for a widget type. */
export function getWidgetComponent(type, device = null) {
  if (device) {
    const hierarchyComponent = resolveHierarchyComponent(device);
    if (hierarchyComponent) return hierarchyComponent;
  }
  return WIDGET_TYPES[type]?.component || GenericPVWidget;
}

/** Build default config from a widget type's property definitions. */
export function getDefaultConfig(type) {
  const wt = WIDGET_TYPES[type];
  if (!wt) return {};
  const config = {};
  for (const prop of wt.properties) {
    if (prop.default !== undefined) {
      config[prop.key] = prop.default;
    }
  }
  return config;
}

/** Map a device family to widget type key. */
const FAMILY_TO_TYPE = {
  cam: 'camera',
  mot: 'motor',
  bpm: 'bpm',
  vac: 'vacuum',
  mag: 'power-supply',
  rf: 'llrf',
  timing: 'timing',
  io: 'generic-pv',
  cool: 'cooling',
  mps: 'generic-pv',
  generic: 'generic-pv',
};

export function familyToWidgetType(family) {
  return FAMILY_TO_TYPE[family] || 'generic-pv';
}

/** Map a full normalized device to the best widget type key. */
export function deviceToWidgetType(device) {
  const family = device?.family;
  const rawType = (device?.type || '').toString().toLowerCase();

  if (family === 'io') {
    if (rawType === 'di') return 'led';
    if (rawType === 'do') return 'boolean-button';
    if (rawType === 'rly') return 'boolean-button';
    if (rawType === 'ao') return 'text-entry';
    if (rawType === 'ai' || rawType === 'rtd') return 'text-update';
  }

  return familyToWidgetType(family);
}

/** Widget size map for auto-layout (backward compat). */
export const widgetSizeMap = {};
for (const [key, wt] of Object.entries(WIDGET_TYPES)) {
  widgetSizeMap[key] = { w: wt.defaultSize.w, h: wt.defaultSize.h };
}
for (const [family, type] of Object.entries(FAMILY_TO_TYPE)) {
  if (WIDGET_TYPES[type]) {
    widgetSizeMap[family] = { w: WIDGET_TYPES[type].defaultSize.w, h: WIDGET_TYPES[type].defaultSize.h };
  }
}
