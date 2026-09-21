import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { parseDevices } from '../src/models/device.js';
import {
  splitBase, magnetDevices, stateReached, currentReached,
  parseMagnetFile, snapshotToCsv,
  applyMagnets, summarizeApply,
  effectiveSteps, stepValue, pretuneRow,
  magnetFunc, stepCurrent, applyBulk,
} from '../src/services/magnetProcedures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadFixture = (f) => yaml.load(readFileSync(join(__dirname, f), 'utf8'));

const MAGNETS = [
  { base: 'LNF:MAG:QUATB101', prefix: 'LNF:MAG', name: 'QUATB101', root: 'QUATB101', zones: ['BTF'] },
  { base: 'LNF:MAG:CHHTB001', prefix: 'LNF:MAG', name: 'CHHTB001', root: 'CHHTB001', zones: ['BTF'] },
  { base: 'LEL:MAG:SPSU01:SOL01:COIL01', prefix: 'LEL:MAG:SPSU01:SOL01', name: 'COIL01', root: 'SOL01:COIL01', zones: ['M1'] },
];

describe('splitBase', () => {
  it('splits at the last colon, like SaveDynamic.py', () => {
    expect(splitBase('SPARC:MAG:OCEM:SBNDPL01')).toEqual({ prefix: 'SPARC:MAG:OCEM', name: 'SBNDPL01' });
    expect(splitBase('LONE')).toEqual({ prefix: '', name: 'LONE' });
  });
});

describe('magnetDevices', () => {
  it('keeps only the magnet power supplies of the configuration', () => {
    const magnets = magnetDevices(parseDevices(loadFixture('sparc-values.yaml')));
    expect(magnets.length).toBeGreaterThan(0);
    const sbn = magnets.find((m) => m.name === 'SBNDPL01');
    expect(sbn).toMatchObject({ base: 'SPARC:MAG:OCEM:SBNDPL01', prefix: 'SPARC:MAG:OCEM', root: 'SBNDPL01' });
    expect(sbn.zones).toEqual(['LINAC']);
  });

  it('ignores IOCs without a device list', () => {
    const magnets = magnetDevices([
      { family: 'mag', pvPrefix: 'A:B', params: { __iocLevel: true } },
      { family: 'mag', pvPrefix: 'A:B:PS1', iocPrefix: 'A:B', params: {}, zone: 'Z1', allZones: ['Z1'] },
      { family: 'cam', pvPrefix: 'A:CAM1', params: {} },
    ]);
    expect(magnets.map((m) => m.base)).toEqual(['A:B:PS1']);
  });

  it('keeps names with a colon addressable by their root', () => {
    const [m] = magnetDevices([
      { family: 'mag', pvPrefix: 'LEL:MAG:SPSU01:SOL01:COIL01', iocPrefix: 'LEL:MAG:SPSU01', params: {}, allZones: [] },
    ]);
    expect(m.root).toBe('SOL01:COIL01');
    expect(`${m.prefix}:${m.name}`).toBe(m.base);
  });
});

describe('stateReached / currentReached', () => {
  it('needs no state when none is desired or the state cannot be commanded', () => {
    expect(stateReached('', 'FAULT')).toBe(true);
    expect(stateReached('FAULT', 'ON')).toBe(true);
  });

  it('matches the desired state, with STANDBY counting as OFF', () => {
    expect(stateReached('ON', 'ON')).toBe(true);
    expect(stateReached('ON', 'STANDBY')).toBe(false);
    expect(stateReached('OFF', 'STANDBY')).toBe(true);
    expect(stateReached('OFF', 'ON')).toBe(false);
    expect(stateReached('STANDBY', 'OFF')).toBe(false);
  });

  it('ignores the current of a supply that has to be OFF', () => {
    expect(currentReached('OFF', 50, 0, 0.1)).toBe(true);
    expect(currentReached('ON', 10, 10.09, 0.1)).toBe(true);
    expect(currentReached('ON', 10, 10.2, 0.1)).toBe(false);
  });
});

describe('parseMagnetFile — csv', () => {
  const CSV = [
    'Name,Prefix,Current,State',
    'QUATB101,LNF:MAG,80.5,ON',
    'CHHTB001,LNF:MAG,0,STANDBY',
    'BADCUR,LNF:MAG,abc,ON',
    ',LNF:MAG,1,ON',
    'FAULTY,LNF:MAG,3,FAULT',
    'QUATB101,LNF:MAG,7,ON',
  ].join('\r\n');

  it('reads name, prefix, current and state', () => {
    const { rows } = parseMagnetFile('snap.csv', CSV, MAGNETS);
    expect(rows[0]).toEqual({ base: 'LNF:MAG:QUATB101', prefix: 'LNF:MAG', name: 'QUATB101', current: 80.5, state: 'ON' });
    expect(rows[1]).toMatchObject({ name: 'CHHTB001', current: 0, state: 'STANDBY' });
  });

  it('blanks a state that cannot be commanded', () => {
    const { rows } = parseMagnetFile('snap.csv', CSV, MAGNETS);
    expect(rows.find((r) => r.name === 'FAULTY').state).toBe('');
  });

  it('reports and skips bad, incomplete and duplicated rows', () => {
    const { rows, skipped } = parseMagnetFile('snap.csv', CSV, MAGNETS);
    expect(rows.map((r) => r.name)).toEqual(['QUATB101', 'CHHTB001', 'FAULTY']);
    expect(skipped).toHaveLength(3);
    expect(skipped.join('|')).toMatch(/BADCUR \(bad current "abc"\)/);
    expect(skipped.join('|')).toMatch(/missing Name\/Prefix/);
    expect(skipped.join('|')).toMatch(/QUATB101 \(duplicate\)/);
  });

  it('round-trips a snapshot', () => {
    const rows = [
      { name: 'QUATB101', prefix: 'LNF:MAG', current: 80.5, state: 'ON' },
      { name: 'COIL01', prefix: 'LEL:MAG:SPSU01:SOL01', current: -3, state: 'STANDBY' },
    ];
    const csv = snapshotToCsv(rows);
    expect(csv.split('\n')[0]).toBe('Name,Prefix,Current,State');
    const back = parseMagnetFile('x.csv', csv, MAGNETS).rows;
    expect(back.map((r) => [r.base, r.current, r.state])).toEqual([
      ['LNF:MAG:QUATB101', 80.5, 'ON'],
      ['LEL:MAG:SPSU01:SOL01:COIL01', -3, 'STANDBY'],
    ]);
  });
});

describe('parseMagnetFile — dataset (.dat)', () => {
  it('reads the 4 column syntax, with polarity and state code', () => {
    const dat = [
      'QUATB101\t80.000\t-\t2',
      '# DHSTB001\t288.500\t+\t2',
      'CHHTB001\t0.000\t*\t1',
      'CVVTB001\t-3.000\t*\t2',
      'UNKNOWN1\t1.0\t+\t2',
      'SOL01:COIL01 5 + 9',
    ].join('\n');
    const { rows, skipped } = parseMagnetFile('LINAC_BTF', dat, MAGNETS);
    expect(rows).toEqual([
      { base: 'LNF:MAG:QUATB101', prefix: 'LNF:MAG', name: 'QUATB101', current: -80, state: 'ON' },
      { base: 'LNF:MAG:CHHTB001', prefix: 'LNF:MAG', name: 'CHHTB001', current: 0, state: 'OFF' },
      { base: 'LEL:MAG:SPSU01:SOL01:COIL01', prefix: 'LEL:MAG:SPSU01:SOL01', name: 'COIL01', current: 5, state: '' },
    ]);
    expect(skipped).toEqual(['CVVTB001 (not in configuration)', 'UNKNOWN1 (not in configuration)']);
  });

  it('accepts the 5 column syntax (leading index) and never yields -0', () => {
    const { rows } = parseMagnetFile('x.dat', '12 QUATB101 0.0 - 2\n', MAGNETS);
    expect(rows).toHaveLength(1);
    expect(Object.is(rows[0].current, 0)).toBe(true);
  });

  it('reports a bad value instead of failing', () => {
    const { rows, skipped } = parseMagnetFile('x.dat', 'QUATB101 abc + 2\n', MAGNETS);
    expect(rows).toEqual([]);
    expect(skipped).toEqual(['QUATB101 (bad value "abc")']);
  });
});

/* -------- simulated hardware with a virtual clock -------- */

function fakeHardware(devs, { stateDelayMs = 1000 } = {}) {
  let t = 0;
  const pv = new Map();
  const pending = [];
  const log = [];
  for (const [base, d] of Object.entries(devs)) {
    pv.set(`${base}:STATE_RB`, d.state);
    pv.set(`${base}:CURRENT_RB`, d.rb ?? 0);
    pv.set(`${base}:CURRENT_SP`, d.sp ?? 0);
  }
  const settle = () => {
    for (const p of pending.filter((x) => x.at <= t)) pv.set(p.pv, p.value);
    pending.splice(0, pending.length, ...pending.filter((x) => x.at > t));
  };
  return {
    log,
    pv,
    get time() { return t; },
    io: {
      now: () => t,
      sleep: async (ms) => { t += ms; settle(); },
      readState: (base) => pv.get(`${base}:STATE_RB`) ?? null,
      readNumber: (name) => pv.get(name) ?? null,
      write: (name, value) => {
        log.push([name, value]);
        if (name.endsWith(':STATE_SP')) {
          const base = name.slice(0, -':STATE_SP'.length);
          if (devs[base].stuck) return;
          pending.push({ at: t + stateDelayMs, pv: `${base}:STATE_RB`, value });
        } else {
          pv.set(name, value);
        }
      },
    },
  };
}

describe('applyMagnets', () => {
  it('writes the states, waits for them, then writes the currents', async () => {
    const hw = fakeHardware({ A: { state: 'STANDBY' }, B: { state: 'ON' } });
    const result = await applyMagnets(
      [{ base: 'A', current: 10, state: 'ON' }, { base: 'B', current: 5, state: 'ON' }],
      hw.io,
    );
    expect(hw.log).toEqual([['A:STATE_SP', 'ON'], ['A:CURRENT_SP', 10], ['B:CURRENT_SP', 5]]);
    expect(result).toEqual({ applied: ['A', 'B'], unchanged: [], stateTimeout: [], errors: [] });
  });

  it('never sets the current of a supply whose state is not reached in time', async () => {
    const hw = fakeHardware({ A: { state: 'STANDBY', stuck: true }, B: { state: 'STANDBY' } });
    const result = await applyMagnets(
      [{ base: 'A', current: 10, state: 'ON' }, { base: 'B', current: 5, state: 'ON' }],
      hw.io,
      { stateTimeoutMs: 5000 },
    );
    expect(result.stateTimeout).toEqual(['A']);
    expect(result.applied).toEqual(['B']);
    expect(hw.log.map(([name]) => name)).not.toContain('A:CURRENT_SP');
    expect(hw.time).toBeGreaterThanOrEqual(5000);
  });

  it('does not rewrite a current that already holds the value, unless forced', async () => {
    const devs = () => ({ A: { state: 'ON', sp: 10 } });
    const plain = fakeHardware(devs());
    await applyMagnets([{ base: 'A', current: 10, state: 'ON' }], plain.io);
    expect(plain.log).toEqual([]);

    const forced = fakeHardware(devs());
    await applyMagnets([{ base: 'A', current: 10, state: 'ON' }], forced.io, { forceCurrent: true });
    expect(forced.log).toEqual([['A:CURRENT_SP', 10]]);
  });

  it('leaves the state alone when none is desired', async () => {
    const hw = fakeHardware({ A: { state: 'FAULT' } });
    const result = await applyMagnets([{ base: 'A', current: 3, state: '' }], hw.io);
    expect(hw.log).toEqual([['A:CURRENT_SP', 3]]);
    expect(result.applied).toEqual(['A']);
  });

  it('retry skips what is already at its target and redoes the rest', async () => {
    const hw = fakeHardware({
      DONE: { state: 'ON', rb: 10.05, sp: 10 },
      LAG: { state: 'ON', rb: 4, sp: 10 },
      OFFNOW: { state: 'STANDBY', rb: 0, sp: 0 },
    });
    const result = await applyMagnets(
      [
        { base: 'DONE', current: 10, state: 'ON' },
        { base: 'LAG', current: 10, state: 'ON' },
        { base: 'OFFNOW', current: 99, state: 'OFF' },
      ],
      hw.io,
      { retry: true, forceCurrent: true, tolerance: 0.1 },
    );
    expect(result.unchanged).toEqual(['DONE', 'OFFNOW']);
    expect(result.applied).toEqual(['LAG']);
    expect(hw.log).toEqual([['LAG:CURRENT_SP', 10]]);
  });

  it('reports a device whose PVs are unknown and carries on with the others', async () => {
    const hw = fakeHardware({ B: { state: 'ON' } });
    const result = await applyMagnets(
      [{ base: 'GONE', current: 1, state: 'ON' }, { base: 'B', current: 2, state: 'ON' }],
      hw.io,
    );
    expect(result.errors).toEqual(['GONE: GONE:STATE_RB has no value']);
    expect(result.applied).toEqual(['B']);
  });

  it('summarizes the outcome', async () => {
    const hw = fakeHardware({ A: { state: 'STANDBY', stuck: true }, B: { state: 'ON', sp: 5 } });
    const devices = [{ base: 'A', current: 1, state: 'ON' }, { base: 'B', current: 5, state: 'ON' }];
    const result = await applyMagnets(devices, hw.io, { stateTimeoutMs: 2000 });
    const text = summarizeApply(result, devices.length, 2000);
    expect(text).toContain('Applied to 1 of 2 devices.');
    expect(text).toContain('State NOT reached within 2 s, current NOT set (use Retry):\nA');
  });
});

describe('pretune steps', () => {
  it('treats nsteps <= 0 or garbage as a single direct step', () => {
    expect(effectiveSteps(0)).toBe(1);
    expect(effectiveSteps(-3)).toBe(1);
    expect(effectiveSteps('abc')).toBe(1);
    expect(effectiveSteps('4')).toBe(4);
    expect(effectiveSteps(2.9)).toBe(2);
  });

  it('goes from I0 to I1 in equal steps, exact at both ends', () => {
    // 0.1 * 3 would drift: the last step must be exactly I1
    expect(stepValue(0, 0.3, 3, 0)).toBe(0);
    expect(stepValue(0, 0.3, 3, 3)).toBe(0.3);
    expect(stepValue(10, 20, 4, 1)).toBe(12.5);
    expect(stepValue(10, 20, 4, 2)).toBe(15);
    expect(stepValue(20, 10, 4, 1)).toBe(17.5);
  });

  it('clamps steps outside the range', () => {
    expect(stepValue(10, 20, 4, -1)).toBe(10);
    expect(stepValue(10, 20, 4, 9)).toBe(20);
  });

  it('computes set/next/prev around the counter', () => {
    expect(pretuneRow(10, 20, 4, 0)).toEqual({ calcstep: 2.5, set: 10, next: 12.5, prev: 10 });
    expect(pretuneRow(10, 20, 4, 2)).toEqual({ calcstep: 2.5, set: 15, next: 17.5, prev: 12.5 });
    expect(pretuneRow(10, 20, 4, 4)).toEqual({ calcstep: 2.5, set: 20, next: 20, prev: 17.5 });
  });

  it('is a single jump when nsteps is 0', () => {
    expect(pretuneRow(0, 50, 0, 0)).toEqual({ calcstep: 50, set: 0, next: 50, prev: 0 });
  });
});

describe('magnetFunc', () => {
  it('lets an explicit devfunc win', () => {
    expect(magnetFunc('QUATB101', 'unimag', 'SPECIAL')).toBe('SPECIAL');
  });

  it('infers the function from the device name, like conf_to_dev', () => {
    expect(magnetFunc('HCOR06', 'biltitest')).toBe('COR');
    expect(magnetFunc('CHHTB001', 'unimag')).toBe('COR');
    expect(magnetFunc('QUATB101', 'unimag')).toBe('QUA');
    expect(magnetFunc('SBNDPL01', 'modbusps')).toBe('DIP');
    expect(magnetFunc('DHSTB001', 'unimag')).toBe('DIP');
    expect(magnetFunc('SOL01:COIL01', 'sigmaphi')).toBe('SOL');
    expect(magnetFunc('SEX02', 'x')).toBe('SEX');
    expect(magnetFunc('UFS1', 'x')).toBe('UFS');
  });

  it('checks the families in the OPI order and falls back to the model', () => {
    expect(magnetFunc('HCORQUA1', 'x')).toBe('COR');
    expect(magnetFunc('PS42', 'modbusps')).toBe('modbusps');
    expect(magnetFunc('PS42', '')).toBe('');
  });

  it('is set on the magnets of a configuration', () => {
    const magnets = magnetDevices(parseDevices(loadFixture('eli-values.yaml')));
    const byName = Object.fromEntries(magnets.map((m) => [m.name, m]));
    expect(byName.HCOR06).toMatchObject({ func: 'COR', model: 'bilt-itest' });
    expect(byName.COIL01.func).toBe('SOL');
    expect(byName.DIP01.func).toBe('DIP');
    expect(byName.QUAD01.func).toBe('QUA');
  });
});

describe('stepCurrent', () => {
  it('adds and subtracts the step, whatever the sign given', () => {
    expect(stepCurrent(10, 2, 1)).toBe(12);
    expect(stepCurrent(10, 2, -1)).toBe(8);
    expect(stepCurrent(10, -2, 1)).toBe(12);
  });

  it('does not accumulate floating point noise', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(stepCurrent(0.1, 0.2, 1)).toBe(0.3);
    expect(0.3 - 0.1).not.toBe(0.2);
    expect(stepCurrent(0.3, 0.1, -1)).toBe(0.2);
  });
});

describe('applyBulk', () => {
  const makeIo = (values = {}, failOn = null) => {
    const writes = [];
    return {
      writes,
      readNumber: (pv) => values[pv] ?? null,
      write: (pv, v) => {
        if (pv === failOn) throw new Error('write refused');
        writes.push([pv, v]);
      },
    };
  };

  it('writes STATE_SP of every selected magnet', () => {
    const io = makeIo();
    const result = applyBulk({ type: 'state', state: 'RESET' }, ['A:B:PS1', 'A:B:PS2'], io);
    expect(io.writes).toEqual([['A:B:PS1:STATE_SP', 'RESET'], ['A:B:PS2:STATE_SP', 'RESET']]);
    expect(result).toEqual({ done: ['A:B:PS1', 'A:B:PS2'], errors: [] });
  });

  it('zeroes CURRENT_SP', () => {
    const io = makeIo();
    applyBulk({ type: 'zero' }, ['A:PS1'], io);
    expect(io.writes).toEqual([['A:PS1:CURRENT_SP', 0]]);
  });

  it('steps CURRENT_SP from its live value', () => {
    const io = makeIo({ 'A:PS1:CURRENT_SP': 0.1, 'A:PS2:CURRENT_SP': -3 });
    applyBulk({ type: 'step', step: 0.2, sign: 1 }, ['A:PS1', 'A:PS2'], io);
    expect(io.writes).toEqual([['A:PS1:CURRENT_SP', 0.3], ['A:PS2:CURRENT_SP', -2.8]]);
  });

  it('reports the magnets it cannot act on and carries on with the others', () => {
    const io = makeIo({ 'A:PS2:CURRENT_SP': 1 }, 'A:PS3:CURRENT_SP');
    const result = applyBulk({ type: 'step', step: 1, sign: -1 }, ['A:PS1', 'A:PS2', 'A:PS3'], io);
    expect(result.done).toEqual(['A:PS2']);
    expect(result.errors).toEqual([
      'A:PS1: A:PS1:CURRENT_SP has no value',
      'A:PS3: A:PS3:CURRENT_SP has no value',
    ]);
    expect(io.writes).toEqual([['A:PS2:CURRENT_SP', 0]]);
  });
});
