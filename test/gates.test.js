// -----------------------------------------------------------------------------
// Gates, garage doors, doors and locks: opening and unlocking are off by
// default (allow_gates, allow_unlock); closing, stopping and locking always
// work. A guarded command is decided on the state read again from the box,
// its option is checked again right before it is sent, and a gate is never
// offered as a shutter, not even a gate created as one before 0.1.3.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES as C, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FibaroApp } from '../src/app.js';
import { TIMINGS } from '../src/constants.js';
import { buildModel } from '../src/devices.js';
import { FibaroError } from '../src/fibaro.js';
import { registerHandlers } from '../src/handlers.js';
import { buildInventory } from '../src/inventory.js';
import {
  GUARDS,
  OPENING_SENSOR_STATE,
  gateStateOf,
  isGate,
  mapDevice,
  roleOf,
} from '../src/mapping.js';
import { PASSWORD, ROOMS, USER, hc3Devices, shutterDevices } from './fixtures/fibaro.js';
import { fakeFibaro, settle } from './helpers/fakeFibaro.js';

const devicesById = () =>
  new Map(
    buildInventory({ devices: [...shutterDevices(), ...hc3Devices()], rooms: ROOMS }).devices.map(
      (d) => [d.id, d],
    ),
  );
const specsOf = (m) => m.features.map((f) => `${f.key} ${f.category}/${f.type}`);

test('a gate is never a shutter: its state and Open / Close / Stop push buttons', () => {
  const gate = devicesById().get('250');
  assert.equal(roleOf(gate), 'gate');
  const m = mapDevice(gate);
  assert.deepEqual(specsOf(m), [
    'gate opening-sensor/binary',
    'open button/push',
    'close button/push',
    'stop button/push',
  ]);
  assert.ok(m.features.every((f) => f.category !== C.SHUTTER && f.category !== C.SWITCH));
  const read = m.readers.find((r) => r.key === 'gate').read;
  assert.equal(read({ value: 'Closed' }), OPENING_SENSOR_STATE.CLOSE);
  assert.equal(read({ value: 'Opening' }), OPENING_SENSOR_STATE.OPEN);
  assert.equal(read({ state: 'Unknown', value: 0 }), OPENING_SENSOR_STATE.CLOSE);
  assert.equal(read({ value: 'Unknown' }), undefined);

  const [open] = m.writers.open(1);
  assert.deepEqual([open.name, open.guard], ['open', GUARDS.GATES]);
  assert.equal(open.decide({ value: 'Closed' }), 'send');
  assert.equal(open.decide({ value: 'Open' }), 'skip', 'already open: nothing sent');
  assert.throws(() => open.decide({ value: 'Unknown' }), /state unknown, opening refused/);
  assert.throws(() => open.decide({ value: 'Closed', dead: true }), /dead/);
  assert.deepEqual(
    m.writers.close(1),
    [{ name: 'close', args: [], protective: true }],
    'close: never guarded',
  );
  assert.deepEqual(
    m.writers.stop(1),
    [{ name: 'stop', args: [], protective: true }],
    'stop: never guarded',
  );
  assert.throws(() => m.writers.open(0), /a push is 1/);
  assert.throws(() => m.writers.open(null), /invalid value/);
});

test('gate, garage and door types and roles; door sensors and locks are not gates', () => {
  const base = { interfaces: undefined, properties: {}, actions: ['open', 'close'] };
  for (const type of [
    'com.fibaro.barrier',
    'com.acme.gate',
    'com.acme.garageDoor',
    'com.acme.door',
  ]) {
    assert.equal(roleOf({ ...base, type, baseType: '' }), 'gate', type);
  }
  // A shutter module driving a gate (the role picked in the box).
  const fgr = { ...devicesById().get('201') };
  fgr.properties = { ...fgr.properties, deviceRole: 'Gate' };
  assert.equal(roleOf(fgr), 'gate');
  for (const type of [
    'com.fibaro.doorSensor',
    'com.fibaro.doorWindowSensor',
    'com.fibaro.doorLock',
  ]) {
    assert.equal(isGate({ ...base, type, baseType: '' }), false, type);
  }
  assert.equal(roleOf(devicesById().get('80')), 'opening', 'the door sensor stays a sensor');
  assert.equal(roleOf(devicesById().get('90')), 'lock');
  assert.equal(gateStateOf({ value: true }), 'open');
  assert.equal(gateStateOf({ value: 'closing' }), 'moving');
});

const ids = (id) => ({ device: `ext:t:fibaro:${id}`, feature: (k) => `ext:t:fibaro:${id}:${k}` });
const keysOf = (model, id) =>
  model.devices
    .find((d) => d.external_id === `ext:t:fibaro:${id}`)
    .features.map((f) => f.external_id.split(':').at(-1));

test('a gate created as a shutter before 0.1.3: never driven as a shutter any more (issue #4)', () => {
  const inventory = buildInventory({ devices: shutterDevices(), rooms: ROOMS });
  const fresh = buildModel(ids, inventory);
  assert.deepEqual(keysOf(fresh, 250), ['gate', 'open', 'close', 'stop'], 'no shutter feature');
  const legacy = buildModel(ids, inventory, undefined, [
    'ext:t:fibaro:250:state',
    'ext:t:fibaro:250:position',
  ]);
  assert.deepEqual(
    keysOf(legacy, 250),
    ['gate', 'open', 'close', 'stop'],
    'the old shutter features are not offered: "Update" in Discovery removes them',
  );
  assert.equal(legacy.writers.get('ext:t:fibaro:250:state'), undefined, 'refused, nothing sent');
  assert.equal(legacy.writers.get('ext:t:fibaro:250:position'), undefined);
  // The external ids of the device and of its gate features do not change.
  assert.ok(legacy.writers.get('ext:t:fibaro:250:open'));
});

/**
 * Issue #4 (Yubii Home, 0.1.2): "Portail" offered as "État du volet". A gate
 * motor on a shutter module whose role the box leaves to a blind role, or a
 * radio gate motor without position: written after the HC3 API documentation
 * (types, roles, categories), not dumped from the user's box.
 */
const yubiiGate = (o = {}) => ({
  id: 300,
  name: 'Portail',
  roomID: 223,
  type: 'com.fibaro.remoteBaseShutter',
  baseType: 'com.fibaro.baseShutter',
  enabled: true,
  visible: true,
  isPlugin: false,
  parentId: 0,
  interfaces: [],
  properties: { dead: false, deviceRole: 'BlindsWithoutPositioning', ...o.properties },
  actions: Object.fromEntries((o.actions ?? ['open', 'close', 'stop']).map((a) => [a, 0])),
  ...o.top,
});

test('issue #4: a gate on a shutter module is a gate, by its role, category or name', () => {
  const role = (o) => roleOf(buildInventory({ devices: [yubiiGate(o)] }).devices[0]);
  assert.equal(role(), 'gate', 'named "Portail", blinds role');
  for (const deviceRole of ['gate', 'SlidingGate', 'GarageDoors', 'Barrier', 'VideoGateOpen']) {
    assert.equal(role({ top: { name: 'Moteur' }, properties: { deviceRole } }), 'gate', deviceRole);
  }
  assert.equal(
    role({ top: { name: 'Moteur' }, properties: { categories: ['gates'] } }),
    'gate',
    'HC3 category',
  );
  assert.equal(
    role({ top: { name: 'Moteur' }, properties: { categories: '["gates"]' } }),
    'gate',
    'HC2 serialized list',
  );
  for (const name of ['Portail', 'Portail coulissant', 'Portillon', 'Porte de garage', 'Garage']) {
    assert.equal(role({ top: { name } }), 'gate', name);
  }
  for (const name of ['Volet garage', 'Volet salon', 'Store portique']) {
    assert.equal(role({ top: { name } }), 'cover', `${name} stays a shutter`);
  }
  // By name only for a shutter-like device: a plug or a light is never a gate.
  const plug = {
    ...yubiiGate({ actions: ['turnOn', 'turnOff'], properties: { value: false } }),
    name: 'Prise portail',
    type: 'com.fibaro.binarySwitch',
    baseType: 'com.fibaro.actor',
  };
  plug.properties.deviceRole = 'Other';
  assert.equal(roleOf(buildInventory({ devices: [plug] }).devices[0]), 'switch');
  // A gate sensor and a door bell are not gates.
  assert.equal(
    role({ top: { name: 'Capteur portail' }, properties: { deviceRole: 'GateSensor' } }),
    'cover',
    'sensor role: not a gate (here only the actions of the fixture make it a shutter)',
  );
  assert.notEqual(
    roleOf({
      ...buildInventory({ devices: [yubiiGate()] }).devices[0],
      name: 'Sonnette',
      properties: { deviceRole: 'VideoGateBell' },
    }),
    'gate',
  );
});

test('issue #4: the gate is never a shutter nor a switch; opening needs allow_gates', () => {
  const [gate] = buildInventory({ devices: [yubiiGate()], rooms: ROOMS }).devices;
  const m = mapDevice(gate);
  assert.deepEqual(specsOf(m), ['open button/push', 'close button/push', 'stop button/push']);
  assert.ok(m.features.every((f) => ![C.SHUTTER, C.SWITCH, C.LIGHT].includes(f.category)));
  assert.equal(m.writers.state, undefined, 'a "close the shutters" never reaches it');
  const [open] = m.writers.open(1);
  assert.deepEqual([open.name, open.guard], ['open', GUARDS.GATES]);
  // A one-way motor: no state at all, opening decided on "alive" only.
  assert.equal(open.decide({ dead: false }), 'send');
  assert.throws(() => open.decide({ dead: true }), /dead/);
  assert.deepEqual(m.writers.close(1), [{ name: 'close', args: [], protective: true }]);
  assert.deepEqual(m.writers.stop(1), [{ name: 'stop', args: [], protective: true }]);

  // With a state: decided on it, unknown refused.
  const [withState] = buildInventory({
    devices: [yubiiGate({ properties: { state: 'Closed' } })],
  }).devices;
  const [open2] = mapDevice(withState).writers.open(1);
  assert.equal(open2.decide({ state: 'Closed' }), 'send');
  assert.equal(open2.decide({ state: 'Open' }), 'skip');
  assert.throws(() => open2.decide({ state: 'Unknown' }), /state unknown, opening refused/);
  assert.deepEqual(specsOf(mapDevice(withState))[0], 'gate opening-sensor/binary');
});

test('issue #4: through the app, the gate offered as a gate keeps its external id', async (t) => {
  const box = fakeFibaro({
    devices: [...hc3Devices(), yubiiGate({ properties: { state: 'Closed' } })],
  });
  const { gladys, press } = await setup(t, { box });
  const device = gladys.fake.discoveredDevices.find((d) => d.name === GATE);
  assert.ok(device.external_id.endsWith('fibaro:300'));
  assert.ok(device.features.every((f) => f.category !== C.SHUTTER));
  assert.equal((await press(GATE, 'close')).success, true);
  assert.match((await press(GATE, 'open')).error, /allow_gates/);
  assert.deepEqual(sent(box), ['300:close']);
});

// --- Through the app -------------------------------------------------------------

const BASE = { host: '192.168.1.50', username: USER, password: PASSWORD };

async function setup(
  t,
  { config = BASE, box = fakeFibaro({ devices: [...shutterDevices(), ...hc3Devices()] }) } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  const gladys = createFakeGladys({ config });
  const app = new FibaroApp({
    gladys,
    connect: box.connect,
    now: () => Date.now(),
    logger: createLogger({ level: 'silent' }),
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  await tick(0);
  const press = async (name, key, value = 1) => {
    const device = gladys.fake.discoveredDevices.find((d) => d.name === name);
    assert.ok(device, name);
    const feature = device.features.find((f) => f.external_id.endsWith(`:${key}`));
    assert.ok(feature, `${name} ${key}`);
    return gladys.fake.setValue(device, feature, value);
  };
  return { gladys, app, box, tick, press };
}

const GATE = 'Portail (Entrée)';
const LOCK = 'Serrure (Entrée)';
const sent = (box) => box.actions.map((a) => `${a.deviceId}:${a.name}`);

test('by default: a gate closes and stops but never opens, a lock locks but never unlocks', async (t) => {
  const { box, press } = await setup(t);
  assert.equal((await press(GATE, 'close')).success, true);
  assert.equal((await press(GATE, 'stop')).success, true);
  const open = await press(GATE, 'open');
  assert.equal(open.success, false);
  assert.match(open.error, /open refused, not sent: turn on the "allow_gates" option/);
  assert.equal((await press(LOCK, 'lock', 1)).success, true);
  const unlock = await press(LOCK, 'lock', 0);
  assert.match(unlock.error, /unsecure refused, not sent: turn on the "allow_unlock" option/);
  assert.deepEqual(sent(box), ['250:close', '250:stop', '90:secure']);
  assert.equal(box.callsOf('device').length, 0, 'nothing read for a refused command');
});

test('allowed: decided on the state read again from the box, never on the memory', async (t) => {
  const config = { ...BASE, allow_gates: true, allow_unlock: true };
  const { app, box, press } = await setup(t, { config });
  assert.equal((await press(GATE, 'open')).success, true);
  assert.deepEqual(sent(box), ['250:open']);
  assert.equal(box.callsOf('device').at(-1).args[1].timeout, TIMINGS.rereadTimeout);
  assert.equal(box.callsOf('callAction').at(-1).args[1].timeout, TIMINGS.sensitiveCommandTimeout);
  assert.ok(
    TIMINGS.commandQueueWait + TIMINGS.rereadTimeout + TIMINGS.sensitiveCommandTimeout <= 4000,
    'within the 5 s Gladys waits',
  );

  // The memory says closed, the box says open: nothing is sent.
  app.props.get('250').value = 'Closed';
  box.devices.find((d) => d.id === 250).properties.value = 'Open';
  assert.equal((await press(GATE, 'open')).success, true);
  assert.deepEqual(sent(box), ['250:open'], 'already open in the box');

  // Unknown state in the box: refused, even if the memory knows it.
  app.props.get('250').value = 'Closed';
  box.devices.find((d) => d.id === 250).properties.value = 'Unknown';
  const unknown = await press(GATE, 'open');
  assert.match(unknown.error, /state unknown, opening refused \(command not sent\)/);

  // The lock: unlocked once, then the box says it is already unlocked.
  assert.equal((await press(LOCK, 'lock', 0)).success, true);
  box.devices.find((d) => d.id === 90).properties.value = false;
  assert.equal((await press(LOCK, 'lock', 0)).success, true);
  assert.deepEqual(sent(box), ['250:open', '90:unsecure']);

  // The device cannot be read again: refused, not sent.
  box.deviceErrors['90'] = new FibaroError('timeout', 'no answer within 1 s');
  box.devices.find((d) => d.id === 90).properties.value = true;
  const unread = await press(LOCK, 'lock', 0);
  assert.match(unread.error, /unsecure not sent: device 90 could not be read again/);
  assert.deepEqual(sent(box), ['250:open', '90:unsecure']);
});

test('the option is checked again right before sending', async (t) => {
  const config = { ...BASE, allow_gates: true };
  const { app, box, press } = await setup(t, { config });
  const client = app.client;
  const read = client.device;
  client.device = async (...args) => {
    const answer = await read(...args);
    app.config = { ...app.config, allowGates: false }; // turned off meanwhile
    return answer;
  };
  const open = await press(GATE, 'open');
  assert.match(open.error, /refused, not sent: turn on the "allow_gates" option/);
  assert.deepEqual(sent(box), []);
});

test('a timeout after sending: "sent, without confirmation", and the device is read again', async (t) => {
  const config = { ...BASE, allow_gates: true };
  const { box, press, tick } = await setup(t, { config });
  box.actionErrors['250:open'] = new FibaroError('timeout', 'no answer within 2 s', { sent: true });
  const open = await press(GATE, 'open');
  assert.match(open.error, /^open sent to device 250, without confirmation from the box/);
  assert.match(open.error, /read again in a few seconds/);
  const reads = box.callsOf('device').length;
  await tick(TIMINGS.confirmReread);
  assert.equal(box.callsOf('device').length, reads + 1, 'the confirmation read');

  // Refused by the box (HTTP error): not run, said as such.
  box.actionErrors['250:close'] = new FibaroError('http', 'HTTP 500', { status: 500 });
  const close = await press(GATE, 'close');
  assert.match(close.error, /HTTP 500/);
  assert.doesNotMatch(close.error, /sent/);
});
