import { useState, useEffect } from 'react';

/**
 * Hook to subscribe to a PV via a PvwsClient instance.
 * Returns the latest update message (or null).
 */
export function usePv(client, pvName) {
  const [value, setValue] = useState(null);

  useEffect(() => {
    if (!client || !pvName) return;
    const unsub = client.subscribe(pvName, (msg) => {
      setValue(msg);
    });
    return unsub;
  }, [client, pvName]);

  return value;
}

/**
 * Hook to track pvws connection status.
 */
export function usePvwsStatus(client) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!client) return;
    setConnected(client.connected);
    return client.onStatusChange(setConnected);
  }, [client]);

  return connected;
}

/**
 * Hook that subscribes to multiple PVs for a camera.
 * Returns { acquire, acquireTime, gain } update objects.
 */
export function useCameraPvs(client, pvPrefix) {
  const acquire = usePv(client, pvPrefix ? `${pvPrefix}:Acquire` : null);
  const acquireTime = usePv(client, pvPrefix ? `${pvPrefix}:AcquireTime` : null);
  const gain = usePv(client, pvPrefix ? `${pvPrefix}:Gain` : null);
  const streamEnable = usePv(client, pvPrefix ? `${pvPrefix}:Stream1:EnableCallbacks` : null);

  return { acquire, acquireTime, gain, streamEnable };
}
