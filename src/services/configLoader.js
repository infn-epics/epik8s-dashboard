import yaml from 'js-yaml';

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
 * Load values.yaml from the public folder and extract cameras
 * that have stream_enable: true.
 *
 * Returns an array of camera descriptors:
 * [
 *   {
 *     iocName:    "camerasim",
 *     iocPrefix:  "EUAPS:CAM",
 *     deviceName: "SIM01",
 *     pvPrefix:   "EUAPS:CAM:SIM01",
 *     streamUrl:  "<computed from beamline/namespace/service>",
 *     httpPort:   8082,
 *     beamline:   "euaps",
 *     namespace:  "euaps",
 *     domain:     "k8sda.lnf.infn.it",
 *   },
 *   ...
 * ]
 */
export async function loadCamerasFromConfig(yamlPath = '/values.yaml') {
  const resp = await fetch(yamlPath);
  if (!resp.ok) throw new Error(`Failed to load ${yamlPath}: ${resp.status}`);
  const text = await resp.text();
  const config = yaml.load(text);

  const beamline = config.beamline || '';
  const namespace = config.namespace || beamline;
  const domain = config.epik8namespace || '';

  // Extract pvws service configuration — check camarray.pvws first, then any service with a pvws block
  const services = config.epicsConfiguration?.services || {};
  let pvwsCfg = services.camarray?.pvws;
  if (!pvwsCfg) {
    for (const svc of Object.values(services)) {
      if (svc.pvws?.host) { pvwsCfg = svc.pvws; break; }
    }
  }
  pvwsCfg = pvwsCfg || {};
  const pvws = {
    host: pvwsCfg.host || '',
    port: pvwsCfg.port || 80,
  };

  const iocDefaults = config.iocDefaults || {};
  const iocs = config.epicsConfiguration?.iocs || [];
  const cameras = [];

  for (const rawIoc of iocs) {
    // Merge iocDefaults by template (e.g. "adcamera") — IOC-specific values override defaults
    const template = rawIoc.template || '';
    const defaults = iocDefaults[template] || {};
    const ioc = deepMerge(defaults, rawIoc);

    if (!ioc.stream_enable) continue;

    const iocPrefix = ioc.iocprefix || '';
    const httpPort = ioc.service?.http?.port || 8080;
    const devices = ioc.devices || [];

    for (const dev of devices) {
      const deviceName = dev.name;
      const pvPrefix = `${iocPrefix}:${deviceName}`;
      // MJPEG stream URL: <beamline>-<iocname>.<domain>:<port>/<DEVICE>.mjpg
      const streamHost = `${namespace}-${ioc.name}.${domain}`;
      const streamUrl = `//${streamHost}/${deviceName}.STREAM.mjpg`;

      cameras.push({
        iocName: ioc.name,
        iocPrefix,
        deviceName,
        pvPrefix,
        streamUrl,
        httpPort,
        beamline,
        namespace,
        domain,
      });
    }
  }

  return { cameras, config, pvws };
}
