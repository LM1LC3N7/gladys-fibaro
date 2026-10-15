// -----------------------------------------------------------------------------
// Fibaro values (pure). A Home Center 2 serializes nearly every property as a
// string ("true", "21.50", "255,0,0,0", even JSON lists); an HC3 uses JSON
// types, but still sends some numbers as strings ("18.00"). Every reader goes
// through these helpers.
// -----------------------------------------------------------------------------

/** A finite number ("21.5", "21,5", 21.5), or undefined. */
export function toNumber(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'boolean') {
    return raw ? 1 : 0;
  }
  if (raw && typeof raw === 'object' && 'value' in raw) {
    // Some HC3 setpoints: { value, unit }.
    return toNumber(raw.value);
  }
  const text = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (text === '') {
    return undefined;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** A boolean: true / "true" / non-zero numbers; undefined when it is neither. */
export function toBool(raw) {
  if (typeof raw === 'boolean') {
    return raw;
  }
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (text === 'true' || text === 'on') {
    return true;
  }
  if (text === 'false' || text === 'off') {
    return false;
  }
  const n = toNumber(raw);
  return n === undefined ? undefined : n !== 0;
}

/** A top-level flag of /api/devices (enabled, visible, isPlugin): absent = `fallback`. */
export const flag = (raw, fallback) => (raw === undefined || raw === null ? fallback : toBool(raw));

/** A property that may be serialized JSON (HC2 lists): the parsed value, or the raw one. */
export function jsonish(raw) {
  if (typeof raw !== 'string') {
    return raw;
  }
  const text = raw.trim();
  if (!/^[[{]/.test(text)) {
    return raw;
  }
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}

/** A list property: a JSON list, a serialized one, or "a,b,c". */
export function toList(raw) {
  const value = jsonish(raw);
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
  return [];
}

/** "r,g,b,w" -> [r, g, b, w] (0–255 each), or undefined. */
export function parseColor(raw) {
  const parts = String(raw ?? '')
    .split(',')
    .map((s) => toNumber(s));
  if (parts.length !== 4 || parts.some((n) => n === undefined)) {
    return undefined;
  }
  return parts.map((n) => Math.max(0, Math.min(255, Math.round(n))));
}

export const rgbToInt = ([r, g, b]) => (r << 16) | (g << 8) | b;

export const intToRgb = (n) => {
  const v = Math.max(0, Math.min(0xffffff, Math.round(Number(n) || 0)));
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};

export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
