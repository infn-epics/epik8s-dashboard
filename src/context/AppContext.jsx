import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { loadConfig } from '../services/configLoader.js';
import PvwsClient from '../services/pvws.js';

const AppContext = createContext(null);

function buildPvwsUrl(pvwsParam, pvwsConfig) {
  if (pvwsParam) return pvwsParam;
  if (pvwsConfig && pvwsConfig.host) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${pvwsConfig.host}/pvws/pv`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.hostname}/pvws/pv`;
}

export function AppProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [devices, setDevices] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const clientRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pvwsParam = params.get('pvws') || '';
    const valuesPath = params.get('values') || '/values.yaml';

    let cancelled = false;

    loadConfig(valuesPath)
      .then((result) => {
        if (cancelled) return;
        setConfig(result.config);
        setDevices(result.devices);
        setCameras(result.cameras);
        setZones(result.zones);

        const url = buildPvwsUrl(pvwsParam, result.pvws);
        const client = new PvwsClient(url);
        clientRef.current = client;
        client.connect();

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
      if (clientRef.current) clientRef.current.disconnect();
    };
  }, []);

  const value = {
    config,
    devices,
    cameras,
    zones,
    loading,
    error,
    pvwsClient: clientRef.current,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
