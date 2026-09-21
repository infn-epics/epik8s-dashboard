import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import {
  iocsToList, iocsToMap, replaceIoc, insertIocAfter, uniqueCopyName,
} from '../src/models/iocs.js';
import { parseDevices } from '../src/models/device.js';
import { findControllerInConfig } from '../src/services/beamlineControllerApi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadFixture = (f) => yaml.load(readFileSync(join(__dirname, f), 'utf8'));

describe('iocsToList', () => {
  it('returns [] for missing or invalid input', () => {
    expect(iocsToList(undefined)).toEqual([]);
    expect(iocsToList(null)).toEqual([]);
    expect(iocsToList('nope')).toEqual([]);
  });

  it('uses the map key as name when the entry has none', () => {
    const list = iocsToList({ a: { template: 'motor' }, b: { name: 'b', template: 'ocem' } });
    expect(list).toEqual([
      { template: 'motor', name: 'a' },
      { name: 'b', template: 'ocem' },
    ]);
  });

  it('keeps an explicit name over the key', () => {
    expect(iocsToList({ key: { name: 'explicit' } })[0].name).toBe('explicit');
  });

  it('tolerates empty entries and does not mutate the input', () => {
    const input = { empty: null, full: { template: 'motor' } };
    const snapshot = structuredClone(input);
    expect(iocsToList(input).map((i) => i.name)).toEqual(['empty', 'full']);
    expect(input).toEqual(snapshot);
  });

  it('passes the legacy list form through', () => {
    const list = [{ name: 'a' }, { name: 'b' }];
    expect(iocsToList(list)).toEqual(list);
  });
});

describe('iocsToMap', () => {
  it('converts a legacy list keeping order', () => {
    const map = iocsToMap([{ name: 'b', x: 1 }, { name: 'a', x: 2 }]);
    expect(Object.keys(map)).toEqual(['b', 'a']);
    expect(map.a).toEqual({ name: 'a', x: 2 });
  });

  it('does not lose list entries without a name', () => {
    expect(Object.keys(iocsToMap([{ template: 'motor' }, { name: 'a' }]))).toEqual(['ioc-1', 'a']);
  });

  it('copies a map and returns {} for empty input', () => {
    const src = { a: { name: 'a' } };
    const copy = iocsToMap(src);
    expect(copy).toEqual(src);
    expect(copy).not.toBe(src);
    expect(iocsToMap(undefined)).toEqual({});
  });
});

describe('map editing helpers', () => {
  const map = { a: { name: 'a' }, b: { name: 'b' }, c: { name: 'c' } };

  it('replaceIoc renames in place without reordering', () => {
    const out = replaceIoc(map, 'b', 'bb', { name: 'bb' });
    expect(Object.keys(out)).toEqual(['a', 'bb', 'c']);
    expect(out.bb).toEqual({ name: 'bb' });
  });

  it('insertIocAfter inserts right after the given key', () => {
    expect(Object.keys(insertIocAfter(map, 'a', 'x', { name: 'x' }))).toEqual(['a', 'x', 'b', 'c']);
    expect(Object.keys(insertIocAfter(map, 'c', 'x', { name: 'x' }))).toEqual(['a', 'b', 'c', 'x']);
  });

  it('insertIocAfter appends when the key is unknown', () => {
    expect(Object.keys(insertIocAfter(map, 'zzz', 'x', { name: 'x' }))).toEqual(['a', 'b', 'c', 'x']);
  });

  it('uniqueCopyName skips names already taken', () => {
    expect(uniqueCopyName(map, 'a')).toBe('a-copy');
    expect(uniqueCopyName({ ...map, 'a-copy': {}, 'a-copy2': {} }, 'a')).toBe('a-copy3');
  });
});

describe('map vs legacy list in config consumers', () => {
  it('parseDevices gives the same devices for a map and its legacy list', () => {
    const asMap = loadFixture('btf-values.yaml');
    expect(Array.isArray(asMap.epicsConfiguration.iocs)).toBe(false);

    const asList = structuredClone(asMap);
    asList.epicsConfiguration.iocs = Object.values(asMap.epicsConfiguration.iocs);

    const fromMap = parseDevices(asMap);
    expect(fromMap.length).toBeGreaterThan(0);
    expect(parseDevices(asList)).toEqual(fromMap);
  });

  it('parseDevices takes the IOC name from the map key when name is omitted', () => {
    const config = {
      beamline: 'test',
      epicsConfiguration: {
        iocs: { 'my-ioc': { iocprefix: 'TST', template: 'motor', devices: [{ name: 'M1' }] } },
      },
    };
    const [dev] = parseDevices(config);
    expect(dev.iocName).toBe('my-ioc');
    expect(dev.id).toBe('my-ioc:M1');
  });

  it('findControllerInConfig works with a map', () => {
    const config = {
      epicsConfiguration: {
        iocs: {
          motors: { iocprefix: 'A', devgroup: 'mot' },
          'beamline-controller': { iocprefix: 'BC', devgroup: 'global' },
        },
      },
    };
    expect(findControllerInConfig(config)).toMatchObject({ name: 'beamline-controller', prefix: 'BC' });
  });
});
