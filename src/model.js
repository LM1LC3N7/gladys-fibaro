// -----------------------------------------------------------------------------
// Which box answers: its model and API version, from /api/settings/info (pure).
//
// Every box has a serial number "<model>-<number>": HC2-011111, HCL-…,
// HC3-00012345, HC3L-…, YH-… (Yubii Home), ZB-… (Zooz Z-Box, an HC3 inside).
// Recent firmwares add `platform` / `oemId`. Home Center 2 and Lite speak
// API v4 (firmware 4.x), the HC3 family API v5 (firmware 5.x). Same rules as
// pyfibaro (common/const.py), longest prefix first so HC3L is not an HC3.
// -----------------------------------------------------------------------------

const MODELS = [
  { prefix: 'HC3L', name: 'Home Center 3 Lite', api: 5 },
  { prefix: 'HC3', name: 'Home Center 3', api: 5 },
  { prefix: 'HC2', name: 'Home Center 2', api: 4 },
  { prefix: 'HCL', name: 'Home Center Lite', api: 4 },
  { prefix: 'YHP', name: 'Yubii Home Pro', api: 5 },
  { prefix: 'YH', name: 'Yubii Home', api: 5 },
  { prefix: 'ZB', name: 'Z-Box Hub', api: 5 },
];

const modelOf = (code) => {
  const text = String(code ?? '')
    .trim()
    .toUpperCase();
  return text === '' ? undefined : MODELS.find((m) => text.startsWith(m.prefix));
};

/**
 * @param {object} info the answer of /api/settings/info
 * @returns {{ name: string, api: 4 | 5, serial: string, version: string, unit: 'C' | 'F' }}
 */
export function detectModel(info) {
  const raw = info && typeof info === 'object' ? info : {};
  const serial = String(raw.serialNumber ?? '').trim();
  const version = String(raw.currentVersion?.version ?? raw.softVersion ?? '').trim();
  const known = modelOf(raw.platform) ?? modelOf(raw.oemId) ?? modelOf(serial);
  const major = Number.parseInt(version, 10);
  // An unknown model with a 4.x firmware is an HC2-like box; anything else speaks v5.
  const api = known?.api ?? (major === 4 ? 4 : 5);
  return {
    name: known?.name ?? (api === 4 ? 'Home Center' : 'Fibaro box'),
    api,
    serial,
    version,
    unit: String(raw.temperatureUnit ?? '').toUpperCase() === 'F' ? 'F' : 'C',
  };
}

/** A box answers /api/settings/info with at least its serial number or firmware. */
export const looksLikeInfo = (info) =>
  Boolean(info && typeof info === 'object' && (info.serialNumber || info.softVersion));
