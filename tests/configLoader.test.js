import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/services/configLoader.js';

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

describe('loadConfig git fallback', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to deploy/values.yaml when root values.yaml is malformed', async () => {
    const malformedYaml = [
      'beamline: broken',
      'namespace: test',
      'iocDefaults: {}',
      'epicsConfiguration:',
      '  services: {}',
      'services:',
      '  iocs:',
      '    - name: bad',
      '      value: 1',
      '      value: 2',
    ].join('\n');

    const validYaml = [
      'beamline: euaps',
      'namespace: euaps',
      'iocDefaults:',
      '  adcamera:',
      '    template: adcamera',
      'epicsConfiguration:',
      '  services: {}',
      'services:',
      '  iocs:',
      '    - name: camtest',
      '      template: adcamera',
      '      devices:',
      '        - name: SIM01',
      '          width: 100',
      '          height: 100',
      '          iocinit:',
      '            - name: Stream1:EnableCallbacks',
      '              value: "1"',
    ].join('\n');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ content: btoa(malformedYaml), encoding: 'base64' }))
      .mockResolvedValueOnce(jsonResponse({ content: btoa(validYaml), encoding: 'base64' }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await loadConfig('/values.yaml', {
      giturl: 'https://github.com/example/beamline.git',
      gitbranch: 'main',
      token: null,
    });

    expect(result.config.beamline).toBe('euaps');
    expect(Array.isArray(result.devices)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
