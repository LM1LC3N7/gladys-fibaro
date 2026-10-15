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

const isThermostat = (dev) =>
  hasProp(dev, 'thermostatMode') ||
  hasProp(dev, 'heatingThermostatSetpoint') ||
  (hasProp(dev, 'targetLevel') && has(dev, 'setTargetLevel'));

/** The role of a device, or undefined when nothing fits. */
export function roleOf(dev) {
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
  if (has(dev, 'open') && has(dev, 'close')) {
    return 'cover';
  }
  if (has(dev, 'secure')) {
    return 'lock';
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

/** A switch that drives a lamp (HC2 isLight, HC3 deviceRole "Light"). */
export const isLight = (dev) =>
  toBool(dev.properties.isLight) === true ||
  dev.properties.deviceRole === 'Light' ||
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

class DeviceMapper {
  constructor(dev, { unit = 'C' } = {}) {
    this.dev = dev;
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

  cover() {
    const dev = this.dev;
    if (hasProp(dev, 'value') && has(dev, 'setValue')) {
      this.add(
        'position',
        'Position',
        { category: C.SHUTTER, type: T.SHUTTER.POSITION, min: 0, max: 100, unit: U.PERCENT },
        {
          props: ['value'],
          read: (p) => positionOf(p.value),
          write: (value) => [call('setValue', toLevel(value))],
        },
      );
    }
    const canMove = (has(dev, 'open') && has(dev, 'close')) || has(dev, 'setValue');
    if (canMove) {
      this.add(
        'state',
        'Open/close',
        { category: C.SHUTTER, type: T.SHUTTER.STATE, min: -1, max: 1, keepHistory: false },
        {
          write: (value) => {
            const wanted = Number(value);
            if (wanted === COVER_STATE.OPEN) {
              return [has(dev, 'open') ? call('open') : call('setValue', 99)];
            }
            if (wanted === COVER_STATE.CLOSE) {
              return [has(dev, 'close') ? call('close') : call('setValue', 0)];
            }
            if (wanted === COVER_STATE.STOP && has(dev, 'stop')) {
              return [call('stop')];
            }
            throw new Error(`${dev.name} cannot do ${value}`);
          },
        },
      );
    }
  }

  lock() {
    const dev = this.dev;
    this.add(
      'lock',
      'Lock',
      { category: C.LOCK, type: T.LOCK.BINARY },
      {
        props: ['value', 'secured'],
        read: (p) => binaryOf(p.value ?? p.secured),
        write:
          has(dev, 'secure') && has(dev, 'unsecure')
            ? (value) => [call(Number(value) ? 'secure' : 'unsecure')]
            : undefined,
      },
    );
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
 */
export function mapDevice(dev, box) {
  return new DeviceMapper(dev, box).map();
}
