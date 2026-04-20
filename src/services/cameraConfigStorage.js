const CURRENT_KEY = 'epik8s-camera-config:current';
const PRESETS_KEY = 'epik8s-camera-config:presets';

function clampGrid(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(10, Math.round(num)));
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeCameraConfigName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, '-');
}

export function buildCameraConfigSnapshot({ name = '', rows = 2, cols = 3, selections = {}, cameras = [] }) {
  const safeRows = clampGrid(rows, 2);
  const safeCols = clampGrid(cols, 3);
  const totalTiles = safeRows * safeCols;

  const tiles = Array.from({ length: totalTiles }, (_, tileIdx) => {
    const preferredIdx = selections[tileIdx] !== undefined ? selections[tileIdx] : (cameras.length ? tileIdx % cameras.length : -1);
    const camera = cameras[preferredIdx];
    if (!camera) {
      return { tile: tileIdx, cameraId: null, pvPrefix: null, cameraName: null };
    }

    return {
      tile: tileIdx,
      cameraId: camera.id || camera.pvPrefix || `${camera.iocName || ''}:${camera.name || camera.deviceName || ''}`,
      cameraName: camera.name || camera.deviceName || '',
      pvPrefix: camera.pvPrefix || null,
    };
  });

  return {
    version: 1,
    name: normalizeCameraConfigName(name),
    rows: safeRows,
    cols: safeCols,
    tiles,
    updatedAt: new Date().toISOString(),
  };
}

export function resolveCameraConfigSnapshot(snapshot, cameras = []) {
  const safeRows = clampGrid(snapshot?.rows, 2);
  const safeCols = clampGrid(snapshot?.cols, 3);
  const tiles = Array.isArray(snapshot?.tiles) ? snapshot.tiles : [];
  const selections = {};

  tiles.forEach((tile, idx) => {
    const tileNumber = Number.isInteger(tile?.tile) ? tile.tile : idx;
    const matchIndex = cameras.findIndex((camera) => {
      const cameraId = camera?.id || camera?.pvPrefix || `${camera?.iocName || ''}:${camera?.name || camera?.deviceName || ''}`;
      return (
        (tile?.cameraId && cameraId === tile.cameraId) ||
        (tile?.pvPrefix && camera?.pvPrefix === tile.pvPrefix) ||
        (tile?.cameraName && (camera?.name === tile.cameraName || camera?.deviceName === tile.cameraName))
      );
    });

    if (matchIndex >= 0) {
      selections[tileNumber] = matchIndex;
    }
  });

  return {
    rows: safeRows,
    cols: safeCols,
    selections,
  };
}

export function saveCurrentCameraConfig(snapshot) {
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore storage errors
  }
}

export function loadCurrentCameraConfig() {
  try {
    return safeParse(localStorage.getItem(CURRENT_KEY), null);
  } catch {
    return null;
  }
}

export function listCameraConfigPresets() {
  try {
    const presets = safeParse(localStorage.getItem(PRESETS_KEY), {});
    return Object.keys(presets).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function saveCameraConfigPreset(name, snapshot) {
  const safeName = normalizeCameraConfigName(name);
  if (!safeName) throw new Error('Configuration name is required');

  try {
    const presets = safeParse(localStorage.getItem(PRESETS_KEY), {});
    presets[safeName] = {
      ...snapshot,
      name: safeName,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
    return presets[safeName];
  } catch {
    throw new Error('Unable to save camera configuration locally');
  }
}

export function loadCameraConfigPreset(name) {
  try {
    const presets = safeParse(localStorage.getItem(PRESETS_KEY), {});
    return presets[name] || null;
  } catch {
    return null;
  }
}

export function deleteCameraConfigPreset(name) {
  try {
    const presets = safeParse(localStorage.getItem(PRESETS_KEY), {});
    delete presets[name];
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // ignore storage errors
  }
}
