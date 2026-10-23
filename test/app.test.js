// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake Fibaro box. Timers are mocked: the refreshStates loop,
// the reconnections and the state flush run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FibaroApp } from '../src/app.js';
import { ACTIONS, SCENE_ACTIONS, SCENE_TRIGGERS, TIMINGS } from '../src/constants.js';
import { FibaroError } from '../src/fibaro.js';
import { registerHandlers } from '../src/handlers.js';
import { T } from '../src/i18n.js';
import { OPENING_SENSOR_STATE } from '../src/mapping.js';
import { PASSWORD, USER, hc2Devices, hc3Devices, pyfibaro } from './fixtures/fibaro.js';
import { fakeFibaro, settle } from './helpers/fakeFibaro.js';

const DEVICE = (id) => `ext:test-integration:fibaro:${id}`;
const CONFIG = { host: '192.168.1.50', username: USER, password: PASSWORD };
const POLL = TIMINGS.pollGap;

async function setup(t, { config = CONFIG, box = fakeFibaro() } = {}) {
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
  // The first refreshStates request is scheduled at once.
  await tick(0);
  return { gladys, app, box, tick };
}

const deviceNamed = (gladys, name) => gladys.fake.discoveredDevices.find((d) => d.name === name);

async function created(gladys, name) {
  const device = deviceNamed(gladys, name);
  assert.ok(device, `${name} is discovered`);
  await gladys.fake.deviceCreated(device);
  return device;
}

const featureOf = (device, key) => {
  const feature = device.features.find((f) => f.external_id === `${device.external_id}:${key}`);
  assert.ok(feature, `${device.name} has ${key}`);
  return feature;
};

test('the devices of the box become Gladys devices, the values flow once created', async (t) => {
  const { gladys, box, tick } = await setup(t);
  assert.equal(box.clients[0].config.origin, 'http://192.168.1.50');
  assert.equal(gladys.fake.discoveredDevices.length, 19);
  assert.deepEqual(gladys.fake.discoveredDevices.map((d) => d.name).slice(0, 6), [
    'Prise TV (Salon)',
    'Lampe salon (Salon)',
    'Variateur salon (Salon)',
    'Ruban LED (Chambre)',
    'Volet salon (Salon)',
    'Store terrasse (Salon)',
  ]);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'Connected to the Home Center 3 (firmware 5.150.25): 19 devices in Discovery.',
  );

  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, 0, 'nothing is sent for a device not created');

  const plug = await created(gladys, 'Prise TV (Salon)');
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${plug.external_id}:binary`), 1);
  assert.equal(gladys.fake.lastState(`${plug.external_id}:power`), 85.3);
  assert.equal(gladys.fake.lastState(`${plug.external_id}:energy`), 12.5);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: plug.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('the refreshStates changes reach Gladys, the inventory is not read again', async (t) => {
  const { gladys, app, box, tick } = await setup(t);
  const plug = await created(gladys, 'Prise TV (Salon)');
  const door = await created(gladys, "Porte d'entrée (Entrée)");
  await tick(TIMINGS.flushInterval);

  box.change(31, { value: false, power: 0.4 });
  box.change(80, { value: true });
  box.change(101, { value: true }); // hidden: not offered
  await tick(POLL);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${plug.external_id}:binary`), 0);
  assert.equal(gladys.fake.lastState(`${door.external_id}:opening`), OPENING_SENSOR_STATE.OPEN);
  assert.equal(
    gladys.fake.lastState(`${plug.external_id}:power`),
    85.3,
    'a measurement waits for the sensor interval',
  );
  await tick(10_000);
  assert.equal(gladys.fake.lastState(`${plug.external_id}:power`), 0.4);

  // The HC3 also reports a property as an event.
  box.event('DevicePropertyUpdatedEvent', {
    id: 31,
    property: 'value',
    oldValue: false,
    newValue: true,
  });
  await tick(POLL);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${plug.external_id}:binary`), 1);

  const polls = box.callsOf('refreshStates');
  assert.equal(polls.at(-1).args[0], box.last, 'the cursor follows the answers');
  assert.equal(box.callsOf('devices').length, 1, 'no inventory read for value changes');
  assert.equal(app.props.get('31').value, true);
});

test('the Gladys commands run the device actions (API v5)', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const run = async (name, key, value) => {
    const device = deviceNamed(gladys, name);
    const before = box.actions.length;
    const ack = await gladys.fake.setValue(device, featureOf(device, key), value);
    assert.equal(ack.success, true, `${name} ${key}=${value}: ${ack.error}`);
    return box.actions
      .slice(before)
      .map(({ api, deviceId, name: action, args }) => [api, deviceId, action, ...args]);
  };
  assert.deepEqual(await run('Prise TV (Salon)', 'binary', 0), [[5, '31', 'turnOff']]);
  assert.deepEqual(await run('Lampe salon (Salon)', 'brightness', 100), [
    [5, '41', 'setValue', 99],
  ]);
  assert.deepEqual(await run('Ruban LED (Chambre)', 'color', 0x0000ff), [
    [5, '50', 'setColor', '0', '0', '255', '0'],
  ]);
  assert.deepEqual(await run('Volet salon (Salon)', 'state', -1), [[5, '60', 'close']]);
  assert.deepEqual(await run('Volet salon (Salon)', 'position', 30), [[5, '60', 'setValue', 30]]);
  assert.deepEqual(await run('Radiateur chambre (Chambre)', 'setpoint', 21.5), [
    [5, '70', 'setHeatingThermostatSetpoint', 21.5],
  ]);
  assert.deepEqual(await run('Radiateur chambre (Chambre)', 'mode', 0), [
    [5, '70', 'setThermostatMode', 'Off'],
  ]);
  assert.deepEqual(await run('Serrure (Entrée)', 'lock', 1), [[5, '90', 'secure']]);
  const lock = deviceNamed(gladys, 'Serrure (Entrée)');
  const unlock = await gladys.fake.setValue(lock, featureOf(lock, 'lock'), 0);
  assert.equal(unlock.success, false, 'unlocking is off by default');
  assert.match(unlock.error, /refused, not sent: turn on the "allow_unlock" option/);

  const store = await created(gladys, 'Store terrasse (Salon)');
  assert.deepEqual(await run('Store terrasse (Salon)', 'state', 1), [[5, '61', 'open']]);
  await tick(TIMINGS.flushInterval);
  assert.equal(
    gladys.fake.lastState(`${store.external_id}:state`),
    1,
    'without a property to read, Gladys keeps the value sent',
  );

  const plug = deviceNamed(gladys, 'Prise TV (Salon)');
  const refused = await gladys.fake.setValue(plug, featureOf(plug, 'power'), 1);
  assert.equal(refused.success, false, 'a sensor cannot be controlled');

  box.actionErrors['31:turnOn'] = new FibaroError('http', 'HTTP 500', { status: 500 });
  const failed = await gladys.fake.setValue(plug, featureOf(plug, 'binary'), 1);
  assert.equal(failed.success, false);
  assert.match(failed.error, /HTTP 500/);
});

test('a Home Center 2: API v4, string values, no sections', async (t) => {
  const box = fakeFibaro({
    info: pyfibaro('info'),
    devices: hc2Devices(),
    rooms: pyfibaro('room'),
    sections: new FibaroError('notfound', 'not found', { status: 404 }),
    scenes: pyfibaro('scene'),
  });
  const { gladys, app, tick } = await setup(t, { box });
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    // 7: the hidden relay of the pyfibaro scene-support module is offered next
    // to its S1/S2 keys (issue #4).
    'Connected to the Home Center 2 (firmware 4.630): 7 devices in Discovery.',
  );
  const hifi = await created(gladys, 'Hifi (Wohnen)');
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${hifi.external_id}:binary`), 1);
  assert.equal(gladys.fake.lastState(`${hifi.external_id}:power`), 14.03);

  const ack = await gladys.fake.setValue(hifi, featureOf(hifi, 'binary'), 0);
  assert.equal(ack.success, true);
  assert.deepEqual(box.actions.at(-1), { api: 4, deviceId: '13', name: 'turnOff', args: [] });

  box.change(13, { value: 'false' });
  await tick(POLL);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${hifi.external_id}:binary`), 0);

  // HC2 events name the device `deviceId`.
  box.event('CentralSceneEvent', { deviceId: 387, keyId: 3, keyAttribute: 'HeldDown' });
  await tick(POLL);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: SCENE_TRIGGERS.BUTTON,
    data: { device: DEVICE(387), button: 3, event: 'held', attribute: 'HeldDown' },
  });

  const run = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_SCENE, { scene: 2 });
  assert.equal(run.success, true);
  assert.deepEqual(box.scenesRun.at(-1), { api: 4, sceneId: 2 });

  // Real refreshStates answers (pyfibaro): logs, unknown devices and power
  // metrics are skipped, the changes of a known device applied, the cursor kept.
  app.applyChanges(app.generation, pyfibaro('refresh_extended'));
  app.applyChanges(app.generation, pyfibaro('refresh'));
  assert.equal(app.last, 2639046);
  assert.equal(app.props.has('28'), false);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${hifi.external_id}:binary`), 1);
});

test('remote keys: button states one by one, and the scene trigger', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const remote = await created(gladys, 'Télécommande (Salon)');
  await tick(TIMINGS.flushInterval);
  box.event('CentralSceneEvent', { id: 95, keyId: 2, keyAttribute: 'Pressed' });
  box.event('CentralSceneEvent', { id: 95, keyId: 2, keyAttribute: 'Pressed' });
  box.event('CentralSceneEvent', { id: 95, keyId: 2, keyAttribute: 'Pressed2' });
  box.event('CentralSceneEvent', { id: 999, keyId: 1, keyAttribute: 'Pressed' }); // not offered
  await tick(POLL);
  await tick(TIMINGS.flushInterval);
  const button = `${remote.external_id}:button-2`;
  assert.deepEqual(
    gladys.fake.states.filter((s) => s.device_feature_external_id === button).map((s) => s.state),
    [1, 1, 2],
    'two identical presses are two states',
  );
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data.device, e.data.button, e.data.event]),
    [
      [SCENE_TRIGGERS.BUTTON, remote.external_id, 2, 'pressed'],
      [SCENE_TRIGGERS.BUTTON, remote.external_id, 2, 'pressed'],
      [SCENE_TRIGGERS.BUTTON, remote.external_id, 2, 'double'],
    ],
  );

  // The scene keys of a dimmer fire the trigger even before the device is created.
  box.event('CentralSceneEvent', { id: 42, keyId: 1, keyAttribute: 'Released' });
  await tick(POLL);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1).data, {
    device: DEVICE(42),
    button: 1,
    event: 'released',
    attribute: 'Released',
  });
});

test('a dead device has a degraded badge until it answers again', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const garage = await created(gladys, 'Prise garage (Cuisine)');
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: garage.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
    degraded: true,
    message: T.dead,
  });
  box.change(103, { dead: false });
  await tick(POLL);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: garage.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('a failure marks the box unreachable, the reconnection reads the inventory again', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const plug = await created(gladys, 'Prise TV (Salon)');
  box.fail = new FibaroError('network', 'connection refused');
  await tick(POLL);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /unreachable: connection refused/);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: plug.external_id,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  });
  const offline = await gladys.fake.setValue(plug, featureOf(plug, 'binary'), 1);
  assert.equal(offline.success, false);
  assert.match(offline.error, /not connected/);

  // Missed while unreachable: the inventory brings it back.
  box.fail = undefined;
  box.devices.find((d) => d.id === 31).properties.value = false;
  const inventories = box.callsOf('devices').length;
  await tick(TIMINGS.retryMin);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(box.callsOf('devices').length, inventories + 1);
  assert.equal(gladys.fake.lastState(`${plug.external_id}:binary`), 0);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.LOCAL);
});

test('refused credentials are retried every few minutes only', async (t) => {
  const { gladys, box, tick } = await setup(t, {
    config: { ...CONFIG, password: 'wrong' },
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the user name or the password/);
  const attempts = box.calls.length;
  await tick(TIMINGS.retryMax);
  assert.equal(box.calls.length, attempts);
  await tick(TIMINGS.authRetry - TIMINGS.retryMax);
  assert.equal(box.calls.length, attempts + 1);
});

test('the connection test and the scene list', async (t) => {
  const { gladys, box } = await setup(t);
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Connection OK, Home Center 3 (firmware 5.150.25, API v5): 27 devices, 3 scenes. 19 devices offered in Discovery, 3 technical nodes of the box not shown (normal: their endpoints are the devices), 5 left out (1 disabled, 1 hidden, 2 plugins or Quick Apps, 1 with nothing to offer: com.fibaro.zwaveDevice (com.fibaro.device)).',
  );
  assert.match(
    ack.data.message.fr,
    /^Connexion OK, Home Center 3 \(firmware 5\.150\.25, API v5\) : 27 appareils/,
  );
  assert.equal(box.clients.at(-1).closed, true, 'the test client is closed');

  const scenes = await gladys.fake.action(ACTIONS.LIST_SCENES, {});
  assert.equal(
    scenes.data.message.en,
    'Scene numbers for the "Run a Fibaro scene" action: 10: Bonne nuit · 11: Départ.',
  );

  box.fail = new FibaroError('certificate', 'certificate refused (DEPTH_ZERO_SELF_SIGNED_CERT)');
  const down = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(
    down.data.message.en,
    /unreachable: certificate refused .* turn off "Verify the TLS certificate"/,
  );
});

test('the "Run a Fibaro scene" action', async (t) => {
  const { gladys, box } = await setup(t);
  const ok = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_SCENE, { scene: 11 });
  assert.equal(ok.success, true);
  assert.deepEqual(box.scenesRun, [{ api: 5, sceneId: 11 }]);
  const unknown = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_SCENE, { scene: 99 });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /no scene 99/);
  const invalid = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_SCENE, { scene: 'abc' });
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /not a Fibaro scene number/);
});

test('without an address or credentials, the status says what to fill in', async (t) => {
  const { gladys, box } = await setup(t, { config: {} });
  assert.equal(gladys.fake.connectionStatus.message.en, T.notConfigured.en);
  assert.equal(box.clients.length, 0);
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.deepEqual(ack.data.message, T.notConfigured);

  await gladys.fake.configUpdated({ host: '192.168.1.50' });
  assert.equal(gladys.fake.connectionStatus.message.en, T.noUser.en);
  await gladys.fake.configUpdated({ host: '192.168.1.50', username: USER });
  assert.equal(gladys.fake.connectionStatus.message.en, T.noPassword.en);
  await gladys.fake.configUpdated(CONFIG);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a device added in the box shows up, Scan and a new configuration read again', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const [, , , , plug] = hc3Devices();
  box.devices.push({ ...structuredClone(plug), id: 110, name: 'Nouvelle prise' });
  box.event('DeviceCreatedEvent', { id: 110 });
  await tick(POLL);
  assert.equal(gladys.fake.discoveredDevices.length, 19);
  await tick(TIMINGS.inventoryDebounce);
  assert.equal(gladys.fake.discoveredDevices.length, 20);
  assert.ok(deviceNamed(gladys, 'Nouvelle prise (Salon)'));

  await gladys.fake.scanRequest();
  assert.equal(box.callsOf('devices').length, 3);

  await gladys.fake.configUpdated({ ...CONFIG, host: 'https://192.168.1.50' });
  assert.equal(box.clients[0].closed, true);
  assert.equal(box.clients.at(-1).config.origin, 'https://192.168.1.50');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
