import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { parseDevices } from '../src/models/device.js';

const app = vi.hoisted(() => ({ value: { pvwsClient: null, devices: [] } }));
vi.mock('../src/context/AppContext.jsx', () => ({ useApp: () => app.value }));

import MagnetArrayView from '../src/components/views/magnets/MagnetArrayView.jsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const eliDevices = parseDevices(yaml.load(readFileSync(join(__dirname, 'eli-values.yaml'), 'utf8')));

// renderToStaticMarkup does not run effects, so there are no live values here (and no clicks):
// this covers the markup built from a real configuration. The bulk actions themselves are
// tested through applyBulk in magnetProcedures.test.js.
const render = (props = {}) => {
  app.value = { pvwsClient: null, devices: eliDevices, ...props };
  return renderToStaticMarkup(
    <MemoryRouter>
      <MagnetArrayView />
    </MemoryRouter>,
  );
};

const options = (html, label) => {
  const select = html.match(new RegExp(`${label}\\s*<select[^>]*>(.*?)</select>`, 's'));
  return select ? [...select[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]) : null;
};

describe('MagnetArrayView', () => {
  it('lists one row per magnet power supply of the configuration', () => {
    const html = render();
    const magnets = eliDevices.filter((d) => d.family === 'mag');
    expect(magnets.length).toBeGreaterThan(0);
    expect(html.match(/aria-label="select (?!all)/g)).toHaveLength(magnets.length);
    expect(html).toContain('>HCOR06<');
    expect(html).toContain('>COIL01<');
  });

  it('offers the zones, types and models found in the configuration', () => {
    const html = render();
    expect(options(html, 'Zone')).toEqual(['ALL', 'M1', 'M2', 'M3', 'M4']);
    expect(options(html, 'Type')).toEqual(['ALL', 'COR', 'DIP', 'QUA', 'SOL']);
    expect(options(html, 'Model')).toContain('bilt-itest');
  });

  it('has the bulk actions on the selection, disabled without PVWS', () => {
    const html = render();
    expect(html).toContain('Selected: 0 / ');
    for (const label of ['ON', 'OFF', 'RESET', 'ZERO']) {
      expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>\\s*${label}\\s*</button>`));
    }
    expect(html).toContain('>dI<');
  });

  it('has a set-current field and ON / OFF / RESET commands on every row', () => {
    const html = render();
    const rows = eliDevices.filter((d) => d.family === 'mag').length;
    expect(html.match(/title="Enter to set CURRENT_SP"/g)).toHaveLength(rows);
    expect(html.match(/title="STATE_SP = RESET"/g)).toHaveLength(rows);
  });

  it('links to snapshot save / restore and pretune', () => {
    const html = render();
    for (const to of ['/tools/magnets/save', '/tools/magnets/restore', '/tools/magnets/pretune']) {
      expect(html).toContain(`href="${to}"`);
    }
  });

  it('says so when the configuration has no magnets', () => {
    const html = render({ devices: eliDevices.filter((d) => d.family !== 'mag') });
    expect(html).toContain('No magnet power supplies');
    expect(html).not.toContain('<table');
  });
});
