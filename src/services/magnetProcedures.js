/**
 * Magnet procedures — array, pretune, save, restore.
 *
 * Port of the Phoebus displays in epik8s-btf/opi/epik8s-opi/unimag-opi
 * (pretune/, restore/, SaveDynamic.py) and of Scripts/magapply.py, keeping the
 * same file formats so snapshots and datasets are interchangeable with them.
 *
 * Everything here is UI free: PV access goes through a small `io` object so the
 * sequence can be unit tested (see createPvIo for the PVWS one).
 */

import { pvNumber, pvStateLabel } from './pvEnum.js';

/** States that can be commanded via STATE_SP; anything else (FAULT, EXT_INTLK ...) is skipped. */
export const RESTORABLE_STATES = ['ON', 'STANDBY', 'OFF'];

export const DEFAULT_TOLERANCE = 0.1;
/** Fixed tolerance of the simple Load Dataset display (MagnetChannelSet.bob). */
export const SIMPLE_TOLERANCE = 0.5;
export const STATE_TIMEOUT_MS = 20000;
export const POLL_MS = 200;
/** CURRENT_SP is not rewritten when it already holds the wanted value within this. */
export const CURRENT_EPSILON = 0.001;

/** StateCode column of a plain-text dataset -> desired STATE_SP. */
const DAT_STATE_CODES = { 1: 'OFF', 2: 'ON' };

export const SNAPSHOT_HEADER = 'Name,Prefix,Current,State';

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

/**
 * Split a PV base "P:R" the way SaveDynamic.py does: the last segment is the
 * device name (CSV "Name"), everything before it the prefix (CSV "Prefix").
 */
export function splitBase(base) {
  const idx = base.lastIndexOf(':');
  return idx < 0
    ? { prefix: '', name: base }
    : { prefix: base.slice(0, idx), name: base.slice(idx + 1) };
}

/**
 * Function of a magnet (COR, QUA, DIP, SOL, SEX, UFS): the "Type" filter of mag_dynamic.bob.
 * An explicit devfunc of the configuration wins; otherwise it is inferred from the device
 * name, in this order, like epik8sutil.conf_to_dev does; anything else keeps its model.
 */
const FUNC_BY_NAME = [
  ['COR', ['HCV', 'HCOR', 'VCOR', 'HCR', 'VCR', 'CHH', 'CVV']],
  ['QUA', ['QUA', 'QUAD', 'QSK']],
  ['DIP', ['DIP', 'DPL', 'DHS', 'DHR', 'DHP']],
  ['SOL', ['SOL']],
  ['SEX', ['SEX']],
  ['UFS', ['UFS']],
];

export function magnetFunc(name, model, explicit = '') {
  if (explicit) return explicit;
  const deviceName = String(name ?? '');
  for (const [func, tokens] of FUNC_BY_NAME) {
    if (tokens.some((t) => deviceName.includes(t))) return func;
  }
  return model || '';
}

/**
 * The magnet power supplies of the configuration (devgroup "mag"), as
 * { base, prefix, name, root, zones, func, model, iocName }.
 * `root` is the device as the OPI's R macro sees it (iocroot:name), used to
 * map the names of a plain-text dataset.
 */
export function magnetDevices(devices) {
  return (devices || [])
    .filter((d) => d.family === 'mag' && !d.params?.__iocLevel && d.pvPrefix)
    .map((d) => {
      const { prefix, name } = splitBase(d.pvPrefix);
      const root = d.iocPrefix && d.pvPrefix.startsWith(`${d.iocPrefix}:`)
        ? d.pvPrefix.slice(d.iocPrefix.length + 1)
        : name;
      return {
        base: d.pvPrefix,
        prefix,
        name,
        root,
        zones: d.allZones?.length ? d.allZones : (d.zone ? [d.zone] : []),
        func: magnetFunc(d.name, d.type, d.devfunc),
        model: d.type || '',
        iocName: d.iocName,
      };
    });
}

/* ------------------------------------------------------------------ */
/* State / current tests (same rules as the OPI led and colour rules)  */
/* ------------------------------------------------------------------ */

/** No (restorable) desired state: nothing to reach. STANDBY counts as OFF. */
export function stateReached(desired, actual) {
  if (!RESTORABLE_STATES.includes(desired)) return true;
  if (desired === 'OFF') return actual === 'OFF' || actual === 'STANDBY';
  return actual === desired;
}

/** The current of a supply that has to be OFF is not meaningful. */
export function currentReached(desiredState, desired, readback, tolerance) {
  if (desiredState === 'OFF') return true;
  return Math.abs(desired - readback) <= tolerance;
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const parts = line.split(',').map((p) => p.trim());
    return Object.fromEntries(header.map((h, i) => [h, parts[i] ?? '']));
  });
}

function csvRows(text, skipped) {
  const rows = [];
  for (const rec of parseCsv(text)) {
    const name = rec.Name || '';
    const prefix = rec.Prefix || '';
    if (!name || !prefix) {
      skipped.push(`${JSON.stringify(rec)} (missing Name/Prefix)`);
      continue;
    }
    const current = Number(rec.Current);
    if (rec.Current === '' || rec.Current === undefined || !Number.isFinite(current)) {
      skipped.push(`${name} (bad current "${rec.Current ?? ''}")`);
      continue;
    }
    const state = (rec.State || '').toUpperCase();
    rows.push({
      base: `${prefix}:${name}`,
      prefix,
      name,
      current,
      // INTERLOCK, FAULT ... cannot be commanded: leave the desired state blank
      state: RESTORABLE_STATES.includes(state) ? state : '',
    });
  }
  return rows;
}

/**
 * Plain-text dataset, whitespace separated, no header:
 *   [index] Name Current Pol StateCode      (e.g. BTF_RUN.dat)
 * Lines containing '#' are comments. Pol '-' inverts the sign, '*' and '+' keep it.
 * StateCode 1 -> OFF, 2 -> ON, anything else leaves the state blank.
 */
function datRows(text, magnets, skipped) {
  const byName = new Map();
  for (const m of magnets) byName.set(m.root, m);
  for (const m of magnets) if (!byName.has(m.name)) byName.set(m.name, m);

  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.includes('#')) continue;
    const parts = line.trim().split(/\s+/).filter(Boolean);
    let identifier; let value; let pol; let statecode;
    if (parts.length === 5) [, identifier, value, pol, statecode] = parts;
    else if (parts.length === 4) [identifier, value, pol, statecode] = parts;
    else continue;

    const number = Number(value);
    if (!Number.isFinite(number)) {
      skipped.push(`${identifier} (bad value "${value}")`);
      continue;
    }
    const magnet = byName.get(identifier);
    if (!magnet) {
      skipped.push(`${identifier} (not in configuration)`);
      continue;
    }
    const current = pol === '-' ? -number : number;
    rows.push({
      base: magnet.base,
      prefix: magnet.prefix,
      name: magnet.name,
      current: current === 0 ? 0 : current, // no "-0"
      state: DAT_STATE_CODES[statecode] || '',
    });
  }
  return rows;
}

/**
 * Read a snapshot (*.csv, header "Name,Prefix,Current,State") or a dataset
 * (anything else, e.g. *.dat or no extension).
 * Returns { rows: [{ base, prefix, name, current, state }], skipped: [string] }.
 */
export function parseMagnetFile(filename, text, magnets) {
  const skipped = [];
  const found = /\.csv$/i.test(filename) ? csvRows(text, skipped) : datRows(text, magnets, skipped);

  const seen = new Set();
  const rows = [];
  for (const row of found) {
    if (seen.has(row.base)) {
      skipped.push(`${row.name} (duplicate)`);
      continue;
    }
    seen.add(row.base);
    rows.push(row);
  }
  return { rows, skipped };
}

/** Snapshot file content: rows are { name, prefix, current, state }. */
export function snapshotToCsv(rows) {
  return `${SNAPSHOT_HEADER}\n${rows.map((r) => `${r.name},${r.prefix},${r.current},${r.state}`).join('\n')}\n`;
}

/* ------------------------------------------------------------------ */
/* Apply: STATE first, wait for it, then CURRENT                       */
/* ------------------------------------------------------------------ */

/**
 * io: {
 *   readState(base)   -> upper-case STATE_RB label, or null while unknown
 *   readNumber(pv)    -> number, or null while unknown
 *   write(pv, value)
 *   sleep?(ms), now?()          (default: real time)
 * }
 */
export function createPvIo(getPv, client) {
  return {
    readState: (base) => pvStateLabel(getPv(`${base}:STATE_RB`)),
    readNumber: (pv) => pvNumber(getPv(pv)),
    write: (pv, value) => client.put(pv, value),
  };
}

/**
 * Push a set of power supplies to their desired state and current.
 *
 * A power supply cannot take a current before it is in the desired state, so:
 *   1. write STATE_SP of every device whose state is not the desired one
 *   2. wait (all together, up to stateTimeoutMs) until STATE_RB reaches it
 *   3. write CURRENT_SP, only of the devices whose state has been reached
 * Devices whose state is not reached in time do not get the current: use retry to redo them.
 *
 * devices      : [{ base, current, state }]
 * retry        : leave alone the devices that already reached state and current (within tolerance)
 * forceCurrent : write CURRENT_SP even if it already holds the wanted value
 *
 * Returns { applied: [base], unchanged: [base], stateTimeout: [base], errors: [string] }.
 */
export async function applyMagnets(devices, io, opts = {}) {
  const {
    tolerance = DEFAULT_TOLERANCE,
    retry = false,
    forceCurrent = false,
    stateTimeoutMs = STATE_TIMEOUT_MS,
    pollMs = POLL_MS,
    onProgress = () => {},
  } = opts;
  const sleep = io.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = io.now || (() => Date.now());

  const result = { applied: [], unchanged: [], stateTimeout: [], errors: [] };
  const fail = (base, err) => result.errors.push(`${base}: ${err.message || err}`);
  const known = (value, pv) => {
    if (value === null || value === undefined) throw new Error(`${pv} has no value`);
    return value;
  };
  const readState = (base) => known(io.readState(base), `${base}:STATE_RB`);

  const todo = [];
  for (const d of devices) {
    try {
      const stateOk = RESTORABLE_STATES.includes(d.state) ? stateReached(d.state, readState(d.base)) : true;
      if (retry) {
        const rb = known(io.readNumber(`${d.base}:CURRENT_RB`), `${d.base}:CURRENT_RB`);
        if (stateOk && currentReached(d.state, d.current, rb, tolerance)) {
          result.unchanged.push(d.base);
          continue;
        }
      }
      todo.push({ d, stateOk });
    } catch (err) {
      fail(d.base, err);
    }
  }

  // 1. states
  let waiting = [];
  const failed = new Set();
  for (const { d, stateOk } of todo) {
    if (stateOk) continue;
    try {
      io.write(`${d.base}:STATE_SP`, d.state);
      waiting.push(d);
    } catch (err) {
      failed.add(d.base);
      fail(d.base, err);
    }
  }

  // 2. wait for all of them together
  const deadline = now() + stateTimeoutMs;
  while (waiting.length && now() < deadline) {
    onProgress(`Waiting for ${waiting.length} power supplies to reach their state...`);
    await sleep(pollMs);
    waiting = waiting.filter((d) => {
      try {
        return !stateReached(d.state, readState(d.base));
      } catch (err) {
        failed.add(d.base);
        fail(d.base, err);
        return false;
      }
    });
  }
  const stuck = new Set(waiting.map((d) => d.base));

  // 3. currents
  onProgress('Setting currents...');
  for (const { d } of todo) {
    if (failed.has(d.base)) continue;
    if (stuck.has(d.base)) {
      result.stateTimeout.push(d.base);
      continue;
    }
    try {
      const sp = known(io.readNumber(`${d.base}:CURRENT_SP`), `${d.base}:CURRENT_SP`);
      if (forceCurrent || Math.abs(d.current - sp) > CURRENT_EPSILON) {
        io.write(`${d.base}:CURRENT_SP`, d.current);
      }
      result.applied.push(d.base);
    } catch (err) {
      fail(d.base, err);
    }
  }

  return result;
}

/** Text for the status area. */
export function summarizeApply(result, total, stateTimeoutMs = STATE_TIMEOUT_MS) {
  let msg = `Applied to ${result.applied.length} of ${total} devices.`;
  if (result.unchanged.length) msg += `\n${result.unchanged.length} already at their target.`;
  if (result.stateTimeout.length) {
    const shown = result.stateTimeout.slice(0, 10).join(', ');
    const more = result.stateTimeout.length > 10 ? `, ... (${result.stateTimeout.length} in total)` : '';
    msg += `\n\nState NOT reached within ${Math.round(stateTimeoutMs / 1000)} s, current NOT set (use Retry):\n${shown}${more}`;
  }
  if (result.errors.length) {
    const more = result.errors.length > 10 ? `\n... (${result.errors.length} in total)` : '';
    msg += `\n\nErrors:\n${result.errors.slice(0, 10).join('\n')}${more}`;
  }
  return msg;
}

/* ------------------------------------------------------------------ */
/* Pretune steps                                                       */
/* ------------------------------------------------------------------ */

/** nsteps <= 0 (or not a number) means a single direct step from I0 to I1. */
export function effectiveSteps(nsteps) {
  const n = Math.trunc(Number(nsteps));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Current of step k, going from the baseline i0 to the target i1 in n equal steps.
 * The ends are exact (no floating point drift on the last step).
 */
export function stepValue(i0, i1, n, k) {
  const step = Math.min(Math.max(k, 0), n);
  if (step === 0) return i0;
  if (step === n) return i1;
  return i0 + ((i1 - i0) / n) * step;
}

/**
 * All the values of a pretune row for the step `counter`.
 * i0 is the fixed baseline captured when the file was loaded / nsteps changed:
 * it must not follow the readback, or the steps would drift while the supply ramps.
 */
export function pretuneRow(i0, i1, nsteps, counter) {
  const n = effectiveSteps(nsteps);
  return {
    calcstep: (i1 - i0) / n,
    set: stepValue(i0, i1, n, counter),
    next: stepValue(i0, i1, n, counter + 1),
    prev: stepValue(i0, i1, n, counter - 1),
  };
}

/* ------------------------------------------------------------------ */
/* Bulk actions on the selected magnets (mag_dynamic.bob)              */
/* ------------------------------------------------------------------ */

/** Commands of STATE_SP the array offers (ON/OFF/RESET buttons). */
export const STATE_COMMANDS = ['ON', 'OFF', 'RESET'];

/** CURRENT_SP +/- step, rounded so that 10.1 + 0.1 does not become 10.200000000000001. */
export function stepCurrent(current, step, sign) {
  return Math.round((current + sign * Math.abs(step)) * 1e6) / 1e6;
}

/**
 * ON / OFF / RESET, ZERO and the "-" / "+" buttons of the selected magnets.
 *
 * action: { type: 'state', state } | { type: 'zero' } | { type: 'step', step, sign }
 * io    : { readNumber(pv), write(pv, value) }   (see createPvIo)
 *
 * Returns { done: [base], errors: [string] }.
 */
export function applyBulk(action, bases, io) {
  const done = [];
  const errors = [];
  for (const base of bases) {
    try {
      if (action.type === 'state') {
        io.write(`${base}:STATE_SP`, action.state);
      } else if (action.type === 'zero') {
        io.write(`${base}:CURRENT_SP`, 0);
      } else {
        const sp = io.readNumber(`${base}:CURRENT_SP`);
        if (sp === null || sp === undefined) throw new Error(`${base}:CURRENT_SP has no value`);
        io.write(`${base}:CURRENT_SP`, stepCurrent(sp, action.step, action.sign));
      }
      done.push(base);
    } catch (err) {
      errors.push(`${base}: ${err.message || err}`);
    }
  }
  return { done, errors };
}
