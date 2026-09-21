/**
 * Helpers for `epicsConfiguration.iocs`.
 *
 * The beamline config defines IOCs as a map keyed by IOC name:
 *
 *   epicsConfiguration:
 *     iocs:
 *       my-ioc:
 *         name: my-ioc
 *         template: motor
 *
 * The legacy list form (`- name: my-ioc`) is still accepted on read.
 */

/**
 * Normalize an `iocs` section (map or legacy list) into a list of IOC
 * objects that carry their own `name`. In the map form the key is used as
 * `name` when the entry does not define one. Map entries are copied, the
 * input is never mutated.
 */
export function iocsToList(iocs) {
  if (!iocs || typeof iocs !== 'object') return [];
  if (Array.isArray(iocs)) return iocs;
  return Object.entries(iocs).map(([key, ioc]) => ({
    ...(ioc && typeof ioc === 'object' ? ioc : {}),
    name: ioc?.name ?? key,
  }));
}

/**
 * Convert an `iocs` section (map or legacy list) into a map keyed by IOC
 * name. List entries without a name get a positional key so no data is lost.
 */
export function iocsToMap(iocs) {
  if (Array.isArray(iocs)) {
    const map = {};
    iocs.forEach((ioc, i) => {
      map[ioc?.name ?? `ioc-${i + 1}`] = ioc;
    });
    return map;
  }
  return iocs && typeof iocs === 'object' ? { ...iocs } : {};
}

/**
 * Return a copy of `map` where `key` is replaced by `newKey` -> `value`,
 * keeping the entry at the same position (renames do not reorder the file).
 */
export function replaceIoc(map, key, newKey, value) {
  const result = {};
  for (const [k, v] of Object.entries(map)) {
    if (k === key) result[newKey] = value;
    else result[k] = v;
  }
  return result;
}

/**
 * Return a copy of `map` with `newKey` -> `value` inserted right after
 * `afterKey` (appended when `afterKey` is not found).
 */
export function insertIocAfter(map, afterKey, newKey, value) {
  const result = {};
  let inserted = false;
  for (const [k, v] of Object.entries(map)) {
    result[k] = v;
    if (k === afterKey) {
      result[newKey] = value;
      inserted = true;
    }
  }
  if (!inserted) result[newKey] = value;
  return result;
}

/** First free `<base>-copy`, `<base>-copy2`, ... name in `map`. */
export function uniqueCopyName(map, base) {
  let candidate = `${base}-copy`;
  for (let n = 2; Object.hasOwn(map, candidate); n++) candidate = `${base}-copy${n}`;
  return candidate;
}
