// -----------------------------------------------------------------------------
// One Fibaro device -> Gladys features, readers and writers (pure).
//
// A Fibaro device says what it is with its `type` (com.fibaro.FGD212), its
// `baseType` (com.fibaro.multilevelSwitch), its `interfaces` (battery, power,
// energy…), its `actions` and its `properties`. The role is looked up by type,
// then by base type, then guessed from the actions and properties, in the
// order of the Home Assistant `fibaro` integration. `mapDevice` returns:
//   features   the Gladys features (key relative to the device),
//   readers    [{ key, props, read(properties) -> number | undefined }]: the
//              feature is read again when one of `props` changes,
//   writers    { [key]: (value, properties) -> [{ name, args }] } (one device
//              action per entry),
//   throttled  the keys of the measurements (spaced by the sensor interval),
//   optimistic the keys without a property to read: Gladys keeps the value sent,
//   buttons    the central-scene keys: { keys: Map(keyId -> key), any?: key }.
// Value conventions: Fibaro levels are 0–99 (99 = full), booleans may be
// strings; the Gladys side follows the enums of server/utils/constants.js.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { centralScene } from './inventory.js';
import { clamp, intToRgb, parseColor, rgbToInt, toBool, toList, toNumber } from './values.js';

// Value enums of the Gladys core (server/utils/constants.js), not in the SDK.
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 };
export const THERMOSTAT_OPERATING_STATE = { IDLE: 0, HEATING: 1, COOLING: 2 };
export const BUTTON_STATUS = {
  CLICK: 1,
  DOUBLE_CLICK: 2,
  TRIPLE: 18,
  QUADRUPLE: 19,
  MANY: 21,
  LONG_PRESS: 48,
  LONG_RELEASE: 50,
};

/**
 * Z-Wave central scene attributes (CentralSceneEvent.keyAttribute) -> the
 * gesture of the scene trigger and the Gladys button value.
 */
export const KEY_ATTRIBUTES = new Map([
  ['pressed', ['pressed', BUTTON_STATUS.CLICK]],
  ['pressed1', ['pressed', BUTTON_STATUS.CLICK]],
  ['pressed2', ['double', BUTTON_STATUS.DOUBLE_CLICK]],
  ['pressed3', ['triple', BUTTON_STATUS.TRIPLE]],
  ['pressed4', ['quadruple', BUTTON_STATUS.QUADRUPLE]],
  ['pressed5', ['quintuple', BUTTON_STATUS.MANY]],
  ['helddown', ['held', BUTTON_STATUS.LONG_PRESS]],
  ['released', ['released', BUTTON_STATUS.LONG_RELEASE]],
]);

/** A keyAttribute -> { event, status? } (an unknown one keeps its name, no status). */
export function decodeKeyAttribute(attribute) {
  const raw = String(attribute ?? '').trim();
  const known = KEY_ATTRIBUTES.get(raw.toLowerCase());
  return known ? { event: known[0], status: known[1] } : { event: raw.toLowerCase() || 'unknown' };
}

const BUTTON_VALUES = [...new Set([...KEY_ATTRIBUTES.values()].map(([, s]) => s))];

// --- Roles ---------------------------------------------------------------------

/** type or baseType -> role (HA FIBARO_TYPEMAP, plus the HC3 types). */
export const ROLES = {
  'com.fibaro.binarySwitch': 'switch',
  'com.fibaro.remoteSwitch': 'switch',
  'com.fibaro.multilevelSwitch': 'dimmer',
  'com.fibaro.FGD212': 'dimmer',
  'com.fibaro.colorController': 'color',
  'com.fibaro.FGRGBW441M': 'color',
  'com.fibaro.rollerShutter': 'cover',
  'com.fibaro.baseShutter': 'cover',
  'com.fibaro.FGR': 'cover',
  'com.fibaro.FGRM222': 'cover',
  'com.fibaro.FGR221': 'cover',
  'com.fibaro.FGR223': 'cover',
  'com.fibaro.FGWR111': 'cover',
  'com.fibaro.remoteBaseShutter': 'cover',
  'com.fibaro.doorLock': 'lock',
  'com.fibaro.hvac': 'thermostat',
  'com.fibaro.hvacSystem': 'thermostat',
  'com.fibaro.hvacSystemAuto': 'thermostat',
  'com.fibaro.hvacSystemHeat': 'thermostat',
  'com.fibaro.hvacSystemCool': 'thermostat',
  'com.fibaro.hvacSystemHeatCool': 'thermostat',
  'com.fibaro.setpoint': 'thermostat',
  'com.fibaro.setPoint': 'thermostat',
  'com.fibaro.FGT001': 'thermostat',
  'com.fibaro.thermostatDanfoss': 'thermostat',
  'com.fibaro.doorSensor': 'opening',
  'com.fibaro.windowSensor': 'opening',
  'com.fibaro.doorWindowSensor': 'opening',
  'com.fibaro.FGDW002': 'opening',
  'com.fibaro.motionSensor': 'motion',
  'com.fibaro.FGMS001': 'motion',
  'com.fibaro.floodSensor': 'flood',
  'com.fibaro.FGFS101': 'flood',
  'com.fibaro.smokeSensor': 'smoke',
  'com.fibaro.FGSS001': 'smoke',
  'com.fibaro.heatDetector': 'smoke',
  'com.fibaro.fireDetector': 'smoke',
  'com.fibaro.lifeDangerSensor': 'smoke',
  'com.fibaro.coDetector': 'co',
  'com.fibaro.FGCD001': 'co',
  'com.fibaro.accelerometer': 'vibration',
  'com.fibaro.binarySensor': 'binary-sensor',
  'com.fibaro.securitySensor': 'binary-sensor',
  'com.fibaro.temperatureSensor': 'temperature',
  'com.fibaro.humiditySensor': 'humidity',
  'com.fibaro.lightSensor': 'illuminance',
  'com.fibaro.multilevelSensor': 'multilevel',
  'com.fibaro.energyMeter': 'energy-meter',
  'com.fibaro.powerMeter': 'power-meter',
  'com.fibaro.remoteController': 'remote',
  'com.fibaro.remoteSceneController': 'remote',
  'com.fibaro.FGPB101': 'remote',
  'com.fibaro.FGKF601': 'remote',
};

/** HC3 `deviceRole` of a generic binary sensor (the role the user picked). */
const SENSOR_ROLES = {
  DoorSensor: 'opening',
  WindowSensor: 'opening',
  GarageDoorSensor: 'opening',
  GateSensor: 'opening',
  MotionSensor: 'motion',
  PresenceSensor: 'motion',
  FloodSensor: 'flood',
  SmokeSensor: 'smoke',
  FireSensor: 'smoke',
  CoSensor: 'co',
};

const has = (dev, action) => dev.actions.includes(action);
const hasProp = (dev, prop) => dev.properties[prop] !== undefined && dev.properties[prop] !== null;
const hasInterface = (dev, name, prop) =>
  dev.interfaces ? dev.interfaces.includes(name) && hasProp(dev, prop) : hasProp(dev, prop);

// --- Words of a type ---------------------------------------------------------------

/**
 * The words of a type or base type, split on dots, dashes, underscores and
 * camelCase: com.fibaro.garageDoorOpener -> com, fibaro, garage, door, opener.
 * Matching whole words keeps "outdoorLight", "indoorUnit", "aggregateMeter"
 * or "clockSensor" out of the door, gate and lock rules.
 */
export const typeWords = (type) =>
  String(type ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

const wordsOf = (dev) => new Set([dev.type, dev.baseType].flatMap(typeWords));
const anyWord = (words, list) => list.some((w) => words.has(w));

// --- Shutters ------------------------------------------------------------------

/**
 * Types of roller shutters, blinds and awnings: rollerShutter, baseShutter,
 * remoteBaseShutter (HC3, Yubii Home), FGR (HC2 base type), FGRM222, FGR221,
 * FGR223 (Roller Shutter 2 and 3), FGWR111 (Walli Roller Shutter). Not the
 * FGRGBW controllers.
 */
const SHUTTER_WORDS = ['shutter', 'blind', 'blinds', 'curtain', 'awning'];
const FIBARO_SHUTTER = /^com\.fibaro\.(FGR(M?\d|$)|FGWR)/;
/** HC3 / Yubii `deviceRole` of a shutter module (the role picked in the box). */
const SHUTTER_ROLES = new Set([
  'BlindsWithPositioning',
  'BlindsWithoutPositioning',
  'VenetianBlinds',
  'RollerShutter',
  'Awning',
  'Curtain',
]);

// --- Gates, garage doors, doors, locks, valves -----------------------------------

const GATE_WORDS = ['barrier', 'gate', 'garage', 'door'];
const GATE_ROLES = new Set(['Gate', 'GarageDoor']);
/** Words of a role picked in the box (any case or spelling of it: Gate, gate, SlidingGate, GarageDoors…). */
const GATE_ROLE_WORDS = ['barrier', 'gate', 'gates', 'garage', 'door', 'doors', 'portal'];
/** A door sensor, a door lock or a door bell is not a gate. */
const NOT_A_GATE = ['sensor', 'lock', 'detector', 'bell'];
const VALVE_ROLES = new Set(['Valve', 'WaterValve', 'GasValve']);
/**
 * The name of a gate on a shutter module or a relay whose role was left to
 * another role (issue #4: "Portail" offered as a shutter). When in doubt, a
 * gate (the safe way: opening behind allow_gates): any name with garage /
 * garaje, portail, portillon, barrière, cancello, portón, portão, poort,
 * garagedeur, porte sectionnelle / basculante, the whole words gate and tor,
 * and the German -tor compounds (Rolltor, Hoftor, Einfahrtstor…).
 */
const GATE_NAME = new RegExp(
  [
    'garage',
    'garaje',
    'portail',
    'portillon',
    'barri[eè]re',
    'barrier',
    'cancello',
    'port[oó]n',
    'port[aã]o',
    'poort',
    'porte\\s+(sectionnelle|basculante)',
    '(^|[^\\p{L}])gates?($|[^\\p{L}])',
    '(^|[^\\p{L}])tor($|[^\\p{L}])',
    '(einfahrts|hof|roll|schiebe|garten|sektional|garagen|flügel|falt|kipp)tor',
  ].join('|'),
  'iu',
);
/** An explicit window word keeps "Volet fenêtre garage" a shutter. */
const WINDOW_NAME = /fen[eê]tre|velux|window|fenster/iu;
/**
 * A plain relay is a gate by its name only when the gate is the main word of
 * the name, at its start ("Portail", "Garage", "Porte de garage", "Hoftor"),
 * never "Chauffage garage" nor "Pompe portail".
 */
const RELAY_GATE_NAME =
  /^\s*(portails?|portillons?|gates?|barri[eè]res?|barriers?|porte\s+(de\s+|du\s+)?garage|garage\s*door|garagentor|garage|tor|(einfahrts|hof|roll|schiebe|garten|sektional|garagen|flügel|falt|kipp)tor)($|[^\p{L}])/iu;
/** Words of an appliance: a relay with one of them in its name is never a gate. */
const NOT_A_GATE_RELAY_NAME =
  /chauff|radiat|congel|congél|frigo|pompe|pump|ventil|interphone|sonnette|ballon|lave|s[eè]che|arrosage|prise|plug|lumi|[ée]clair|lampe|lamp|light|spot|heat|freez|fridge|intercom|bell|wash|dry|water|boiler|fan/iu;

/** The name of the device says gate (and no window word). */
const gateName = (dev) => GATE_NAME.test(dev.name ?? '') && !WINDOW_NAME.test(dev.name ?? '');

/** The HC3 / Yubii categories of a device ("lights", "blinds", "gates"…), lower case. */
const categoriesOf = (dev) =>
  toList(dev.properties.categories).map((c) => String(c).trim().toLowerCase());

/** The words of the role picked in the box: OutdoorLight -> outdoor, light. */
const roleWordsOf = (dev) => new Set(typeWords(dev.properties.deviceRole));

/**
 * A gate, a garage door or a motorized door:
 * - a type or base type with the word barrier, gate, garage or door,
 * - a role picked in the box with one of these words (Gate, GarageDoor, in
 *   any case or spelling), or the HC3 / Yubii "gates" category,
 * - by its name (GATE_NAME, no window word): a shutter-like device (a shutter
 *   module set up for a gate, as on the Yubii Home of issue #4), or a plain
 *   relay without a lamp role or category whose name starts with the gate
 *   (RELAY_GATE_NAME) and has no appliance word; never a lock nor a valve
 *   by its name.
 * Never a sensor, a lock nor a bell; never a switch, a dimmer nor a shutter:
 * opening it is off until the user allows it (allow_gates).
 */
export function isGate(dev) {
  const words = wordsOf(dev);
  const roleWords = roleWordsOf(dev);
  if (anyWord(words, NOT_A_GATE) || anyWord(roleWords, NOT_A_GATE)) {
    return false;
  }
  if (
    anyWord(words, GATE_WORDS) ||
    GATE_ROLES.has(dev.properties.deviceRole) ||
    anyWord(roleWords, GATE_ROLE_WORDS) ||
    categoriesOf(dev).includes('gates')
  ) {
    return true;
  }
  if (!gateName(dev) || isLock(dev) || isValve(dev)) {
    return false;
  }
  if (looksLikeShutter(dev)) {
    return true;
  }
  // A relay named "Portail": a gate on a relay (its turnOn is the pulse),
  // only when the gate is the main word of its name and no appliance word is
  // in it ("Chauffage garage", "Pompe portail", "Prise garage" stay switches).
  const name = dev.name ?? '';
  return (
    isRelay(dev) && !isLight(dev) && RELAY_GATE_NAME.test(name) && !NOT_A_GATE_RELAY_NAME.test(name)
  );
}

/** A lock: the secure / unsecure actions, or the word lock in its type. */
export function isLock(dev) {
  return (
    has(dev, 'secure') ||
    has(dev, 'unsecure') ||
    (wordsOf(dev).has('lock') && !wordsOf(dev).has('sensor'))
  );
}

/** A valve: the word valve in its type, or a valve role picked in the box. */
export function isValve(dev) {
  // A thermostatic valve head is a thermostat.
  if (isThermostat(dev)) {
    return false;
  }
  const words = wordsOf(dev);
  return (words.has('valve') && !words.has('sensor')) || VALVE_ROLES.has(dev.properties.deviceRole);
}

/** A gate (or a valve) driven by a plain relay: its value is the contact, not the position. */
const isRelay = (dev) =>
  !has(dev, 'open') && !has(dev, 'close') && !has(dev, 'setValue') && has(dev, 'turnOn');

/**
 * The state of a gate, read from `state` then `value`: 'open' (clearly: open,
 * true, 95 % and more), 'closed' (closed, false, 5 % and less), 'partial' (in
 * between), 'moving', or undefined (unknown). HC2 strings ("true", "99")
 * included.
 */
export function gateStateOf(p) {
  for (const raw of [p?.state, p?.value]) {
    const text = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (text === 'closed' || text === 'close') {
      return 'closed';
    }
    if (text === 'open' || text === 'opened') {
      return 'open';
    }
    if (text === 'opening' || text === 'closing') {
      return 'moving';
    }
    if (typeof raw === 'boolean' || text === 'true' || text === 'false') {
      return toBool(raw) ? 'open' : 'closed';
    }
    const n = toNumber(text);
    if (n !== undefined) {
      if (n >= 95) {
        return 'open';
      }
      return n <= 5 ? 'closed' : 'partial';
    }
  }
  return undefined;
}

/** A lock: 1 locked, 0 unlocked, undefined unknown. */
export const lockStateOf = (p) => binaryOf(p?.value ?? p?.secured);

/** A valve relay: 1 on (open), 0 off (closed), undefined unknown. */
export const valveStateOf = (p) => binaryOf(p?.value);

/** The options that allow a command (src/config.js keys, camelCase). */
export const GUARDS = { GATES: 'allowGates', UNLOCK: 'allowUnlock', VALVES: 'allowValves' };
/** The manifest key of each guard option. */
export const GUARD_OPTIONS = {
  allowGates: 'allow_gates',
  allowUnlock: 'allow_unlock',
  allowValves: 'allow_valves',
};

const deadCheck = (name, p) => {
  if (toBool(p?.dead) === true) {
    throw new Error(`${name} is reported dead by the box: command not sent`);
  }
};

/**
 * A roller shutter, a blind or an awning: by its type or base type, by the
 * role picked in the box, or by its open / close actions. Checked after the
 * gates, locks and valves and before the other roles, so a shutter is never a
 * switch nor a dimmer (an "everything off" of a voice assistant would close
 * or open it).
 */
export function isShutter(dev) {
  return !isGate(dev) && looksLikeShutter(dev);
}

/** The shutter rules alone (the gate rules not applied). */
function looksLikeShutter(dev) {
  const types = [dev.type, dev.baseType].filter(Boolean);
  if (wordsOf(dev).has('sensor')) {
    return false;
  }
  return (
    anyWord(wordsOf(dev), SHUTTER_WORDS) ||
    types.some((t) => FIBARO_SHUTTER.test(t)) ||
    SHUTTER_ROLES.has(dev.properties.deviceRole) ||
    (has(dev, 'open') && has(dev, 'close'))
  );
}

const isThermostat = (dev) =>
  hasProp(dev, 'thermostatMode') ||
  hasProp(dev, 'heatingThermostatSetpoint') ||
  (hasProp(dev, 'targetLevel') && has(dev, 'setTargetLevel'));

/** The role of a device, or undefined when nothing fits. */
export function roleOf(dev) {
  // Physical access and water first: never a switch, a dimmer nor a shutter.
  if (isGate(dev)) {
    return 'gate';
  }
  if (isLock(dev)) {
    return 'lock';
  }
  if (isValve(dev)) {
    return 'valve';
  }
  if (isShutter(dev)) {
    return 'cover';
  }
  let role = ROLES[dev.type] ?? ROLES[dev.baseType];
  if (role === 'binary-sensor') {
    role = SENSOR_ROLES[dev.properties.deviceRole] ?? role;
  }
  if (role) {
    return role;
  }
  // Capabilities, in the order of the Home Assistant integration.
  if (isThermostat(dev)) {
    return 'thermostat';
  }
  if (has(dev, 'setColor') && hasProp(dev, 'color')) {
    return 'color';
  }
  if (has(dev, 'setBrightness') || (has(dev, 'setValue') && has(dev, 'turnOn'))) {
    return 'dimmer';
  }
  if (has(dev, 'turnOn')) {
    return 'switch';
  }
  if (centralScene(dev.properties).length > 0) {
    return 'remote';
  }
  const value = dev.properties.value;
  if (typeof value === 'boolean' || value === 'true' || value === 'false') {
    return 'binary-sensor';
  }
  if (toNumber(value) !== undefined && dev.properties.unit) {
    return 'multilevel';
  }
  return undefined;
}

/** Words of the HC3 / Yubii roles of a lamp: Light, OutdoorLight, GardenLamp, NightLamp, Bracket… */
const LIGHT_ROLE_WORDS = ['light', 'lights', 'lamp', 'lamps', 'lighting', 'bracket', 'chandelier'];
/** SkyLight (a roof window), LightSensor, TrafficLight: not a lamp. */
const NOT_A_LIGHT_ROLE_WORDS = ['sky', 'skylight', 'sensor', 'traffic'];

/**
 * A switch that drives a lamp: HC2 isLight, an HC3 / Yubii lamp role (Light,
 * OutdoorLight, GardenLamp, NightLamp, Bracket…), the "lights" category, the
 * `light` interface, or a Dimmer 2.
 */
export const isLight = (dev) =>
  toBool(dev.properties.isLight) === true ||
  dev.properties.deviceRole === 'Light' ||
  (anyWord(roleWordsOf(dev), LIGHT_ROLE_WORDS) &&
    !anyWord(roleWordsOf(dev), NOT_A_LIGHT_ROLE_WORDS)) ||
  categoriesOf(dev).includes('lights') ||
  dev.type === 'com.fibaro.FGD212' ||
  Boolean(dev.interfaces?.includes('light'));

// --- Units ---------------------------------------------------------------------

/** A temperature unit: 'C' or 'F' (the box's when the device says nothing). */
export function temperatureUnit(raw, fallback = 'C') {
  const text = String(raw ?? '')
    .replace('°', '')
    .trim()
    .toUpperCase();
  if (text === 'F') {
    return 'F';
  }
  return text === 'C' ? 'C' : fallback;
}

const TEMPERATURE_UNITS = { C: U.CELSIUS, F: U.FAHRENHEIT };

/** Measurements of a multilevel sensor, by its `unit` property. */
const BY_UNIT = {
  w: { kind: 'power', unit: U.WATT },
  kw: { kind: 'power', unit: U.KILOWATT },
  kwh: { kind: 'energy', unit: U.KILOWATT_HOUR },
  wh: { kind: 'energy', unit: U.WATT_HOUR },
  v: { kind: 'voltage', unit: U.VOLT },
  a: { kind: 'current', unit: U.AMPERE },
  ma: { kind: 'current', unit: U.MILLI_AMPERE },
  lux: { kind: 'illuminance', unit: U.LUX },
  lx: { kind: 'illuminance', unit: U.LUX },
  ppm: { kind: 'co2', unit: U.PPM },
  hpa: { kind: 'pressure', unit: U.HECTO_PASCAL },
  kpa: { kind: 'pressure', unit: U.KILO_PASCAL },
  mbar: { kind: 'pressure', unit: U.MILLIBAR },
  db: { kind: 'noise', unit: U.DECIBEL },
  dba: { kind: 'noise', unit: U.DECIBEL },
};

/** Multilevel sensors without a unit, by their name (English, French, German). */
const BY_NAME = [
  [/humid|feucht/i, { kind: 'humidity' }],
  [/co2/i, { kind: 'co2', unit: U.PPM }],
  [/pressure|pression|druck/i, { kind: 'pressure', unit: U.HECTO_PASCAL }],
  [/noise|bruit|lärm/i, { kind: 'noise', unit: U.DECIBEL }],
];

// --- Readers -------------------------------------------------------------------

const binaryOf = (raw) => {
  const b = toBool(raw);
  return b === undefined ? undefined : b ? 1 : 0;
};

/** A Fibaro level 0–99 -> 0–100 (99 and over is full). */
const levelOf = (raw) => {
  const n = toNumber(raw);
  if (n === undefined) {
    return undefined;
  }
  return n > 98 ? 100 : clamp(Math.round(n), 0, 100);
};

/** A shutter position: under 5 % is closed, over 95 % open (calibration slack, as HA). */
const positionOf = (raw) => {
  const n = levelOf(raw);
  if (n === undefined) {
    return undefined;
  }
  if (n <= 5) {
    return 0;
  }
  return n >= 95 ? 100 : n;
};

/** A Gladys 0–100 level -> the Fibaro 0–99 one. */
const toLevel = (value) => clamp(Math.round(Number(value) || 0), 0, 99);

/**
 * A command value, checked strictly: a finite number (or numeric text) within
 * [min, max]. null, '', true or NaN are refused, never taken for 0.
 */
export function strictNumber(value, min, max, name = 'The device') {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name}: invalid value ${JSON.stringify(value)} (expected ${min} to ${max})`);
  }
  return n;
}

const decimalOf = (raw) => toNumber(raw);

const THERMOSTAT_MODES = {
  off: THERMOSTAT_MODE.OFF,
  heat: THERMOSTAT_MODE.HEATING,
  cool: THERMOSTAT_MODE.COOLING,
  auto: THERMOSTAT_MODE.AUTO,
};

const OPERATING_STATES = {
  idle: THERMOSTAT_OPERATING_STATE.IDLE,
  heating: THERMOSTAT_OPERATING_STATE.HEATING,
  cooling: THERMOSTAT_OPERATING_STATE.COOLING,
  0: THERMOSTAT_OPERATING_STATE.IDLE,
  1: THERMOSTAT_OPERATING_STATE.HEATING,
  2: THERMOSTAT_OPERATING_STATE.COOLING,
};

// --- The device ----------------------------------------------------------------

const call = (name, ...args) => ({ name, args });
/**
 * A protective action (stop, close, lock, position 0 of a shutter or a gate):
 * never held behind another command of the device, and it cancels an opening
 * or an unlocking still waiting for its turn.
 */
const protect = (c) => ({ ...c, protective: true });

class DeviceMapper {
  constructor(dev, { unit = 'C' } = {}, existing = new Set()) {
    this.dev = dev;
    /** the feature keys of the device already created in Gladys (kept on republish) */
    this.existing = existing;
    this.p = dev.properties;
    this.boxUnit = unit;
    this.features = [];
    this.readers = [];
    this.writers = {};
    this.throttled = [];
    this.optimistic = [];
    this.buttons = { keys: new Map(), any: undefined };
  }

  /**
   * One feature.
   * @param {string} key part of the external id: never change it
   * @param {string} name
   * @param {object} spec category, type, min, max, unit, keepHistory
   * @param {{ props?: string[], read?: Function, write?: Function, throttle?: boolean }} io
   */
  add(key, name, spec, { props = [], read, write, throttle = false } = {}) {
    if (this.features.some((f) => f.key === key)) {
      return;
    }
    const feature = {
      key,
      name,
      category: spec.category,
      type: spec.type,
      min: spec.min ?? 0,
      max: spec.max ?? 1,
      read_only: !write,
      has_feedback: Boolean(write && read),
      keep_history: spec.keepHistory ?? true,
    };
    if (spec.unit) {
      feature.unit = spec.unit;
    }
    this.features.push(feature);
    if (read) {
      this.readers.push({ key, props, read });
    } else if (write) {
      this.optimistic.push(key);
    }
    if (write) {
      this.writers[key] = write;
    }
    if (throttle) {
      this.throttled.push(key);
    }
  }

  onOff(category, type) {
    const dev = this.dev;
    this.add(
      'binary',
      'On/off',
      { category, type },
      {
        props: ['value'],
        read: (p) => binaryOf(p.value),
        write: (value) => {
          const on = Number(value) !== 0;
          if (has(dev, on ? 'turnOn' : 'turnOff')) {
            return [call(on ? 'turnOn' : 'turnOff')];
          }
          return [call('setValue', on ? 99 : 0)];
        },
      },
    );
  }

  level(category, type) {
    this.add(
      category === C.LIGHT ? 'brightness' : 'dimmer',
      category === C.LIGHT ? 'Brightness' : 'Level',
      { category, type, min: 0, max: 100 },
      {
        props: ['value'],
        read: (p) => levelOf(p.value),
        write: has(this.dev, 'setValue')
          ? (value) => [call('setValue', toLevel(value))]
          : undefined,
      },
    );
  }

  switchLike(role) {
    const light = role === 'color' || isLight(this.dev);
    const category = light ? C.LIGHT : C.SWITCH;
    this.onOff(category, light ? T.LIGHT.BINARY : T.SWITCH.BINARY);
    if (role === 'dimmer' || role === 'color') {
      this.level(category, light ? T.LIGHT.BRIGHTNESS : T.SWITCH.DIMMER);
    }
    if (role === 'color' && has(this.dev, 'setColor')) {
      this.add(
        'color',
        'Color',
        { category: C.LIGHT, type: T.LIGHT.COLOR, min: 0, max: 0xffffff },
        {
          props: ['color', 'lastColorSet'],
          read: (p) => {
            // Off, a controller reports 0,0,0,0: its last color then.
            const rgbOf = (raw) => {
              const c = parseColor(raw);
              return c && (c[0] || c[1] || c[2]) ? c : undefined;
            };
            const c = rgbOf(p.color) ?? rgbOf(p.lastColorSet);
            return c ? rgbToInt(c) : undefined;
          },
          // Strings, as the Home Assistant integration sends them; white off.
          write: (value) => [call('setColor', ...[...intToRgb(value), 0].map(String))],
        },
      );
    }
  }

  /**
   * A shutter: its position (0–100 %, when it reports a numeric one) and open
   * / close / stop, always in the `shutter` category. The values sent are
   * checked strictly before anything leaves: null, '' or a number out of range
   * are refused, never read as 0 (which would close the shutter). Close, stop
   * and position 0 are protective: never held behind another command.
   */
  cover() {
    const dev = this.dev;
    const canSet = has(dev, 'setValue');
    // No position for a one-way motor (no value) nor a relay (a boolean contact).
    const raw = this.p.value;
    const boolish = typeof raw === 'boolean' || raw === 'true' || raw === 'false';
    if (hasProp(dev, 'value') && !boolish && (canSet || toNumber(raw) !== undefined)) {
      this.add(
        'position',
        'Position',
        { category: C.SHUTTER, type: T.SHUTTER.POSITION, min: 0, max: 100, unit: U.PERCENT },
        {
          props: ['value'],
          read: (p) => positionOf(p.value),
          write: canSet
            ? (value) => {
                const level = toLevel(strictNumber(value, 0, 100, dev.name));
                return [level === 0 ? protect(call('setValue', 0)) : call('setValue', level)];
              }
            : undefined,
        },
      );
    }
    const canMove = (has(dev, 'open') && has(dev, 'close')) || canSet;
    if (canMove) {
      this.add(
        'state',
        'Open/close',
        { category: C.SHUTTER, type: T.SHUTTER.STATE, min: -1, max: 1, keepHistory: false },
        {
          write: (value) => {
            const wanted = strictNumber(value, -1, 1, dev.name);
            if (wanted === COVER_STATE.OPEN) {
              return [has(dev, 'open') ? call('open') : call('setValue', 99)];
            }
            if (wanted === COVER_STATE.CLOSE) {
              return [protect(has(dev, 'close') ? call('close') : call('setValue', 0))];
            }
            if (wanted === COVER_STATE.STOP && has(dev, 'stop')) {
              return [protect(call('stop'))];
            }
            throw new Error(`${dev.name} cannot do ${value}`);
          },
        },
      );
    }
  }

  /**
   * A lock: locking is always allowed (protective); unlocking only with
   * allow_unlock, on the state read again from the box just before (refused
   * when it is unknown or the lock is dead, nothing sent when it is already
   * unlocked).
   */
  lock() {
    const dev = this.dev;
    this.add(
      'lock',
      'Lock',
      { category: C.LOCK, type: T.LOCK.BINARY },
      {
        props: ['value', 'secured'],
        read: (p) => lockStateOf(p),
        write:
          has(dev, 'secure') && has(dev, 'unsecure')
            ? (value) => {
                const wanted = strictNumber(value, 0, 1, dev.name);
                if (wanted === 1) {
                  return [protect(call('secure'))];
                }
                if (wanted !== 0) {
                  throw new Error(`${dev.name}: invalid value ${value} (expected 0 or 1)`);
                }
                return [
                  {
                    ...call('unsecure'),
                    guard: GUARDS.UNLOCK,
                    decide: (p) => {
                      deadCheck(dev.name, p);
                      const state = lockStateOf(p);
                      if (state === undefined) {
                        throw new Error(
                          `${dev.name}: lock state unknown, unlocking refused (command not sent)`,
                        );
                      }
                      return state === 0 ? 'skip' : 'send';
                    },
                  },
                ];
              }
            : undefined,
      },
    );
  }

  /** A push button feature running `action` (a press is the value 1). */
  pushButton(key, label, action) {
    const name = this.dev.name;
    this.add(
      key,
      label,
      { category: C.BUTTON, type: T.BUTTON.PUSH, min: 0, max: 1, keepHistory: false },
      {
        write: (value) => {
          if (strictNumber(value, 0, 1, name) !== 1) {
            throw new Error(`${name}: invalid value ${value} (a push is 1)`);
          }
          return [action];
        },
      },
    );
  }

  /**
   * A gate, a garage door or a motorized door: its state (read-only) and Open
   * / Close / Stop push buttons. Close and Stop always work (protective); Open
   * needs allow_gates and is decided on the state read again from the box
   * just before (refused when unknown or dead, nothing sent when clearly
   * open). A gate driven by a plain relay (turnOn only): the relay contact
   * (read-only) and an Open button pulsing turnOn, behind allow_gates, decided
   * on nothing but the device being alive (a relay value is not the position
   * of the gate); a one-way motor reporting neither value nor state likewise.
   * No switch, dimmer or shutter feature of a gate is ever kept from an older
   * version: those created features are left without a writer.
   */
  gate() {
    const dev = this.dev;
    const name = dev.name;
    if (isRelay(dev)) {
      if (hasProp(dev, 'value')) {
        this.add(
          'relay',
          'Relay contact',
          { category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: 0, max: 1 },
          { props: ['value'], read: (p) => binaryOf(p.value) },
        );
      }
      this.pushButton('open', 'Open', {
        ...call('turnOn'),
        guard: GUARDS.GATES,
        decide: (p) => {
          deadCheck(name, p);
          return 'send';
        },
      });
      // A relay created as a switch before it was a gate (by its name since
      // 0.1.3): its old On/off is not offered, but until "Update" it still
      // turns the relay off (protective); turning on is refused.
      if (this.existing.has('binary')) {
        this.writers.binary = (value) => {
          if (strictNumber(value, 0, 1, name) === 0 && has(dev, 'turnOff')) {
            return [protect(call('turnOff'))];
          }
          throw new Error(
            `${name} became a gate in 0.1.3: this old On/off feature can only turn it off ` +
              `(asked ${JSON.stringify(value)}, command not sent). Open Discovery, press ` +
              '"Update", then use the Open button.',
          );
        };
      }
      return;
    }
    // A one-way motor: no setValue (it can have no position) and no `value` /
    // `state` key at all (absent, not null), in the inventory and in the
    // device read again. Like a relay, its position cannot be known: opening
    // is decided on the box saying it is alive (dead: false, read) only.
    const keyless = (p) =>
      Boolean(p) &&
      typeof p === 'object' &&
      !Object.hasOwn(p, 'value') &&
      !Object.hasOwn(p, 'state');
    const noFeedback = !has(dev, 'setValue') && keyless(this.p);
    const decideOpening = (p) => {
      deadCheck(name, p);
      if (noFeedback && keyless(p)) {
        if (toBool(p.dead) !== false) {
          throw new Error(`${name}: not known to be alive, opening refused (command not sent)`);
        }
        return 'send';
      }
      const state = gateStateOf(p);
      if (state === undefined) {
        throw new Error(`${name}: state unknown, opening refused (command not sent)`);
      }
      return state === 'open' ? 'skip' : 'send';
    };
    const openGuard = { guard: GUARDS.GATES, decide: decideOpening };
    const openCall = has(dev, 'open')
      ? { ...call('open'), ...openGuard }
      : has(dev, 'setValue')
        ? { ...call('setValue', 99), ...openGuard }
        : undefined;
    const closeCall = has(dev, 'close')
      ? protect(call('close'))
      : has(dev, 'setValue')
        ? protect(call('setValue', 0))
        : undefined;
    const stopCall = has(dev, 'stop') ? protect(call('stop')) : undefined;

    if (hasProp(dev, 'state') || hasProp(dev, 'value')) {
      this.add(
        'gate',
        'Gate',
        { category: C.OPENING_SENSOR, type: T.SENSOR.BINARY, min: 0, max: 1 },
        {
          props: ['state', 'value'],
          read: (p) => {
            const state = gateStateOf(p);
            if (state === undefined) {
              return undefined;
            }
            return state === 'closed' ? OPENING_SENSOR_STATE.CLOSE : OPENING_SENSOR_STATE.OPEN;
          },
        },
      );
    }
    for (const [key, label, action] of [
      ['open', 'Open', openCall],
      ['close', 'Close', closeCall],
      ['stop', 'Stop', stopCall],
    ]) {
      if (action) {
        this.pushButton(key, label, action);
      }
    }
    // No shutter feature on a gate, ever, not even the `state` / `position` of
    // a gate created as a shutter by 0.1.1 or 0.1.2 (issue #4): they are not
    // offered any more, and "Update" in Discovery removes them. Until then
    // they keep a writer that only closes or stops (protective, never
    // blocked); anything that would open is refused, nothing sent.
    const legacyRefusal = (value) =>
      new Error(
        `${name} became a gate in 0.1.3: this old shutter feature can only close or stop ` +
          `(asked ${JSON.stringify(value)}, command not sent). Open Discovery, press "Update", ` +
          'then use the Open button.',
      );
    if (this.existing.has('state')) {
      this.writers.state = (value) => {
        const wanted = strictNumber(value, -1, 1, name);
        if (wanted === COVER_STATE.CLOSE && closeCall) {
          return [closeCall];
        }
        if (wanted === COVER_STATE.STOP && stopCall) {
          return [stopCall];
        }
        throw legacyRefusal(value);
      };
    }
    if (this.existing.has('position')) {
      this.writers.position = (value) => {
        if (strictNumber(value, 0, 100, name) === 0 && closeCall) {
          return [closeCall];
        }
        throw legacyRefusal(value);
      };
    }
  }

  /**
   * A water or gas valve: its state (read-only) and Open / Close push buttons,
   * both behind allow_valves (opening floods, closing cuts the water), decided
   * on the state read again from the box just before (refused when unknown or
   * dead, nothing sent when already in the state asked). A relay valve: on is
   * open. A valve created as a switch by 0.1.1 keeps its on/off feature, with
   * the same rule (refused while the option is off).
   */
  valve() {
    const dev = this.dev;
    const name = dev.name;
    const stateOf = (p) => {
      const state = gateStateOf(p);
      return state === 'open' ? 1 : state === 'closed' ? 0 : undefined;
    };
    const guarded = (action, wanted) => ({
      ...action,
      guard: GUARDS.VALVES,
      decide: (p) => {
        deadCheck(name, p);
        const state = stateOf(p);
        if (state === undefined) {
          throw new Error(`${name}: valve state unknown, command refused (not sent)`);
        }
        return state === wanted ? 'skip' : 'send';
      },
    });
    const openAction = has(dev, 'open')
      ? call('open')
      : has(dev, 'turnOn')
        ? call('turnOn')
        : undefined;
    const closeAction = has(dev, 'close')
      ? call('close')
      : has(dev, 'turnOff')
        ? call('turnOff')
        : undefined;
    if (hasProp(dev, 'value') || hasProp(dev, 'state')) {
      this.add(
        'valve',
        'Valve (1 open)',
        { category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: 0, max: 1 },
        { props: ['state', 'value'], read: stateOf },
      );
    }
    if (openAction) {
      this.pushButton('open', 'Open', guarded(openAction, 1));
    }
    if (closeAction) {
      this.pushButton('close', 'Close', guarded(closeAction, 0));
    }
    // Legacy: a valve created as a switch by 0.1.1 keeps its on/off feature,
    // read-only (its history stays; no "everything off" can close the valve):
    // only the Open and Close buttons drive it.
    if (this.existing.has('binary')) {
      this.add(
        'binary',
        'On/off',
        { category: C.SWITCH, type: T.SWITCH.BINARY },
        { props: ['value'], read: (p) => binaryOf(p.value) },
      );
    }
  }
  setpoint(key, name, { props, actions, minProp, maxProp }) {
    const dev = this.dev;
    const present = props.filter((prop) => hasProp(dev, prop));
    if (present.length === 0) {
      return;
    }
    const unit = temperatureUnit(this.p.unit, this.boxUnit);
    const [low, high] = unit === 'F' ? [40, 95] : [5, 35];
    const action = actions.find((a) => has(dev, a));
    this.add(
      key,
      name,
      {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        min: toNumber(this.p[minProp]) ?? low,
        max: toNumber(this.p[maxProp]) ?? high,
        unit: TEMPERATURE_UNITS[unit],
      },
      {
        props: present,
        read: (p) => {
          for (const prop of present) {
            const n = toNumber(p[prop]);
            if (n !== undefined) {
              return n;
            }
          }
          return undefined;
        },
        write: action ? (value) => [call(action, Number(value))] : undefined,
      },
    );
  }

  /** A mode list: HC3 names (thermostatMode) or HC2 Z-Wave codes (mode, operatingMode). */
  mode() {
    const dev = this.dev;
    const spec = { category: C.THERMOSTAT, type: T.THERMOSTAT.MODE, min: 0, max: 3 };
    if (hasProp(dev, 'thermostatMode')) {
      const listed = toList(this.p.supportedThermostatModes).map(String);
      const names = listed.length > 0 ? listed : ['Off', 'Heat', 'Cool', 'Auto'];
      const writable = names.filter((n) => THERMOSTAT_MODES[n.toLowerCase()] !== undefined);
      this.add('mode', 'Mode', spec, {
        props: ['thermostatMode'],
        read: (p) => THERMOSTAT_MODES[String(p.thermostatMode ?? '').toLowerCase()],
        write:
          has(dev, 'setThermostatMode') && writable.length > 0
            ? (value) => {
                const name = writable.find(
                  (n) => THERMOSTAT_MODES[n.toLowerCase()] === Number(value),
                );
                if (!name) {
                  throw new Error(`${dev.name} has no mode ${value}`);
                }
                return [call('setThermostatMode', name)];
              }
            : undefined,
      });
      return;
    }
    // HC2: Z-Wave codes, 0 off, 1 heat, 2 cool, 3 auto (the Gladys values).
    for (const [prop, listProp, action] of [
      ['mode', 'supportedModes', 'setMode'],
      ['operatingMode', 'supportedOperatingModes', 'setOperatingMode'],
    ]) {
      if (!hasProp(dev, prop) || !has(dev, action)) {
        continue;
      }
      const listed = toList(this.p[listProp])
        .map(toNumber)
        .filter((n) => n !== undefined);
      const codes = listed.length > 0 ? listed.filter((n) => n >= 0 && n <= 3) : [0, 1, 2, 3];
      this.add('mode', 'Mode', spec, {
        props: [prop],
        read: (p) => {
          const n = toNumber(p[prop]);
          return n !== undefined && n >= 0 && n <= 3 ? n : undefined;
        },
        write: (value) => {
          if (!codes.includes(Number(value))) {
            throw new Error(`${dev.name} has no mode ${value}`);
          }
          return [call(action, Number(value))];
        },
      });
      return;
    }
  }

  thermostat() {
    this.setpoint('setpoint', 'Setpoint', {
      props: ['heatingThermostatSetpointFuture', 'heatingThermostatSetpoint', 'targetLevel'],
      actions: ['setHeatingThermostatSetpoint', 'setTargetLevel'],
      minProp: 'heatingThermostatSetpointCapabilitiesMin',
      maxProp: 'heatingThermostatSetpointCapabilitiesMax',
    });
    this.setpoint('cooling-setpoint', 'Cooling setpoint', {
      props: ['coolingThermostatSetpointFuture', 'coolingThermostatSetpoint'],
      actions: ['setCoolingThermostatSetpoint'],
      minProp: 'coolingThermostatSetpointCapabilitiesMin',
      maxProp: 'coolingThermostatSetpointCapabilitiesMax',
    });
    this.mode();
    if (hasProp(this.dev, 'thermostatOperatingState')) {
      this.add(
        'operating-state',
        'Heating state',
        { category: C.THERMOSTAT, type: T.THERMOSTAT.OPERATING_STATE, min: 0, max: 2 },
        {
          props: ['thermostatOperatingState'],
          read: (p) => OPERATING_STATES[String(p.thermostatOperatingState ?? '').toLowerCase()],
        },
      );
    }
  }

  binarySensor(key, name, category, convert = (b) => b, type = T.SENSOR.BINARY) {
    this.add(
      key,
      name,
      { category, type, min: 0, max: 1 },
      {
        props: ['value'],
        read: (p) => {
          // An accelerometer reports { x, y, z } on some boxes: not a state.
          if (p.value !== null && typeof p.value === 'object') {
            return undefined;
          }
          const b = binaryOf(p.value);
          return b === undefined ? undefined : convert(b);
        },
      },
    );
  }

  measurement(key, name, spec, prop = 'value') {
    this.add(
      key,
      name,
      { ...spec, type: spec.type ?? T.SENSOR.DECIMAL },
      { props: [prop], read: (p) => decimalOf(p[prop]), throttle: true },
    );
  }

  temperature() {
    const unit = temperatureUnit(this.p.unit, this.boxUnit);
    this.measurement('temperature', 'Temperature', {
      category: C.TEMPERATURE_SENSOR,
      min: unit === 'F' ? -150 : -100,
      max: unit === 'F' ? 300 : 150,
      unit: TEMPERATURE_UNITS[unit],
    });
  }

  /** A measurement whose kind comes from its unit (multilevel sensors, meters). */
  byKind(kind, unit, { key = kind, prop = 'value', switchLike = false } = {}) {
    switch (kind) {
      case 'temperature':
        return this.temperature();
      case 'humidity':
        return this.measurement('humidity', 'Humidity', {
          category: C.HUMIDITY_SENSOR,
          min: 0,
          max: 100,
          unit: U.PERCENT,
        });
      case 'illuminance':
        return this.measurement('illuminance', 'Illuminance', {
          category: C.LIGHT_SENSOR,
          min: 0,
          max: unit === U.PERCENT ? 100 : 200_000,
          unit: unit ?? U.LUX,
        });
      case 'co2':
        return this.measurement('co2', 'CO2', {
          category: C.CO2_SENSOR,
          min: 0,
          max: 100_000,
          unit,
        });
      case 'pressure':
        return this.measurement('pressure', 'Pressure', {
          category: C.PRESSURE_SENSOR,
          min: 0,
          max: 10_000,
          unit,
        });
      case 'noise':
        return this.measurement('noise', 'Noise', {
          category: C.NOISE_SENSOR,
          min: 0,
          max: 200,
          unit,
        });
      case 'power':
        return this.measurement(
          key,
          'Power',
          switchLike
            ? { category: C.SWITCH, type: T.SWITCH.POWER, min: 0, max: 1e9, unit }
            : { category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.POWER, min: -1e9, max: 1e9, unit },
          prop,
        );
      case 'energy':
        return this.measurement(
          key,
          'Energy',
          switchLike
            ? { category: C.SWITCH, type: T.SWITCH.ENERGY, min: 0, max: 1e12, unit }
            : { category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.INDEX, min: 0, max: 1e12, unit },
          prop,
        );
      case 'voltage':
        return this.measurement(
          'voltage',
          'Voltage',
          { category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.VOLTAGE, min: 0, max: 100_000, unit },
          prop,
        );
      case 'current':
        return this.measurement(
          'current',
          'Current',
          { category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.CURRENT, min: 0, max: 100_000, unit },
          prop,
        );
      default:
        return undefined;
    }
  }

  multilevel() {
    const unitText = String(this.p.unit ?? '')
      .replace('°', '')
      .trim()
      .toLowerCase();
    if (unitText === 'c' || unitText === 'f') {
      return this.temperature();
    }
    const known = BY_UNIT[unitText];
    if (known) {
      return this.byKind(known.kind, known.unit);
    }
    // No unit (plugins such as the HC2 Netatmo one): the name says what it is.
    if (unitText === '' || unitText === '%') {
      const kind = BY_NAME.find(([pattern]) => pattern.test(this.dev.name));
      if (kind && (unitText === '' || kind[1].kind === 'humidity')) {
        return this.byKind(kind[1].kind, kind[1].unit);
      }
    }
    return undefined;
  }

  /** The power, energy and battery a device reports beside its main role. */
  extras(role) {
    const dev = this.dev;
    const switchLike = ['switch', 'dimmer', 'color'].includes(role);
    if (role !== 'power-meter' && hasInterface(dev, 'power', 'power')) {
      this.byKind('power', U.WATT, { key: 'power', prop: 'power', switchLike });
    }
    if (role !== 'energy-meter' && hasInterface(dev, 'energy', 'energy')) {
      this.byKind('energy', U.KILOWATT_HOUR, { key: 'energy', prop: 'energy', switchLike });
    }
    if (hasInterface(dev, 'battery', 'batteryLevel')) {
      this.add(
        'battery',
        'Battery',
        { category: C.BATTERY, type: T.BATTERY.INTEGER, min: 0, max: 100, unit: U.PERCENT },
        {
          props: ['batteryLevel'],
          read: (p) => {
            const n = toNumber(p.batteryLevel);
            // 255: the box has no reading (pyfibaro).
            return n === undefined || n === 255 ? undefined : clamp(Math.round(n), 0, 100);
          },
          throttle: true,
        },
      );
    }
    const keys = centralScene(this.p);
    const spec = {
      category: C.BUTTON,
      type: T.BUTTON.CLICK,
      min: Math.min(...BUTTON_VALUES),
      max: Math.max(...BUTTON_VALUES),
      keepHistory: false,
    };
    for (const { keyId } of keys) {
      const key = `button-${keyId}`;
      this.add(key, `Button ${keyId}`, spec);
      this.buttons.keys.set(keyId, key);
    }
    if (keys.length === 0 && role === 'remote') {
      this.add('button', 'Button', spec);
      this.buttons.any = 'button';
    }
  }

  map() {
    const role = roleOf(this.dev);
    switch (role) {
      case 'switch':
      case 'dimmer':
      case 'color':
        this.switchLike(role);
        break;
      case 'cover':
        this.cover();
        break;
      case 'lock':
        this.lock();
        break;
      case 'gate':
        this.gate();
        break;
      case 'valve':
        this.valve();
        break;
      case 'thermostat':
        this.thermostat();
        break;
      case 'opening':
        // Fibaro: true = breached (open). Gladys: OPEN 0, CLOSE 1.
        this.binarySensor('opening', 'Opening', C.OPENING_SENSOR, (b) =>
          b ? OPENING_SENSOR_STATE.OPEN : OPENING_SENSOR_STATE.CLOSE,
        );
        break;
      case 'motion':
        this.binarySensor('motion', 'Motion', C.MOTION_SENSOR);
        break;
      case 'flood':
        this.binarySensor('leak', 'Water leak', C.LEAK_SENSOR);
        break;
      case 'smoke':
        this.binarySensor('smoke', 'Smoke', C.SMOKE_SENSOR);
        break;
      case 'co':
        this.binarySensor('co', 'Carbon monoxide', C.CO_SENSOR);
        break;
      case 'vibration':
        this.binarySensor(
          'vibration',
          'Vibration',
          C.VIBRATION_SENSOR,
          undefined,
          T.VIBRATION_SENSOR.BINARY,
        );
        break;
      case 'binary-sensor':
        this.add(
          'value',
          'State',
          { category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: 0, max: 1 },
          { props: ['value'], read: (p) => binaryOf(p.value) },
        );
        break;
      case 'temperature':
        this.temperature();
        break;
      case 'humidity':
        this.byKind('humidity');
        break;
      case 'illuminance':
        this.byKind('illuminance', String(this.p.unit ?? '').trim() === '%' ? U.PERCENT : U.LUX);
        break;
      case 'multilevel':
        this.multilevel();
        break;
      case 'energy-meter':
        this.byKind('energy', U.KILOWATT_HOUR);
        break;
      case 'power-meter':
        this.byKind('power', U.WATT);
        break;
      default:
        break;
    }
    this.extras(role);
    return {
      role,
      features: this.features,
      readers: this.readers,
      writers: this.writers,
      throttled: this.throttled,
      optimistic: this.optimistic,
      buttons: this.buttons,
    };
  }
}

/**
 * @param {object} dev a device of src/inventory.js
 * @param {{ unit?: 'C' | 'F' }} [box] the temperature unit of the box
 * @param {Set<string>} [existing] the feature keys of the device already created in Gladys
 */
export function mapDevice(dev, box, existing) {
  return new DeviceMapper(dev, box, existing).map();
}
