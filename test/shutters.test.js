// -----------------------------------------------------------------------------
// Shutters (issue #4): every Fibaro shutter type is a `shutter` device that
// Gladys can drive, never a switch nor a button-only device; the command
// values are checked strictly; the commands of one device are serialized,
// a stop never waits, and a command that may have reached the box is never
// reported as "not sent".
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
import { T } from '../src/i18n.js';
import { buildInventory } from '../src/inventory.js';
import { COVER_STATE, isShutter, mapDevice, roleOf, strictNumber } from '../src/mapping.js';
import { PASSWORD, ROOMS, USER, shutterDevices } from './fixtures/fibaro.js';
import { fakeFibaro, settle } from './helpers/fakeFibaro.js';

const inventory = () => buildInventory({ devices: shutterDevices(), rooms: ROOMS });
const byId = () => new Map(inventory().devices.map((d) => [d.id, d]));
const specsOf = (dev) =>
  mapDevice(dev).features.map(
    (f) => `${f.key} ${f.category}/${f.type}${f.read_only ? ' read-only' : ''}`,
  );

test('every shutter type is a controllable shutter, never a switch', () => {
  const devices = byId();
  for (const id of ['201', '211', '220', '230', '240']) {
    const dev = devices.get(id);
    assert.equal(roleOf(dev), 'cover', `${dev.type} (${dev.baseType})`);
    const { features, writers } = mapDevice(dev);
    assert.ok(
      features.every((f) => f.category !== C.SWITCH && f.category !== C.LIGHT),
      `${dev.type}: no switch or light feature`,
    );
    const state = features.find((f) => f.key === 'state');
    assert.ok(state, `${dev.type} has open / close`);
    assert.equal(state.category, C.SHUTTER);
    assert.equal(state.read_only, false);
    assert.ok(writers.state);
  }
});

test('Roller Shutter 3 (FGR223) with its S1/S2 keys: position, open/close and the buttons', () => {
  const fgr223 = byId().get('201');
  assert.deepEqual(specsOf(fgr223), [
    'position shutter/position',
    'state shutter/state',
    'power energy-sensor/power read-only',
    'energy energy-sensor/index read-only',
    'button-1 button/click read-only',
    'button-2 button/click read-only',
  ]);
  const { writers } = mapDevice(fgr223);
  assert.deepEqual(writers.position(50), [{ name: 'setValue', args: [50] }]);
  assert.deepEqual(writers.state(COVER_STATE.OPEN), [{ name: 'open', args: [] }]);
  assert.deepEqual(writers.state(COVER_STATE.STOP), [{ name: 'stop', args: [], protective: true }]);
  assert.deepEqual(writers.position(0), [{ name: 'setValue', args: [0], protective: true }]);
});

test('Walli, HC2 FGR221, a one-way radio motor and a shutter reported as a dimmer', () => {
  const devices = byId();
  assert.deepEqual(specsOf(devices.get('211')).slice(0, 2), [
    'position shutter/position',
    'state shutter/state',
  ]);
  const hc2 = mapDevice(devices.get('240'));
  assert.equal(hc2.readers.find((r) => r.key === 'position').read({ value: '25' }), 25);
  assert.deepEqual(specsOf(devices.get('220')), ['state shutter/state'], 'no position');
  // Before the fix: a dimmer (its base type), an "everything off" would have moved it.
  const office = devices.get('230');
  assert.deepEqual(specsOf(office), ['position shutter/position', 'state shutter/state']);
  assert.deepEqual(mapDevice(office).writers.state(COVER_STATE.CLOSE), [
    { name: 'close', args: [], protective: true },
  ]);
});

test('a gate, a lock, an RGBW controller are not shutters', () => {
  const gate = byId().get('250');
  assert.equal(roleOf(gate), 'gate');
  const base = { interfaces: undefined, properties: {} };
  assert.equal(
    roleOf({ ...base, type: 'com.fibaro.doorLock', baseType: '', actions: ['open', 'close'] }),
    'lock',
  );
  assert.equal(
    roleOf({ ...base, type: 'com.acme.x', baseType: '', actions: ['secure', 'open', 'close'] }),
    'lock',
  );
  assert.equal(
    isShutter({
      ...base,
      type: 'com.fibaro.FGRGBW441M',
      baseType: 'com.fibaro.colorController',
      actions: ['turnOn'],
    }),
    false,
  );
  assert.equal(
    isShutter({ ...base, type: 'com.fibaro.FGRM222', baseType: 'com.fibaro.FGR', actions: [] }),
    true,
  );
});

test('command values are checked strictly: null and empty never close a shutter', () => {
  const { writers } = mapDevice(byId().get('201'));
  for (const bad of [null, undefined, '', ' ', 'abc', Number.NaN, 101, -1, true]) {
    assert.throws(() => writers.position(bad), /invalid value/, `position ${String(bad)}`);
  }
  for (const bad of [null, '', 2, -2, 'open']) {
    assert.throws(() => writers.state(bad), /invalid value/, `state ${String(bad)}`);
  }
  assert.deepEqual(writers.position('30'), [{ name: 'setValue', args: [30] }]);
  assert.deepEqual(writers.position(100), [{ name: 'setValue', args: [99] }]);
  assert.equal(strictNumber(0, 0, 1), 0);
});

test('the connection test does not count the technical nodes as left out, and names the unknown types', () => {
  const inv = inventory();
  assert.deepEqual(inv.skipped, { disabled: 0, hidden: 2, plugins: 0, nodes: 2 });
  const model = buildModel((id) => ({ device: `d:${id}`, feature: (k) => `d:${id}:${k}` }), {
    devices: [
      ...inv.devices,
      {
        id: '999',
        name: 'Inconnu',
        type: 'com.acme.thing',
        baseType: 'com.fibaro.device',
        actions: [],
        properties: {},
      },
    ],
  });
  assert.deepEqual(model.emptyTypes, ['com.acme.thing (com.fibaro.device)']);
  const text = T.test.ok({
    model: { name: 'Yubii Home', version: '5.210.12', api: 5 },
    devices: model.devices.length,
    read: inv.devices.length + 1,
    disabled: 0,
    hidden: inv.skipped.hidden,
    plugins: 0,
    nodes: inv.skipped.nodes,
    empty: model.counts.empty,
    emptyTypes: model.emptyTypes,
    scenes: 0,
  });
  assert.equal(
    text.fr,
    'Connexion OK, Yubii Home (firmware 5.210.12, API v5) : 9 appareils, 0 scènes. ' +
      '6 appareils proposés dans Découverte, 2 nœuds techniques de la box non affichés ' +
      '(normal : leurs sous-appareils sont les appareils), 1 écarté (0 désactivés, 0 masqués, ' +
      '0 plugins ou Quick Apps, 1 sans rien à proposer : com.acme.thing (com.fibaro.device)).',
  );
});

// --- Commands through the app ------------------------------------------------------

const CONFIG = { host: '192.168.1.50', username: USER, password: PASSWORD };

async function setup(t, box) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  const gladys = createFakeGladys({ config: CONFIG });
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
  return { gladys, app };
}

const shutterOf = (gladys, name) => {
  const device = gladys.fake.discoveredDevices.find((d) => d.name === name);
  assert.ok(device, name);
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
  return { device, feature };
};

test('the shutters are driven through the box, with a short action timeout', async (t) => {
  const box = fakeFibaro({ devices: shutterDevices() });
  const { gladys } = await setup(t, box);
  const office = shutterOf(gladys, 'Volet bureau (Chambre)');
  const ack = await gladys.fake.setValue(office.device, office.feature('position'), 70);
  assert.equal(ack.success, true, ack.error);
  const call = box.callsOf('callAction').at(-1);
  assert.deepEqual(call.args[0], { api: 5, deviceId: '230', name: 'setValue', args: [70] });
  assert.deepEqual(call.args[1], { timeout: TIMINGS.commandTimeout });
  assert.ok(TIMINGS.commandTimeout + TIMINGS.commandQueueWait <= 4000, 'within the Gladys 5 s');

  const refused = await gladys.fake.setValue(office.device, office.feature('position'), null);
  assert.equal(refused.success, false);
  assert.equal(box.actions.length, 1, 'an invalid value sends nothing');
});

test('a timeout after sending is "sent, without confirmation", never "not sent"', async (t) => {
  const box = fakeFibaro({ devices: shutterDevices() });
  const { gladys } = await setup(t, box);
  const living = shutterOf(gladys, 'Volet séjour (Salon)');
  box.actionErrors['201:close'] = new FibaroError('timeout', 'no answer within 3 s', {
    sent: true,
  });
  const ack = await gladys.fake.setValue(living.device, living.feature('state'), COVER_STATE.CLOSE);
  assert.equal(ack.success, false);
  assert.match(ack.error, /sent to device 201, without confirmation/);
  assert.doesNotMatch(ack.error, /not sent/);
});

test('the commands of one shutter are serialized, a stop never waits', async (t) => {
  const box = fakeFibaro({ devices: shutterDevices() });
  const { app } = await setup(t, box);
  // A slow first command: the client answers when the test says so.
  const client = app.client;
  const original = client.callAction;
  let release;
  const order = [];
  client.callAction = async (action, options) => {
    order.push(action.name);
    if (action.name === 'open') {
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    return original(action, options);
  };
  const feature = (key) => ({ external_id: `ext:test-integration:fibaro:201:${key}` });
  const first = app.setValue({}, feature('state'), COVER_STATE.OPEN);
  await settle();
  const second = app.setValue({}, feature('position'), 40);
  const stop = app.setValue({}, feature('state'), COVER_STATE.STOP);
  await settle();
  assert.deepEqual(order, ['open', 'stop'], 'the stop went at once, the position waits');
  await stop;
  t.mock.timers.tick(TIMINGS.commandQueueWait + 1);
  release();
  await first;
  await assert.rejects(second, /busy with a previous command: this one was not sent/);
  assert.deepEqual(order, ['open', 'stop'], 'the late command was never sent');
});

test('a light or a plug is never queued: only shutters, gates, locks and valves are', async (t) => {
  const box = fakeFibaro();
  const { app } = await setup(t, box);
  const client = app.client;
  const original = client.callAction;
  let release;
  const order = [];
  client.callAction = async (action, options) => {
    order.push(`${action.deviceId}:${action.name}`);
    if (action.name === 'turnOn') {
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    return original(action, options);
  };
  const plug = { external_id: 'ext:test-integration:fibaro:31:binary' };
  const first = app.setValue({}, plug, 1);
  await settle();
  const second = app.setValue({}, plug, 0);
  await settle();
  assert.deepEqual(order, ['31:turnOn', '31:turnOff'], 'no wait behind the first one');
  release();
  await Promise.all([first, second]);
  assert.equal(app.queues.size, 0);
});
