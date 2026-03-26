/**
 * Normalize raw IOC/device entries from epik8s YAML config into
 * a flat device list used throughout the application.
 *
 * Each device gets: id, name, type, family, zone, pvPrefix, iocName,
 * template, stream info, and any extra params.
 */

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Derive a device "family" from the IOC template / devgroup.
 */
function resolveFamily(ioc) {
  if (ioc.devgroup) return ioc.devgroup;
  const tpl = (ioc.template || '').toLowerCase();
  if (tpl.includes('camera') || tpl.includes('adcamera')) return 'cam';
  if (tpl.includes('motor')) return 'mot';
  if (tpl.includes('bpm')) return 'bpm';
  if (tpl.includes('mag')) return 'mag';
  if (tpl.includes('vac')) return 'vac';
  if (tpl.includes('io')) return 'io';
  if (tpl.includes('cool')) return 'cool';
  return tpl || 'generic';
}

/**
 * Derive a device "type" from template / devtype.
 */
function resolveType(ioc, dev = null) {
  if (dev && dev.devtype) return dev.devtype;
  return ioc.devtype || ioc.template || 'generic';
}

/**
 * Normalize zones field: string → string, array → first element (primary zone).
 * Also stores an `allZones` array for multi-zone membership.
 */
function resolveZone(raw) {
  if (!raw) return { zone: '', allZones: [] };
  if (Array.isArray(raw)) {
    return { zone: raw[0] || '', allZones: raw.map(String) };
  }
  return { zone: String(raw), allZones: [String(raw)] };
}

/**
 * Parse the full epik8s config and return a normalized device list.
 */
export function parseDevices(config) {
  const beamline = config.beamline || '';
  const namespace = config.namespace || beamline;
  const domain = config.epik8namespace || '';
  const iocDefaults = config.iocDefaults || {};
  const iocs = config.epicsConfiguration?.iocs || [];
  const devices = [];

  for (const rawIoc of iocs) {
    const template = rawIoc.template || '';
    const defaults = iocDefaults[template] || {};
    const ioc = deepMerge(defaults, rawIoc);

    const iocPrefix = ioc.iocprefix || '';
    const iocRoot = ioc.iocroot || '';
    const family = resolveFamily(ioc);
    const iocZone = resolveZone(ioc.zones);
    const httpPort = ioc.service?.http?.port || 8080;
    const isCamera = family === 'cam' || ioc.stream_enable;
    const hasDeviceList = Array.isArray(ioc.devices) && ioc.devices.length > 0;
    const devs = hasDeviceList
      ? ioc.devices
      : [{ name: ioc.name || iocPrefix || template || 'ioc', __iocLevel: true }];

    for (const dev of devs) {
      const deviceName = dev.name;
      const pvPrefix = dev.__iocLevel
        ? (iocRoot ? `${iocPrefix}:${iocRoot}` : iocPrefix)
        : (iocRoot ? `${iocPrefix}:${iocRoot}:${deviceName}` : `${iocPrefix}:${deviceName}`);
      const id = `${ioc.name}:${deviceName}`;
      const type = resolveType(ioc, dev);

      // Device-level zones override IOC-level zones
      const devZone = dev.zones ? resolveZone(dev.zones) : iocZone;

      // Stream URL for cameras
      let streamUrl = null;
      if (isCamera && ioc.stream_enable) {
        const streamHost = `${namespace}-${ioc.name}.${domain}`;
        streamUrl = `//${streamHost}/${deviceName}.STREAM.mjpg`;
      }

      devices.push({
        id,
        name: deviceName,
        iocName: ioc.name,
        iocPrefix,
        iocRoot,
        pvPrefix,
        type,
        family,
        zone: devZone.zone,
        allZones: devZone.allZones,
        template,
        beamline,
        namespace,
        domain,
        streamUrl,
        streamEnabled: !!ioc.stream_enable,
        httpPort,
        opi: ioc.opi || null,
        params: dev,         // raw device params (axid, dllm, dhlm, etc.)
        iocParams: ioc.iocparam || [],
        iocinit: dev.iocinit || ioc.iocinit || [],
        poi: dev.poi || [],
      });
    }
  }

  return devices;
}

/**
 * Group devices by a given key (zone, family, type, etc.)
 * When key is 'zone', uses allZones so a device in ["FI","FI1"] appears in both groups.
 */
export function groupDevicesBy(devices, key) {
  const groups = {};
  for (const dev of devices) {
    const keys = (key === 'zone' && dev.allZones?.length)
      ? dev.allZones
      : [dev[key] || 'ungrouped'];
    for (const g of keys) {
      if (!groups[g]) groups[g] = [];
      groups[g].push(dev);
    }
  }
  return groups;
}

/**
 * Get unique values of a field across all devices.
 */
export function getUniqueValues(devices, key) {
  return [...new Set(devices.map((d) => d[key]).filter(Boolean))];
}
