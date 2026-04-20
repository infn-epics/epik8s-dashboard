import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildCameraConfigSnapshot,
  resolveCameraConfigSnapshot,
  saveCameraConfigPreset,
  loadCameraConfigPreset,
  listCameraConfigPresets,
} from '../src/services/cameraConfigStorage.js';

function makeStorage() {
  const store = new Map();
  return {
    getItem: vi.fn((k) => (store.has(k) ? store.get(k) : null)),
    setItem: vi.fn((k, v) => store.set(k, String(v))),
    removeItem: vi.fn((k) => store.delete(k)),
    clear: vi.fn(() => store.clear()),
  };
}

describe('cameraConfigStorage', () => {
  beforeEach(() => {
    global.localStorage = makeStorage();
  });

  it('builds a snapshot with rows, cols, and selected camera ids', () => {
    const cameras = [
      { id: 'cam-1', name: 'CAM1', pvPrefix: 'BL:CAM:1' },
      { id: 'cam-2', name: 'CAM2', pvPrefix: 'BL:CAM:2' },
    ];

    const snapshot = buildCameraConfigSnapshot({
      name: 'test-grid',
      rows: 2,
      cols: 2,
      selections: { 0: 1 },
      cameras,
    });

    expect(snapshot.name).toBe('test-grid');
    expect(snapshot.rows).toBe(2);
    expect(snapshot.cols).toBe(2);
    expect(snapshot.tiles[0].cameraId).toBe('cam-2');
  });

  it('restores row, col and tile selections by camera id', () => {
    const cameras = [
      { id: 'cam-1', name: 'CAM1', pvPrefix: 'BL:CAM:1' },
      { id: 'cam-2', name: 'CAM2', pvPrefix: 'BL:CAM:2' },
    ];

    const resolved = resolveCameraConfigSnapshot({
      rows: 3,
      cols: 1,
      tiles: [{ cameraId: 'cam-2' }, { cameraId: 'cam-1' }],
    }, cameras);

    expect(resolved.rows).toBe(3);
    expect(resolved.cols).toBe(1);
    expect(resolved.selections[0]).toBe(1);
    expect(resolved.selections[1]).toBe(0);
  });

  it('saves and lists named presets in local storage', () => {
    saveCameraConfigPreset('operators', { rows: 2, cols: 3, tiles: [] });

    expect(loadCameraConfigPreset('operators')).toMatchObject({ rows: 2, cols: 3 });
    expect(listCameraConfigPresets()).toContain('operators');
  });
});
