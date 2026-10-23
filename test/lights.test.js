// -----------------------------------------------------------------------------
// Issue #4 (Yubii Home, 0.1.2): "Éclairage extérieur" offered as a "button"
// only. A relay with a lamp role is a light; the hidden relay of a module whose
// S1/S2 keys are offered is offered too, as its own device; the keys stay a
// separate trigger device. Fixtures written after the HC3 API documentation
// and the pyfibaro dump of a real HC3 switch module (device-scene-support-hc3:
// hidden node, hidden relay, hidden central-scene endpoint), not dumped from
// the user's box.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  createLogger,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FibaroApp } from '../src/app.js';
import { buildModel } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import { buildInventory } from '../src/inventory.js';
import { isLight, mapDevice, roleOf } from '../src/mapping.js';
import { PASSWORD, USER, hc3Devices } from './fixtures/fibaro.js';
import { fakeFibaro, settle } from './helpers/fakeFibaro.js';

const GARDEN = { id: 230, name: 'Jardin', sectionID: 1 };
const KEYS = ['Pressed', 'Released', 'HeldDown', 'Pressed2', 'Pressed3'];

const device = (id, name, type, baseType, o = {}) => ({
  id,
  name,
  roomID: 230,
  type,
  baseType,
  enabled: true,
  visible: o.visible ?? true,
  isPlugin: false,
  parentId: o.parent ?? 0,
  interfaces: o.interfaces ?? ['zwave'],
  properties: { dead: false, deviceRole: 'Other', ...o.properties },
  actions: Object.fromEntries((o.actions ?? []).map((a) => [a, 0])),
});

const RELAY = ['turnOn', 'turnOff', 'toggle', 'reconfigure'];
const scenes = (parent, id = 502) =>
  device(id, `${parent}.0.1`, 'com.fibaro.remoteController', 'com.fibaro.actor', {
    parent,
    visible: false,
    interfaces: ['zwave', 'zwaveCentralScene'],
    properties: {
      categories: ['remotes'],
      centralSceneSupport: [
        { keyAttributes: KEYS, keyId: 1 },
        { keyAttributes: KEYS, keyId: 2 },
      ],
    },
    actions: ['reconfigure'],
  });

/** A Smart Module whose relay the box hides: only the S1/S2 endpoint was offered by 0.1.2. */
const hiddenRelayModule = (relay = {}) => [
  device(500, 'Eclairage Extérieur', 'com.fibaro.zwaveDevice', 'com.fibaro.device', {
    visible: false,
    parent: 1,
    actions: ['reconfigure', 'getParameter', 'setParameter'],
  }),
  device(501, relay.name ?? 'Eclairage Extérieur', 'com.fibaro.binarySwitch', 'com.fibaro.actor', {
    parent: 500,
    visible: false,
    interfaces: ['energy', 'power', 'zwave'],
    properties: { value: false, state: false, power: 0, energy: 1.2, ...relay.properties },
    actions: RELAY,
  }),
  scenes(500),
];

const ids = (id) => ({ device: `ext:t:fibaro:${id}`, feature: (k) => `ext:t:fibaro:${id}:${k}` });
const inv = (devices) => buildInventory({ devices, rooms: [GARDEN] });

test('a relay with a lamp role or the "lights" category is a light, never a plain switch', () => {
  const relay = (properties, interfaces = ['zwave']) =>
    inv([
      device(600, 'Lampe', 'com.fibaro.binarySwitch', 'com.fibaro.actor', {
        interfaces,
        properties: { value: false, ...properties },
        actions: RELAY,
      }),
    ]).devices[0];
  for (const deviceRole of ['Light', 'OutdoorLight', 'GardenLamp', 'NightLamp', 'Bracket']) {
    const d = relay({ deviceRole });
    assert.equal(isLight(d), true, deviceRole);
    assert.deepEqual(
      mapDevice(d).features.map((f) => `${f.key} ${f.category}/${f.type}`),
      [`binary ${C.LIGHT}/${T.LIGHT.BINARY}`],
      deviceRole,
    );
  }
  assert.equal(isLight(relay({ categories: ['lights'] })), true, 'HC3 category');
  assert.equal(isLight(relay({ categories: '["lights"]' })), true, 'HC2 serialized list');
  assert.equal(isLight(relay({ deviceRole: 'Other' })), false, 'a plug stays a switch');
  assert.equal(mapDevice(relay({ deviceRole: 'Other' })).features[0].category, C.SWITCH);
  assert.equal(isLight(relay({ deviceRole: 'Kettle' })), false);
});

test('a hidden relay of a module whose S1/S2 keys are offered is offered too, as a light', () => {
  const inventory = inv(hiddenRelayModule({ properties: { deviceRole: 'GardenLamp' } }));
  assert.deepEqual(
    inventory.devices.map((d) => `${d.id} ${d.name}`),
    ['501 Eclairage Extérieur', '502 Eclairage Extérieur S1/S2'],
    'two cards, two names',
  );
  assert.deepEqual(inventory.skipped, { disabled: 0, hidden: 1, plugins: 0, nodes: 1 });
  const model = buildModel(ids, inventory);
  const [light, keys] = model.devices;
  assert.equal(light.external_id, 'ext:t:fibaro:501');
  assert.equal(light.name, 'Eclairage Extérieur (Jardin)');
  assert.deepEqual(
    light.features.map((f) => `${f.external_id.split(':').at(-1)} ${f.category}`),
    [`binary ${C.LIGHT}`, `power ${C.SWITCH}`, `energy ${C.SWITCH}`],
  );
  // The keys keep their device and feature external ids: a trigger, not the command.
  assert.equal(keys.external_id, 'ext:t:fibaro:502');
  assert.deepEqual(
    keys.features.map((f) => `${f.external_id.split(':').at(-1)} ${f.category}/${f.type}`),
    [`button-1 ${C.BUTTON}/${T.BUTTON.CLICK}`, `button-2 ${C.BUTTON}/${T.BUTTON.CLICK}`],
  );
  assert.equal(roleOf(inventory.devices[1]), 'remote');
});

test('the relay keeps its own name; a numeric name takes the module name', () => {
  const own = inv(hiddenRelayModule({ name: 'Lumière allée' }));
  assert.deepEqual(
    own.devices.map((d) => d.name),
    ['Lumière allée', 'Eclairage Extérieur'],
    'no clash: names unchanged',
  );
  const numeric = inv(hiddenRelayModule({ name: '500.0.2' }));
  assert.deepEqual(
    numeric.devices.map((d) => d.name),
    ['Eclairage Extérieur', 'Eclairage Extérieur S1/S2'],
  );
});

test('a relay that is itself the parent of its S1/S2 endpoint: the two names differ', () => {
  const devices = [
    device(510, 'Eclairage Extérieur', 'com.fibaro.binarySwitch', 'com.fibaro.actor', {
      parent: 1,
      properties: { value: true, deviceRole: 'OutdoorLight' },
      actions: RELAY,
    }),
    scenes(510, 511),
  ];
  const inventory = inv(devices);
  assert.deepEqual(
    inventory.devices.map((d) => `${d.id} ${d.name}`),
    ['510 Eclairage Extérieur', '511 Eclairage Extérieur S1/S2'],
  );
  assert.equal(mapDevice(inventory.devices[0]).features[0].category, C.LIGHT);
});

test('hidden devices stay out when no S1/S2 endpoint of their module is offered', () => {
  const lone = inv([
    device(520, 'Lampe cachée', 'com.fibaro.binarySwitch', 'com.fibaro.actor', {
      visible: false,
      parent: 1,
      properties: { value: false },
      actions: RELAY,
    }),
  ]);
  assert.deepEqual(lone.devices, []);
  // A hidden sensor of a module is not an output.
  const sensor = inv([
    ...hiddenRelayModule(),
    device(503, 'Température', 'com.fibaro.temperatureSensor', 'com.fibaro.multilevelSensor', {
      parent: 500,
      visible: false,
      properties: { value: 12, unit: 'C' },
    }),
  ]);
  assert.ok(!sensor.devices.some((d) => d.id === '503'));
  // The fixture of the other tests is unchanged: a visible dimmer and its keys.
  const hc3 = buildInventory({ devices: hc3Devices() });
  assert.equal(hc3.devices.find((d) => d.id === '42').name, 'Variateur salon');
});

test('through the app: the light turns on and off, the keys stay a trigger', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  const box = fakeFibaro({
    devices: [...hc3Devices(), ...hiddenRelayModule({ properties: { deviceRole: 'GardenLamp' } })],
    rooms: [GARDEN],
  });
  const gladys = createFakeGladys({
    config: { host: '192.168.1.50', username: USER, password: PASSWORD },
  });
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
  t.mock.timers.tick(0);
  await settle();
  const light = gladys.fake.discoveredDevices.find(
    (d) => d.name === 'Eclairage Extérieur (Jardin)',
  );
  assert.ok(light);
  const binary = light.features.find((f) => f.external_id.endsWith(':binary'));
  assert.equal(binary.category, C.LIGHT);
  assert.equal((await gladys.fake.setValue(light, binary, 1)).success, true);
  assert.equal((await gladys.fake.setValue(light, binary, 0)).success, true);
  assert.deepEqual(
    box.actions.map((a) => `${a.deviceId}:${a.name}`),
    ['501:turnOn', '501:turnOff'],
  );
  assert.ok(
    gladys.fake.discoveredDevices.some((d) => d.name === 'Eclairage Extérieur S1/S2 (Jardin)'),
  );
});
