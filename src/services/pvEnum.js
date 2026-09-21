/**
 * Helpers to read a PVWS update message (as merged by usePv / useLivePvs):
 * enum labels, numbers and alarm severity.
 */

export function resolveEnumChoices(pvMsg) {
  if (!pvMsg) return [];
  const c = pvMsg.choices || pvMsg.enumStrings || pvMsg.enum_strs || pvMsg.labels;
  return Array.isArray(c) ? c : [];
}

export function resolveEnumLabel(pvMsg) {
  if (!pvMsg) return '---';
  const direct = pvMsg.display || pvMsg.text || pvMsg.string || pvMsg.str || pvMsg.valueStr;
  if (typeof direct === 'string' && direct.trim() !== '') return direct;

  const choices = resolveEnumChoices(pvMsg);
  const raw = pvMsg.value;
  const idx = typeof raw === 'number' ? raw : parseInt(raw, 10);
  if (choices.length && Number.isInteger(idx) && idx >= 0 && idx < choices.length) {
    return String(choices[idx]);
  }

  return raw !== null && raw !== undefined ? String(raw) : '---';
}

/** Upper-case enum label, or null while the PV has no value yet. */
export function pvStateLabel(pvMsg) {
  if (!pvMsg || pvMsg.value === null || pvMsg.value === undefined) return null;
  return resolveEnumLabel(pvMsg).trim().toUpperCase();
}

/** Numeric value, or null while the PV has none (or it is not a number). */
export function pvNumber(pvMsg) {
  const raw = pvMsg?.value;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** EPICS reports MINOR/MAJOR; WARNING is accepted as an alias of MINOR. */
export function alarmLevel(pvMsg) {
  const sev = String(pvMsg?.severity ?? '').toUpperCase();
  if (sev === 'MAJOR') return 'major';
  if (sev === 'MINOR' || sev === 'WARNING') return 'minor';
  return '';
}
