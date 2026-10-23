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
  COVER_STATE,
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
  // Until "Update": the old features only close or stop, never open (review B2).
  const state = legacy.writers.get('ext:t:fibaro:250:state').write;
  assert.deepEqual(state(COVER_STATE.CLOSE), [{ name: 'close', args: [], protective: true }]);
  assert.deepEqual(state(COVER_STATE.STOP), [{ name: 'stop', args: [], protective: true }]);
  assert.throws(() => state(COVER_STATE.OPEN), /became a gate in 0\.1\.3.*"Update"/);
  assert.throws(() => state(null), /invalid value/);
  // 250 has no setValue: its position closes with `close`.
  const position = legacy.writers.get('ext:t:fibaro:250:position').write;
  assert.deepEqual(position(0), [{ name: 'close', args: [], protective: true }]);
  for (const v of [100, 50, 1]) {
    assert.throws(() => position(v), /became a gate in 0\.1\.3/, String(v));
  }
  assert.throws(() => position(''), /invalid value/);
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
  // Review I1: when in doubt, a gate (opening guarded).
  for (const name of [
    'Portail',
    'Portail coulissant',
    'Portillon',
    'Porte de garage',
    'Garage',
    'Garage 1',
    'Garage gauche',
    'Volet garage',
    'Volet roulant garage',
    'Porte sectionnelle',
    'Porte basculante',
    'Barrière',
    'Einfahrtstor',
    'Hoftor',
    'Rolltor',
    'Schiebetor',
    'Gartentor',
    'Sektionaltor',
    'Tor',
    'Puerta garaje',
    'Garagedeur',
    'Poort',
    'Portão',
    'Front gate',
  ]) {
    assert.equal(role({ top: { name } }), 'gate', name);
  }
  for (const name of [
    'Volet salon',
    'Store portique',
    'Moteur',
    'Tortue',
    'Mentor',
    'Torii',
    'Volet fenêtre garage',
    'Velux garage',
  ]) {
    assert.equal(role({ top: { name } }), 'cover', `${name} stays a shutter`);
  }
  // Review I2: a lock or a valve named after a gate stays a lock or a valve.
  assert.equal(
    role({ top: { name: 'Vanne portail' }, properties: { deviceRole: 'Valve' } }),
    'valve',
  );
  assert.equal(
    role({ top: { name: 'Gâche portail' }, actions: ['open', 'close', 'secure', 'unsecure'] }),
    'lock',
  );
  // By name only for a shutter-like device: a plug or a light is never a gate.
  const plug = {
    ...yubiiGate({ actions: ['turnOn', 'turnOff'], properties: { value: false } }),
    name: 'Prise portail',
    type: 'com.fibaro.binarySwitch',
    baseType: 'com.fibaro.actor',
  };
  plug.properties.deviceRole = 'Other';
  const relayRole = (name, properties = {}) =>
    roleOf(
      buildInventory({
        devices: [{ ...plug, name, properties: { ...plug.properties, ...properties } }],
      }).devices[0],
    );
  assert.equal(relayRole('Prise portail'), 'switch');
  assert.equal(relayRole('Lumière portail'), 'switch');
  assert.equal(relayRole('Éclairage garage'), 'switch');
  assert.equal(relayRole('Portail', { deviceRole: 'GardenLamp' }), 'switch', 'a lamp role');
  assert.equal(relayRole('Portail', { categories: ['lights'] }), 'switch', 'a lamp category');
  // Review I3: a relay named "Portail" is a gate on a relay, opening guarded.
  assert.equal(relayRole('Portail'), 'gate');
  // Review 2, B3: for a relay, the gate must be the main word of the name and
  // no appliance word may be in it; the shutter modules keep the broad rule.
  for (const name of ['Garage', 'Portail entrée', 'Porte de garage', 'Hoftor', 'Gate', 'Tor']) {
    assert.equal(relayRole(name), 'gate', name);
  }
  for (const name of [
    'Chauffage garage',
    'Radiateur garage',
    'Chauffe-eau garage',
    'Ventilation garage',
    'Congélateur garage',
    'Sèche-linge garage',
    'Pompe portail',
    'Interphone portail',
    'Garage chauffage',
    'Garage prise',
    'Motor',
    'Ventilator',
  ]) {
    assert.equal(relayRole(name), 'switch', name);
  }
  assert.equal(
    roleOf(
      buildInventory({ devices: [yubiiGate({ top: { name: 'Chauffage garage' } })] }).devices[0],
    ),
    'gate',
    'a shutter module keeps the broad rule (when in doubt, a gate)',
  );
  const relayGate = mapDevice(
    buildInventory({ devices: [{ ...plug, name: 'Portail' }] }).devices[0],
  );
  assert.deepEqual(specsOf(relayGate), ['relay unknown/unknown', 'open button/push']);
  assert.equal(relayGate.writers.open(1)[0].guard, GUARDS.GATES);
  assert.equal(relayGate.writers.binary, undefined, 'never a switch');
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
  assert.equal(open.decide({ dead: 'false' }), 'send', 'HC2 string');
  assert.throws(() => open.decide({ dead: true }), /dead/);
  // Review B1: "alive" must be read, a missing or unreadable dead is refused.
  assert.throws(() => open.decide({}), /not known to be alive/);
  assert.throws(() => open.decide({ dead: 'unknown' }), /not known to be alive/);
  // A value or state key in the device read again (even null): decided on it.
  assert.throws(() => open.decide({ dead: false, value: null }), /state unknown/);
  assert.throws(() => open.decide({ dead: false, state: 'Unknown' }), /state unknown/);

  // Review B1 / H4: a gate with setValue whose value is null is never
  // "without feedback": refused while the state is unknown.
  const [nullValue] = buildInventory({
    devices: [
      yubiiGate({
        top: { type: 'com.fibaro.FGR223', baseType: 'com.fibaro.rollerShutter' },
        actions: ['open', 'close', 'stop', 'setValue'],
        properties: { value: null, deviceRole: 'Gate' },
      }),
    ],
  }).devices;
  const [open3] = mapDevice(nullValue).writers.open(1);
  for (const fresh of [{ dead: false, value: null }, { dead: false }, {}]) {
    assert.throws(() => open3.decide(fresh), /state unknown|dead/, JSON.stringify(fresh));
  }
  // A null value key in the inventory: not keyless either.
  const [nullKey] = buildInventory({
    devices: [yubiiGate({ properties: { value: null } })],
  }).devices;
  assert.throws(() => mapDevice(nullKey).writers.open(1)[0].decide({ dead: false }), /unknown/);
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

test('review B2: before "Update", the old shutter features of a gate close and stop, never open', async (t) => {
  const config = { ...BASE, allow_gates: true };
  const box = fakeFibaro({
    devices: [...hc3Devices(), yubiiGate({ properties: { state: 'Closed' } })],
  });
  // The device as 0.1.2 created it: a shutter state feature.
  const { gladys } = await setup(t, {
    config,
    box,
    created: (ids) => [
      {
        name: GATE,
        external_id: ids(300).device,
        features: [
          {
            name: 'Etat du volet',
            external_id: ids(300).feature('state'),
            category: C.SHUTTER,
            type: 'state',
            min: -1,
            max: 1,
            read_only: false,
            has_feedback: false,
            keep_history: false,
          },
        ],
      },
    ],
  });
  const created = gladys.devices.find((d) => d.name === GATE);
  const [state] = created.features;
  assert.equal((await gladys.fake.setValue(created, state, COVER_STATE.CLOSE)).success, true);
  assert.equal((await gladys.fake.setValue(created, state, COVER_STATE.STOP)).success, true);
  const open = await gladys.fake.setValue(created, state, COVER_STATE.OPEN);
  assert.equal(open.success, false);
  assert.match(open.error, /became a gate in 0\.1\.3.*Discovery, press "Update"/);
  assert.deepEqual(sent(box), ['300:close', '300:stop'], 'even with allow_gates: no opening');
  // Still never offered as a shutter.
  const again = gladys.fake.discoveredDevices.find((d) => d.name === GATE);
  assert.ok(again.features.every((f) => f.category !== C.SHUTTER));
});

test('review B1 / H4: a gate with a position whose value is null never opens', async (t) => {
  const config = { ...BASE, allow_gates: true };
  const fgr = yubiiGate({
    top: { type: 'com.fibaro.FGR223', baseType: 'com.fibaro.rollerShutter' },
    actions: ['open', 'close', 'stop', 'setValue'],
    properties: { value: null, deviceRole: 'Gate' },
  });
  const box = fakeFibaro({ devices: [...hc3Devices(), fgr] });
  const { press } = await setup(t, { config, box });
  const open = await press(GATE, 'open');
  assert.equal(open.success, false);
  assert.match(open.error, /state unknown, opening refused/);
  assert.deepEqual(sent(box), []);
});

const relay = (id, name) => ({
  ...yubiiGate({
    actions: ['turnOn', 'turnOff', 'toggle'],
    properties: { value: true, deviceRole: 'Other', power: 1500, energy: 12 },
  }),
  id,
  name,
  type: 'com.fibaro.binarySwitch',
  baseType: 'com.fibaro.actor',
  interfaces: ['zwave', 'power', 'energy'],
});
const onOff = (ids, id) => ({
  name: 'On/off',
  external_id: ids(id).feature('binary'),
  category: C.SWITCH,
  type: 'binary',
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: true,
  keep_history: true,
});

test('review 2 / H6: "Chauffage garage" created as a switch stays a switch and turns off', async (t) => {
  const box = fakeFibaro({ devices: [...hc3Devices(), relay(310, 'Chauffage garage')] });
  const { gladys } = await setup(t, {
    box,
    created: (ids) => [
      {
        name: 'Chauffage garage (Entrée)',
        external_id: ids(310).device,
        features: [onOff(ids, 310)],
      },
    ],
  });
  const legacy = gladys.devices.find((d) => d.name === 'Chauffage garage (Entrée)');
  const off = await gladys.fake.setValue(legacy, legacy.features[0], 0);
  assert.equal(off.success, true, off.error);
  assert.deepEqual(sent(box), ['310:turnOff']);
  const published = gladys.fake.discoveredDevices.find((d) => d.external_id === legacy.external_id);
  assert.deepEqual(
    published.features.map((f) => `${f.external_id.split(':').at(-1)} ${f.category}`),
    [`binary ${C.SWITCH}`, `power ${C.SWITCH}`, `energy ${C.SWITCH}`],
    'nothing lost, same categories',
  );
});

test('review 2: a relay that became a gate by its name turns off until "Update", never on', async (t) => {
  const config = { ...BASE, allow_gates: true };
  const box = fakeFibaro({ devices: [...hc3Devices(), relay(320, 'Portail')] });
  const { gladys } = await setup(t, {
    config,
    box,
    created: (ids) => [
      { name: 'Portail (Entrée)', external_id: ids(320).device, features: [onOff(ids, 320)] },
    ],
  });
  const legacy = gladys.devices.find((d) => d.name === 'Portail (Entrée)');
  const [binary] = legacy.features;
  assert.equal((await gladys.fake.setValue(legacy, binary, 0)).success, true);
  const on = await gladys.fake.setValue(legacy, binary, 1);
  assert.equal(on.success, false);
  assert.match(on.error, /became a gate in 0\.1\.3.*Discovery, press\s+"Update"/);
  assert.deepEqual(sent(box), ['320:turnOff'], 'even with allow_gates: no pulse');
  const published = gladys.fake.discoveredDevices.find((d) => d.external_id === legacy.external_id);
  assert.ok(
    published.features.every((f) => f.category !== C.SWITCH),
    'never offered as a switch',
  );
});

// --- Through the app -------------------------------------------------------------

const BASE = { host: '192.168.1.50', username: USER, password: PASSWORD };

async function setup(
  t,
  {
    config = BASE,
    box = fakeFibaro({ devices: [...shutterDevices(), ...hc3Devices()] }),
    created = () => [],
  } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  // The devices already created in Gladys (by an older version), by external ids.
  const ids = (id) => createFakeGladys({ config }).externalIds('fibaro', String(id));
  const gladys = createFakeGladys({ config, devices: created(ids) });
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
