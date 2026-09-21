import { useCallback, useEffect, useRef, useState } from 'react';

const FLUSH_MS = 100;

/**
 * Subscribe to a list of PVs and keep the latest (metadata-merged) update of each.
 *
 * Returns { get, version }:
 *  - get(pv) reads the latest message from a ref, so async code (an apply that
 *    waits for a state) always sees fresh values, never a stale render closure;
 *  - version changes (at most every FLUSH_MS) when something arrived, to re-render.
 *
 * Meant for tables of hundreds of PVs, where one useState per PV (usePv) would
 * re-render the whole table on every single update.
 */
export function useLivePvs(client, pvNames) {
  const store = useRef(new Map());
  const [version, setVersion] = useState(0);

  const key = [...new Set(pvNames)].sort().join('\n');

  useEffect(() => {
    if (!client || !key) return undefined;
    const names = key.split('\n');
    const wanted = new Set(names);
    for (const pv of store.current.keys()) {
      if (!wanted.has(pv)) store.current.delete(pv);
    }

    let timer = null;
    const flush = () => {
      timer = null;
      setVersion((v) => v + 1);
    };
    const unsubs = names.map((pv) => client.subscribe(pv, (msg) => {
      store.current.set(pv, { ...store.current.get(pv), ...msg });
      if (timer === null) timer = setTimeout(flush, FLUSH_MS);
    }));

    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubs.forEach((unsub) => unsub());
    };
  }, [client, key]);

  const get = useCallback((pv) => store.current.get(pv), []);
  return { get, version };
}
