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
function resolveType(ioc) {
  return ioc.devtype || ioc.template || 'generic';
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
    const family = resolveFamily(ioc);
    const type = resolveType(ioc);
    const zone = ioc.zones || '';
    const httpPort = ioc.service?.http?.port || 8080;
    const isCamera = family === 'cam' || ioc.stream_enable;
    const devs = ioc.devices || [];

    for (const dev of devs) {
      const deviceName = dev.name;
      const pvPrefix = `${iocPrefix}:${deviceName}`;
      const id = `${ioc.name}:${deviceName}`;

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
        pvPrefix,
        type,
        family,
        zone,
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
 */
export function groupDevicesBy(devices, key) {
  const groups = {};
  for (const dev of devices) {
    const g = dev[key] || 'ungrouped';
    if (!groups[g]) groups[g] = [];
    groups[g].push(dev);
  }
  return groups;
}

/**
 * Get unique values of a field across all devices.
 */
export function getUniqueValues(devices, key) {
  return [...new Set(devices.map((d) => d[key]).filter(Boolean))];
}
