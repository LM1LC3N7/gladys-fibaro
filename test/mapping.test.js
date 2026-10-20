import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { buildInventory } from '../src/inventory.js';
import {
  BUTTON_STATUS,
  COVER_STATE,
  GUARDS,
  OPENING_SENSOR_STATE,
  THERMOSTAT_MODE,
  decodeKeyAttribute,
  mapDevice,
  roleOf,
} from '../src/mapping.js';
import { ROOMS, hc2Devices, hc3Devices, pyfibaro } from './fixtures/fibaro.js';

const inventoryOf = (devices, includePlugins = false) =>
  new Map(buildInventory({ devices, rooms: ROOMS, includePlugins }).devices.map((d) => [d.id, d]));
const HC3 = inventoryOf(hc3Devices());
const HC2 = inventoryOf(hc2Devices());

/** The features of a device, and its readers / writers by key. */
function mapped(dev, box) {
  const m = mapDevice(dev, box);
  const readers = new Map(m.readers.map((r) => [r.key, r]));
  return {
    ...m,
    specs: m.features.map((f) => `${f.key} ${f.category}/${f.type}${f.unit ? ` ${f.unit}` : ''}`),
    feature: (key) => m.features.find((f) => f.key === key),
    read: (key, props = dev.properties) => readers.get(key).read(props),
    write: (key, value, props = dev.properties) => m.writers[key](value, props),
  };
}

test('a wall plug: on/off with its power and energy', () => {
  const plug = mapped(HC3.get('31'));
  assert.equal(plug.role, 'switch');
  assert.deepEqual(plug.specs, [
    'binary switch/binary',
    'power switch/power watt',
    'energy switch/energy kilowatt-hour',
  ]);
  assert.equal(plug.read('binary'), 1);
  assert.equal(plug.read('power'), 85.3);
  assert.deepEqual(plug.write('binary', 0), [{ name: 'turnOff', args: [] }]);
  assert.deepEqual(plug.throttled, ['power', 'energy']);
  assert.equal(plug.feature('binary').has_feedback, true);
  assert.equal(plug.feature('power').read_only, true);

  // The HC2 of pyfibaro: the same plug, every value a string.
  const hifi = mapped(HC2.get('13'));
  assert.deepEqual(hifi.specs, plug.specs);
  assert.equal(hifi.read('binary'), 1);
  assert.equal(hifi.read('energy'), 1716.64);
});

test('a dimmer driving a lamp: a light with its brightness, 99 is full', () => {
  const lamp = mapped(HC3.get('41'));
  assert.deepEqual(lamp.specs.slice(0, 2), ['binary light/binary', 'brightness light/brightness']);
  assert.equal(lamp.read('brightness'), 55);
  assert.equal(lamp.read('brightness', { value: 99 }), 100);
  assert.equal(lamp.read('binary', { value: 0 }), 0);
  assert.deepEqual(lamp.write('brightness', 100), [{ name: 'setValue', args: [99] }]);
  assert.deepEqual(lamp.write('brightness', 40), [{ name: 'setValue', args: [40] }]);
  assert.deepEqual(lamp.write('binary', 1), [{ name: 'turnOn', args: [] }]);
  assert.equal(lamp.feature('power').category, C.SWITCH);

  const hc2 = mapped(HC2.get('29'));
  assert.deepEqual(hc2.specs, ['binary light/binary', 'brightness light/brightness']);
  assert.equal(hc2.read('brightness'), 100);

  // Without a light role, a multilevel switch is a switch with a dimmer.
  const fan = mapped({ ...HC3.get('41'), properties: { value: 20 }, interfaces: ['zwave'] });
  assert.deepEqual(fan.specs, ['binary switch/binary', 'dimmer switch/dimmer']);
});

test('an RGBW controller: color as an RGB integer, its last color when off', () => {
  const led = mapped(HC3.get('50'));
  assert.equal(led.role, 'color');
  assert.deepEqual(led.specs, [
    'binary light/binary',
    'brightness light/brightness',
    'color light/color',
  ]);
  assert.equal(led.read('color'), 0xff8000);
  assert.deepEqual(led.write('color', 0x00ff7f), [
    { name: 'setColor', args: ['0', '255', '127', '0'] },
  ]);
  const hc2 = mapped(HC2.get('27'));
  assert.equal(hc2.read('color'), 0x0a141e, 'off: lastColorSet');
  assert.equal(hc2.read('color', { color: '0,0,0,0', lastColorSet: '0,0,0,0' }), undefined);
  assert.equal(hc2.read('binary'), 0);
});

test('shutters: position 0–99 with slack at the ends, open / close / stop', () => {
  const shutter = mapped(HC3.get('60'));
  assert.deepEqual(shutter.specs, [
    'position shutter/position percent',
    'state shutter/state',
    'power energy-sensor/power watt',
    'energy energy-sensor/index kilowatt-hour',
  ]);
  assert.equal(shutter.read('position'), 100);
  assert.equal(shutter.read('position', { value: 3 }), 0);
  assert.equal(shutter.read('position', { value: '50' }), 50);
  assert.deepEqual(shutter.write('position', 100), [{ name: 'setValue', args: [99] }]);
  assert.deepEqual(shutter.write('state', COVER_STATE.OPEN), [{ name: 'open', args: [] }]);
  assert.deepEqual(shutter.write('state', COVER_STATE.CLOSE), [
    { name: 'close', args: [], protective: true },
  ]);
  assert.deepEqual(shutter.write('state', COVER_STATE.STOP), [
    { name: 'stop', args: [], protective: true },
  ]);
  assert.deepEqual(shutter.optimistic, ['state']);

  const store = mapped(HC3.get('61'));
  assert.deepEqual(store.specs, ['state shutter/state'], 'no value: no position');

  const hc2 = mapped(HC2.get('25'));
  assert.equal(hc2.role, 'cover');
  assert.equal(hc2.read('position'), 50);
});

test('a thermostatic head: setpoint, mode, heating state, battery', () => {
  const head = mapped(HC3.get('70'));
  assert.deepEqual(head.specs, [
    'setpoint thermostat/target-temperature celsius',
    'mode thermostat/mode',
    'operating-state thermostat/operating-state',
    'battery battery/integer percent',
  ]);
  assert.deepEqual([head.feature('setpoint').min, head.feature('setpoint').max], [5, 28]);
  assert.equal(head.read('setpoint'), 20);
  assert.equal(head.read('setpoint', { heatingThermostatSetpointFuture: 22 }), 22);
  assert.equal(head.read('mode'), THERMOSTAT_MODE.HEATING);
  assert.equal(head.read('mode', { thermostatMode: 'ManufacturerSpecific' }), undefined);
  assert.equal(head.read('operating-state'), 1);
  assert.deepEqual(head.write('setpoint', 21.5), [
    { name: 'setHeatingThermostatSetpoint', args: [21.5] },
  ]);
  assert.deepEqual(head.write('mode', THERMOSTAT_MODE.OFF), [
    { name: 'setThermostatMode', args: ['Off'] },
  ]);
  assert.throws(() => head.write('mode', THERMOSTAT_MODE.COOLING), /no mode 2/);

  // An HC2 Danfoss head: targetLevel and the Z-Wave mode codes.
  const danfoss = mapped(HC2.get('26'));
  assert.deepEqual(danfoss.specs, [
    'setpoint thermostat/target-temperature celsius',
    'mode thermostat/mode',
    'battery battery/integer percent',
  ]);
  assert.equal(danfoss.read('setpoint'), 21);
  assert.deepEqual(danfoss.write('setpoint', 19), [{ name: 'setTargetLevel', args: [19] }]);
  assert.equal(danfoss.read('mode'), THERMOSTAT_MODE.HEATING);
  assert.deepEqual(danfoss.write('mode', 0), [{ name: 'setMode', args: [0] }]);
  assert.throws(() => danfoss.write('mode', 3), /no mode 3/);
  assert.equal(danfoss.read('battery'), undefined, '255: no reading');

  // In Fahrenheit, from the box when the device says nothing.
  const f = mapped(
    { ...HC3.get('70'), properties: { heatingThermostatSetpoint: 68 } },
    { unit: 'F' },
  );
  assert.deepEqual([f.feature('setpoint').unit, f.feature('setpoint').min], [U.FAHRENHEIT, 40]);
});

test('binary sensors: the Gladys conventions', () => {
  const door = mapped(HC3.get('80'));
  assert.deepEqual(door.specs, [
    'opening opening-sensor/binary',
    'battery battery/integer percent',
  ]);
  assert.equal(door.read('opening'), OPENING_SENSOR_STATE.CLOSE);
  assert.equal(door.read('opening', { value: true }), OPENING_SENSOR_STATE.OPEN);
  assert.equal(door.read('battery'), 90);

  const motion = mapped(HC3.get('81'));
  assert.equal(motion.read('motion'), 1);
  assert.equal(motion.read('battery'), undefined, '255: no reading');
  assert.equal(mapped(HC3.get('83')).specs[0], 'leak leak-sensor/binary');
  assert.equal(mapped(HC3.get('84')).specs[0], 'smoke smoke-sensor/binary');

  // pyfibaro: a window sensor of a real HC2, values as strings.
  const [, , window] = pyfibaro('device-armed');
  const fenster = mapped(inventoryOf([window]).get('359'));
  assert.equal(fenster.read('opening'), OPENING_SENSOR_STATE.CLOSE);
  assert.equal(fenster.read('battery'), 100);

  // A generic binary sensor follows the role the user gave it on an HC3.
  const generic = { ...HC3.get('80'), type: 'com.fibaro.binarySensor', baseType: '' };
  assert.equal(roleOf(generic), 'binary-sensor');
  assert.equal(roleOf({ ...generic, properties: { deviceRole: 'FloodSensor' } }), 'flood');
  assert.deepEqual(mapped(generic).specs[0], 'value unknown/unknown');
  // An accelerometer reporting { x, y, z } has no state.
  const acc = mapped({
    ...generic,
    type: 'com.fibaro.accelerometer',
    properties: { value: { x: 1 } },
  });
  assert.equal(acc.read('vibration'), undefined);
});

test('measurements by type, by unit, by name', () => {
  assert.deepEqual(mapped(HC3.get('71')).specs, ['temperature temperature-sensor/decimal celsius']);
  assert.equal(mapped(HC3.get('71')).read('temperature'), 19.5);
  assert.deepEqual(mapped(HC3.get('82')).specs, ['illuminance light-sensor/decimal lux']);
  assert.deepEqual(mapped(HC3.get('85')).specs, ['humidity humidity-sensor/decimal percent']);
  assert.deepEqual(mapped(HC3.get('104')).specs, ['power energy-sensor/power watt']);
  assert.deepEqual(mapped(HC3.get('105')).specs, ['energy energy-sensor/index kilowatt-hour']);
  assert.equal(mapped(HC3.get('105')).read('energy'), 3456.7);
  assert.deepEqual(mapped(HC3.get('106')).features, [], 'a bare Z-Wave node');

  // The HC2 Netatmo plugin: no unit, the name says what it is.
  const netatmo = inventoryOf(pyfibaro('device-netatmo-plugin'), true);
  const specs = (id) => mapped(netatmo.get(id)).specs;
  assert.deepEqual(specs('267'), ['temperature temperature-sensor/decimal celsius']);
  assert.deepEqual(specs('268'), ['co2 co2-sensor/decimal ppm']);
  assert.deepEqual(specs('269'), ['humidity humidity-sensor/decimal percent']);
  assert.deepEqual(specs('270'), ['pressure pressure-sensor/decimal hPa']);
  assert.deepEqual(specs('271'), ['noise noise-sensor/decimal decibel']);
  assert.deepEqual(mapped(netatmo.get('265')).features, [], 'the plugin controller itself');
});

test('a door lock: 1 is locked, secure always, unsecure guarded and decided on a fresh state', () => {
  const lock = mapped(HC3.get('90'));
  assert.deepEqual(lock.specs[0], 'lock lock/binary');
  assert.equal(lock.read('lock'), 1);
  assert.deepEqual(lock.write('lock', 1), [{ name: 'secure', args: [], protective: true }]);
  const [unsecure] = lock.write('lock', 0);
  assert.deepEqual([unsecure.name, unsecure.args, unsecure.guard], ['unsecure', [], GUARDS.UNLOCK]);
  assert.equal(unsecure.decide({ value: true }), 'send');
  assert.equal(unsecure.decide({ value: false }), 'skip', 'already unlocked');
  assert.throws(() => unsecure.decide({}), /state unknown, unlocking refused/);
  assert.throws(() => unsecure.decide({ value: true, dead: true }), /dead/);
  for (const bad of [null, '', 0.5, 2]) {
    assert.throws(() => lock.write('lock', bad), /invalid value/);
  }
});

test('remotes and scene keys: one button feature per key', () => {
  const remote = mapped(HC3.get('95'));
  assert.equal(remote.role, 'remote');
  assert.deepEqual(
    remote.features.map((f) => f.key),
    ['battery', 'button-1', 'button-2', 'button-3', 'button-4', 'button-5', 'button-6'],
  );
  const button = remote.feature('button-1');
  assert.deepEqual(
    [button.category, button.type, button.read_only, button.keep_history],
    [C.BUTTON, T.BUTTON.CLICK, true, false],
  );
  assert.deepEqual(
    [...remote.buttons.keys],
    [1, 2, 3, 4, 5, 6].map((k) => [k, `button-${k}`]),
  );
  assert.equal(
    remote.readers.some((r) => r.key.startsWith('button')),
    false,
    'events, not states',
  );

  // The S1/S2 keys of a dimmer (hidden endpoint) and the HC2 JSON string.
  assert.deepEqual(
    mapped(HC3.get('42')).features.map((f) => f.key),
    ['button-1', 'button-2'],
  );
  assert.deepEqual(
    mapped(HC2.get('387')).features.map((f) => f.key),
    ['button-1', 'button-2', 'button-3', 'button-4'],
  );
  // A remote that does not list its keys: one feature for all.
  const bare = mapped({ ...HC3.get('95'), properties: {}, interfaces: [] });
  assert.deepEqual(
    bare.features.map((f) => f.key),
    ['button'],
  );
  assert.equal(bare.buttons.any, 'button');
});

test('the central-scene attributes, as gestures and Gladys button values', () => {
  assert.deepEqual(decodeKeyAttribute('Pressed'), {
    event: 'pressed',
    status: BUTTON_STATUS.CLICK,
  });
  assert.deepEqual(decodeKeyAttribute('Pressed2'), {
    event: 'double',
    status: BUTTON_STATUS.DOUBLE_CLICK,
  });
  assert.deepEqual(decodeKeyAttribute('Pressed3'), { event: 'triple', status: 18 });
  assert.deepEqual(decodeKeyAttribute('HeldDown'), { event: 'held', status: 48 });
  assert.deepEqual(decodeKeyAttribute('Released'), { event: 'released', status: 50 });
  assert.deepEqual(decodeKeyAttribute('Pressed5'), { event: 'quintuple', status: 21 });
  assert.deepEqual(decodeKeyAttribute('Swiped'), { event: 'swiped' });
});

test('roles guessed from the actions when the type is unknown', () => {
  const base = { type: 'com.acme.thing', baseType: '', interfaces: undefined, properties: {} };
  assert.equal(roleOf({ ...base, actions: ['turnOn', 'turnOff'] }), 'switch');
  assert.equal(roleOf({ ...base, actions: ['turnOn', 'setValue'] }), 'dimmer');
  assert.equal(roleOf({ ...base, actions: ['open', 'close'] }), 'cover');
  assert.equal(roleOf({ ...base, actions: ['secure', 'unsecure'] }), 'lock');
  assert.equal(
    roleOf({ ...base, actions: [], properties: { thermostatMode: 'Heat' } }),
    'thermostat',
  );
  assert.equal(roleOf({ ...base, actions: [], properties: { value: 'false' } }), 'binary-sensor');
  assert.equal(roleOf({ ...base, actions: [], properties: { value: 3, unit: 'W' } }), 'multilevel');
  assert.equal(roleOf({ ...base, actions: [], properties: { value: 3 } }), undefined);
});
