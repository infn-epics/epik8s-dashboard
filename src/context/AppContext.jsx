import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { loadConfig, loadStoredGitConfig, saveGitConfig, clearGitConfig } from '../services/configLoader.js';
import PvwsClient from '../services/pvws.js';
import ArchiverClient from '../services/archiver.js';
import { buildChannelFinderUrl, setChannelFinderUrl } from '../services/channelFinderApi.js';
import { proxyUrl } from '../services/devProxy.js';

const AppContext = createContext(null);

const LS_KEY = 'epik8s-datasources';

function loadStoredDataSources() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveDataSources(ds) {
  localStorage.setItem(LS_KEY, JSON.stringify(ds));
}

function buildPvwsUrl(pvwsParam, pvwsConfig) {
  if (pvwsParam) return pvwsParam;
  if (pvwsConfig && pvwsConfig.host) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${pvwsConfig.host}/pvws/pv`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.hostname}/pvws/pv`;
}

function buildArchiverUrl(config) {
  const services = config?.epicsConfiguration?.services || {};
  const archiver = services.archiver || {};
  if (archiver.host) return proxyUrl(`https://${archiver.host}`);
  // Derive from namespace/domain pattern
  const ns = config?.namespace || '';
  const domain = config?.epik8namespace || '';
  if (ns && domain) return proxyUrl(`https://${ns}-archiver.${domain}`);
  return null;
}

export function AppProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [devices, setDevices] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pvwsRef = useRef(null);
  const archiverRef = useRef(null);
  // Track current URLs for display in Settings
  const [dataSources, setDataSources] = useState({ pvwsUrl: '', archiverUrl: '', pvwsDefault: '', archiverDefault: '' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pvwsParam = params.get('pvws') || '';
    const archiverParam = params.get('archiver') || '';
    const stored = loadStoredGitConfig();
    const valuesPath = params.get('values') || stored.valuesPath || '/values.yaml';

    // Git URL can come from: ?giturl= param → localStorage → values.yaml itself
    const giturl   = params.get('giturl')    || stored.giturl   || '';
    const gitbranch = params.get('gitbranch') || stored.gitbranch || 'main';
    const gittoken  = params.get('gittoken')  || stored.token    || '';

    // Persist to localStorage if coming from query params
    if (params.get('giturl') || params.get('values')) saveGitConfig(giturl, gitbranch, gittoken, valuesPath);

    let cancelled = false;

    loadConfig(valuesPath, { giturl, gitbranch, token: gittoken || null })
      .then((result) => {
        if (cancelled) return;
        setConfig(result.config);
        setDevices(result.devices);
        setCameras(result.cameras);
        setZones(result.zones);

        // Build default URLs from YAML config
        const defaultPvws = buildPvwsUrl(pvwsParam, result.pvws);
        const defaultArchiver = archiverParam || buildArchiverUrl(result.config) || '';

        // Check localStorage for user overrides
        const stored = loadStoredDataSources();
        const pvwsUrl = stored?.pvwsUrl || defaultPvws;
        const archiverUrl = stored?.archiverUrl || defaultArchiver;

        setDataSources({ pvwsUrl, archiverUrl, pvwsDefault: defaultPvws, archiverDefault: defaultArchiver });

        // PVWS client
        const pvwsClient = new PvwsClient(pvwsUrl);
        pvwsRef.current = pvwsClient;
        pvwsClient.connect();

        // Archiver client (optional)
        if (archiverUrl) {
          archiverRef.current = new ArchiverClient(archiverUrl);
        }

        // ChannelFinder client URL
        const cfUrl = buildChannelFinderUrl(result.config);
        if (cfUrl) setChannelFinderUrl(cfUrl);

        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (pvwsRef.current) pvwsRef.current.disconnect();
    };
  }, []);

  /** Re-fetch the beamline configuration and reconnect clients without a full page reload. */
  const refreshConfig = useCallback(async ({ giturl, gitbranch, token } = {}) => {
    const params = new URLSearchParams(window.location.search);
    const pvwsParam = params.get('pvws') || '';
    const archiverParam = params.get('archiver') || '';
    const stored = loadStoredGitConfig();
    const valuesPath = params.get('values') || stored.valuesPath || '/values.yaml';

    const resolvedGiturl = giturl ?? params.get('giturl') ?? stored.giturl ?? config?._giturl ?? '';
    const resolvedBranch = gitbranch ?? params.get('gitbranch') ?? stored.gitbranch ?? config?._gitbranch ?? 'main';
    const resolvedToken = token ?? params.get('gittoken') ?? stored.token ?? null;

    const result = await loadConfig(valuesPath, {
      giturl: resolvedGiturl,
      gitbranch: resolvedBranch,
      token: resolvedToken || null,
    });

    setConfig(result.config);
    setDevices(result.devices);
    setCameras(result.cameras);
    setZones(result.zones);

    const defaultPvws = buildPvwsUrl(pvwsParam, result.pvws);
    const defaultArchiver = archiverParam || buildArchiverUrl(result.config) || '';
    const storedDs = loadStoredDataSources();
    const pvwsUrl = storedDs?.pvwsUrl || defaultPvws;
    const archiverUrl = storedDs?.archiverUrl || defaultArchiver;

    setDataSources({ pvwsUrl, archiverUrl, pvwsDefault: defaultPvws, archiverDefault: defaultArchiver });

    if (pvwsRef.current) pvwsRef.current.disconnect();
    const pvwsClient = new PvwsClient(pvwsUrl);
    pvwsRef.current = pvwsClient;
    pvwsClient.connect();

    archiverRef.current = archiverUrl ? new ArchiverClient(archiverUrl) : null;

    const cfUrl = buildChannelFinderUrl(result.config);
    if (cfUrl) setChannelFinderUrl(cfUrl);

    return result;
  }, [config]);

  /** Update DataSource URLs at runtime, persist to localStorage, reconnect clients. */
  const updateDataSources = useCallback((pvwsUrl, archiverUrl) => {
    saveDataSources({ pvwsUrl, archiverUrl });
    setDataSources((prev) => ({ ...prev, pvwsUrl, archiverUrl }));

    // Reconnect PVWS
    if (pvwsRef.current) pvwsRef.current.disconnect();
    const newPvws = new PvwsClient(pvwsUrl);
    pvwsRef.current = newPvws;
    newPvws.connect();

    // Recreate ArchiverClient
    archiverRef.current = archiverUrl ? new ArchiverClient(archiverUrl) : null;
  }, []);

  /** Reset DataSource URLs to YAML defaults. */
  const resetDataSources = useCallback(() => {
    localStorage.removeItem(LS_KEY);
    updateDataSources(dataSources.pvwsDefault, dataSources.archiverDefault);
  }, [dataSources.pvwsDefault, dataSources.archiverDefault, updateDataSources]);

  /** Save a new git config and reload the page to re-bootstrap from the new URL. */
  const updateGitConfig = useCallback((giturl, gitbranch, token, valuesPath) => {
    saveGitConfig(giturl, gitbranch, token, valuesPath);
    window.location.reload();
  }, []);

  /** Remove stored git config and reload (falls back to local values.yaml). */
  const resetGitConfig = useCallback(() => {
    clearGitConfig();
    window.location.reload();
  }, []);

  const storedGit = loadStoredGitConfig();

  const value = {
    config,
    devices,
    cameras,
    zones,
    loading,
    error,
    pvwsClient: pvwsRef.current,
    archiverClient: archiverRef.current,
    dataSources,
    updateDataSources,
    resetDataSources,
    refreshConfig,
    // Git bootstrap config (for Settings UI)
    gitConfig: {
      giturl:    storedGit.giturl    || config?._giturl    || '',
      gitbranch: storedGit.gitbranch || config?._gitbranch || 'main',
      valuesPath: storedGit.valuesPath || '/values.yaml',
    },
    updateGitConfig,
    resetGitConfig,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
