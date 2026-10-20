// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { SENSOR_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  host: '',
  username: '',
  password: '',
  verify_certificate: true,
  include_plugins: false,
  sensor_interval: SENSOR_INTERVAL.default,
  allow_gates: false,
  allow_unlock: false,
  allow_valves: false,
};

/**
 * The origin of the box from what the user typed: "192.168.1.20",
 * "http://hc2.lan/", "https://192.168.1.30" or the address of a page of its
 * web interface. The API is always at <origin>/api.
 * @returns {{ origin: string } | { error: 'empty' | 'invalid' | 'credentials' }}
 */
export function parseBoxUrl(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { error: 'empty' };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    // The password has its own (secret) field: never in an address that gets logged.
    return { error: 'credentials' };
  }
  return { origin: url.origin };
}

const bounded = (raw, { min, max, default: fallback }) => {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
  const c = { ...DEFAULTS, ...given };
  const target = parseBoxUrl(c.host);
  const username = String(c.username ?? '').trim();
  const password = String(c.password ?? '');
  let error = target.error;
  if (!error && username === '') {
    error = 'no-user';
  } else if (!error && password === '') {
    error = 'no-password';
  }
  return {
    origin: target.origin,
    error,
    username,
    password,
    verifyCertificate: c.verify_certificate !== false,
    includePlugins: c.include_plugins === true,
    // Opening a gate / door and unlocking: only when the user ticked them (true, never "true").
    allowGates: c.allow_gates === true,
    allowUnlock: c.allow_unlock === true,
    allowValves: c.allow_valves === true,
    sensorInterval: Math.round(bounded(c.sensor_interval, SENSOR_INTERVAL)),
  };
}
