import CameraWidget from './CameraWidget.jsx';
import MotorWidget from './MotorWidget.jsx';
import BPMWidget from './BPMWidget.jsx';
import GenericPVWidget from './GenericPVWidget.jsx';

/**
 * Maps device family/type to the appropriate widget component.
 * Returns the component (not an instance).
 */
const familyMap = {
  cam: CameraWidget,
  mot: MotorWidget,
  bpm: BPMWidget,
};

const typeMap = {
  camera: CameraWidget,
  camerasim: CameraWidget,
  adcamera: CameraWidget,
  motor: MotorWidget,
  pollux: MotorWidget,
  bpm: BPMWidget,
};

export function getWidgetComponent(device) {
  // Check family first, then type, then fallback
  if (device.family && familyMap[device.family]) return familyMap[device.family];
  if (device.type && typeMap[device.type]) return typeMap[device.type];
  // Camera heuristic
  if (device.streamEnabled) return CameraWidget;
  return GenericPVWidget;
}

/**
 * Default widget sizes by family for auto-layout.
 */
export const widgetSizeMap = {
  cam: { w: 4, h: 5 },
  mot: { w: 3, h: 4 },
  bpm: { w: 3, h: 3 },
  generic: { w: 3, h: 3 },
};
