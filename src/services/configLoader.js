import yaml from 'js-yaml';
import { parseDevices } from '../models/device.js';

/**
 * Load an epik8s values.yaml and return normalized configuration.
 *
 * Returns: { devices, cameras, zones, config, pvws }
 */
export async function loadConfig(yamlPath = '/values.yaml') {
  const resp = await fetch(yamlPath);
  if (!resp.ok) throw new Error(`Failed to load ${yamlPath}: ${resp.status}`);
  const text = await resp.text();
  const config = yaml.load(text);

  // Extract pvws service config
  const services = config.epicsConfiguration?.services || {};
  let pvwsCfg = null;
  // Check dbwr.pvws, pws, or any service with pvws block
  for (const svc of Object.values(services)) {
    if (svc.pvws?.host) { pvwsCfg = svc.pvws; break; }
  }
  pvwsCfg = pvwsCfg || {};
  const pvws = {
    host: pvwsCfg.host || '',
    port: pvwsCfg.port || 80,
  };

  // Parse all devices from IOCs
  const devices = parseDevices(config);

  // Cameras = devices with streams
  const cameras = devices.filter((d) => d.streamEnabled);

  // Zones from config or derived from devices
  const configZones = (config.zones || []).map((z) => (typeof z === 'string' ? z : z.name));
  const deviceZones = [...new Set(devices.map((d) => d.zone).filter(Boolean))];
  const zones = configZones.length > 0 ? configZones : deviceZones;

  return { devices, cameras, zones, config, pvws };
}

// Legacy compat
export const loadCamerasFromConfig = loadConfig;
