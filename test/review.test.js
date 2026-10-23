// -----------------------------------------------------------------------------
// The points of the xhigh review of the gates / locks / valves change, one
// test (or more) per point: B1, I1, I3, I4, M1 to M8. The scenarios S1 to S11
// are the reviewer's.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { DEVICE_FEATURE_CATEGORIES as C } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FibaroApp } from '../src/app.js';
import { buildModel } from '../src/devices.js';
import { FibaroError, createClient } from '../src/fibaro.js';
import { registerHandlers } from '../src/handlers.js';
import { buildInventory } from '../src/inventory.js';
import { GUARDS, gateStateOf, isGate, mapDevice, roleOf, typeWords } from '../src/mapping.js';
import { PASSWORD, ROOMS, USER, hc3Devices, shutterDevices } from './fixtures/fibaro.js';
import { fakeFibaro, settle } from './helpers/fakeFibaro.js';

const dev = (o) => ({
  id: o.id ?? '500',
  name: o.name ?? 'X',
  type: o.type,
  baseType: o.baseType ?? '',
  interfaces: o.interfaces,
  actions: o.actions ?? [],
  properties: { dead: false, ...(o.properties ?? {}) },
});
const specs = (m) =>
  m.features.map((f) => `${f.key} ${f.category}/${f.type}${f.read_only ? ' ro' : ''}`);
const RELAY_ACTIONS = ['turnOn', 'turnOff', 'toggle', 'reconfigure']; // pyfibaro device 176

// --- B1: a gate never falls back on a switch, a dimmer or a shutter ---------------

test('B1 / S1: a relay with the Gate or GarageDoor role is a gate, Open pulses turnOn, guarded', () => {
  for (const deviceRole of ['Gate', 'GarageDoor']) {
    const relay = dev({
      type: 'com.fibaro.binarySwitch',
      baseType: 'com.fibaro.actor',
      properties: { value: false, deviceRole },
      actions: RELAY_ACTIONS,
    });
    assert.equal(roleOf(relay), 'gate', deviceRole);
    const m = mapDevice(relay);
    assert.deepEqual(specs(m), ['relay unknown/unknown ro', 'open button/push']);
    const [open] = m.writers.open(1);
    assert.deepEqual([open.name, open.guard], ['turnOn', GUARDS.GATES]);
    // Never decided on the relay value (the contact, not the gate position).
    assert.equal(open.decide({ value: true }), 'send');
    assert.equal(open.decide({ value: false }), 'send');
    assert.equal(open.decide({}), 'send');
    assert.throws(() => open.decide({ dead: true }), /dead/);
  }
});

test('B1 / S2: a barrier or a garage opener with turnOn only is a gate, never a switch', () => {
  for (const type of ['com.fibaro.barrier', 'com.acme.garageDoorOpener']) {
    const d = dev({ type, baseType: 'com.fibaro.actor', actions: ['turnOn', 'turnOff'] });
    assert.equal(roleOf(d), 'gate', type);
    assert.ok(
      mapDevice(d).features.every((f) => f.category !== C.SWITCH),
      type,
    );
  }
});

test('B1: no switch feature of 0.1.1 is kept on a gate', () => {
  const relay = dev({
    type: 'com.fibaro.binarySwitch',
    properties: { value: false, deviceRole: 'Gate' },
    actions: RELAY_ACTIONS,
  });
  const m = mapDevice(relay, undefined, new Set(['binary', 'power']));
  assert.equal(
    m.features.some((f) => f.key === 'binary'),
    false,
  );
  // 0.1.3 review 2: until "Update", the old On/off only turns the relay off
  // (protective); turning on (the gate pulse) is refused.
  assert.deepEqual(m.writers.binary(0), [{ name: 'turnOff', args: [], protective: true }]);
  assert.throws(() => m.writers.binary(1), /became a gate in 0\.1\.3/);
});

const BASE = { host: '192.168.1.50', username: USER, password: PASSWORD };

async function setup(t, { config = BASE, devices, logger } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  const box = fakeFibaro({ devices: devices ?? [...shutterDevices(), ...hc3Devices()] });
  const gladys = createFakeGladys({ config });
  const lines = [];
  const app = new FibaroApp({
    gladys,
    connect: box.connect,
    now: () => Date.now(),
    logger: logger ?? {
      debug: () => {},
      info: (m) => lines.push(m),
      warn: (m) => lines.push(m),
      error: (m) => lines.push(m),
    },
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  t.mock.timers.tick(0);
  await settle();
  const featureOf = (name, key) => {
    const device = gladys.fake.discoveredDevices.find((d) => d.name === name);
    assert.ok(device, name);
    const feature = device.features.find((f) => f.external_id.endsWith(`:${key}`));
    assert.ok(feature, `${name} ${key}`);
    return { device, feature };
  };
  const press = (name, key, value = 1) => {
    const { device, feature } = featureOf(name, key);
    return gladys.fake.setValue(device, feature, value);
  };
  return { gladys, app, box, press, lines };
}

const sent = (box) => box.actions.map((a) => `${a.deviceId}:${a.name}`);

test('B1 / S1b: the relay gate through the app: Open refused while allow_gates is off', async (t) => {
  const relay = {
    ...hc3Devices().find((d) => d.id === 31),
    id: 600,
    name: 'Portail relais',
    roomID: 223,
    parentId: 0,
    interfaces: ['zwave'],
    properties: { dead: false, value: false, deviceRole: 'Gate' },
    actions: { turnOn: 0, turnOff: 0, toggle: 0 },
  };
  const devices = [...hc3Devices(), relay];
  const off = await setup(t, { devices });
  const open = await off.press('Portail relais (Entrée)', 'open');
  assert.match(open.error, /turnOn refused, not sent: turn on the "allow_gates" option/);
  const contact = await off.press('Portail relais (Entrée)', 'relay');
  assert.equal(contact.success, false, 'the contact is read-only');
  assert.deepEqual(sent(off.box), []);
});

test('B1 / S1b: allowed, the relay gate pulses turnOn after checking it is alive', async (t) => {
  const relay = {
    ...hc3Devices().find((d) => d.id === 31),
    id: 600,
    name: 'Portail relais',
    roomID: 223,
    parentId: 0,
    properties: { dead: false, value: true, deviceRole: 'Gate' },
    actions: { turnOn: 0, turnOff: 0, toggle: 0 },
  };
  const { box, press } = await setup(t, {
    devices: [...hc3Devices(), relay],
    config: { ...BASE, allow_gates: true },
  });
  assert.equal((await press('Portail relais (Entrée)', 'open')).success, true);
  assert.deepEqual(sent(box), ['600:turnOn']);
  assert.equal(box.callsOf('device').length, 1, 'read again: alive');
});

// --- I1: a protective command cancels a guarded one still waiting -------------------

/** Holds the next device re-read until the test releases it. */
function holdReread(app) {
  const client = app.client;
  const read = client.device;
  const held = {};
  client.device = async (...args) => {
    client.device = read; // only the first one is held
    await new Promise((resolve) => {
      held.release = resolve;
    });
    return read(...args);
  };
  return held;
}

const ALLOWED = { ...BASE, allow_gates: true, allow_unlock: true, allow_valves: true };

test('I1 / S4: Open (allowed) then Stop during the re-read: stop sent at once, open cancelled', async (t) => {
  const { app, box, press } = await setup(t, { config: ALLOWED });
  const held = holdReread(app);
  const open = press('Portail (Entrée)', 'open');
  await settle();
  const stop = await press('Portail (Entrée)', 'stop');
  assert.equal(stop.success, true);
  assert.deepEqual(sent(box), ['250:stop'], 'the stop did not wait');
  held.release();
  const opened = await open;
  assert.equal(opened.success, false);
  assert.match(opened.error, /open cancelled by a later Stop \/ Close \/ Lock, not sent/);
  assert.deepEqual(sent(box), ['250:stop']);
});

test('I1 / S5: Open (allowed) then Close during the re-read: open cancelled', async (t) => {
  const { app, box, press } = await setup(t, { config: ALLOWED });
  const held = holdReread(app);
  const open = press('Portail (Entrée)', 'open');
  await settle();
  const close = await press('Portail (Entrée)', 'close');
  assert.equal(close.success, true);
  held.release();
  assert.match((await open).error, /cancelled by a later/);
  assert.deepEqual(sent(box), ['250:close']);
});

test('I1 / S5b: Unlock (allowed) then Lock during the re-read: unlock cancelled', async (t) => {
  const { app, box, press } = await setup(t, { config: ALLOWED });
  const held = holdReread(app);
  const unlock = press('Serrure (Entrée)', 'lock', 0);
  await settle();
  assert.equal((await press('Serrure (Entrée)', 'lock', 1)).success, true);
  held.release();
  assert.match((await unlock).error, /unsecure cancelled by a later/);
  assert.deepEqual(sent(box), ['90:secure']);

  // A later unlock is not cancelled by the old lock.
  assert.equal((await press('Serrure (Entrée)', 'lock', 0)).success, true);
  assert.deepEqual(sent(box), ['90:secure', '90:unsecure']);
});

// --- I3: locks before the shutters and the type table --------------------------------

test('I3 / S3: secure / unsecure or a lock type is a lock, before the switch table', () => {
  const d = dev({
    type: 'com.fibaro.binarySwitch',
    baseType: 'com.fibaro.actor',
    actions: ['turnOn', 'turnOff', 'secure', 'unsecure'],
    properties: { value: true },
  });
  assert.equal(roleOf(d), 'lock');
  assert.deepEqual(specs(mapDevice(d)), ['lock lock/binary']);
  assert.equal(roleOf(dev({ type: 'com.acme.thing', actions: ['secure', 'turnOn'] })), 'lock');
  assert.equal(roleOf(dev({ type: 'com.acme.smartLock', actions: [] })), 'lock');
  assert.equal(roleOf(dev({ type: 'com.acme.clockSensor', actions: [] })), undefined);
});

// --- I4: valves ------------------------------------------------------------------------

const VALVE = {
  id: 700,
  name: 'Vanne eau',
  roomID: 221,
  type: 'com.fibaro.binarySwitch',
  baseType: 'com.fibaro.actor',
  enabled: true,
  visible: true,
  interfaces: ['zwave'],
  properties: { dead: false, value: true, deviceRole: 'Valve' },
  actions: { turnOn: 0, turnOff: 0, toggle: 0 },
};

test('I4: a valve is never a switch: its state and Open / Close, both guarded', () => {
  const valve = buildInventory({ devices: [VALVE], rooms: ROOMS }).devices[0];
  assert.equal(roleOf(valve), 'valve');
  assert.equal(roleOf(dev({ type: 'com.acme.waterValve', actions: ['open', 'close'] })), 'valve');
  const m = mapDevice(valve);
  assert.deepEqual(specs(m), ['valve unknown/unknown ro', 'open button/push', 'close button/push']);
  const [open] = m.writers.open(1);
  const [close] = m.writers.close(1);
  assert.deepEqual([open.name, open.guard], ['turnOn', GUARDS.VALVES]);
  assert.deepEqual([close.name, close.guard], ['turnOff', GUARDS.VALVES]);
  assert.equal(close.protective, undefined, 'closing a valve cuts the water: not protective');
  assert.equal(open.decide({ value: false }), 'send');
  assert.equal(open.decide({ value: true }), 'skip');
  assert.equal(close.decide({ value: 'true' }), 'send');
  assert.throws(() => close.decide({}), /valve state unknown/);

  // Created as a switch by 0.1.1: the on/off feature is kept read-only (its
  // history stays), only Open and Close drive the valve.
  const legacy = mapDevice(valve, undefined, new Set(['binary']));
  const binary = legacy.features.find((f) => f.key === 'binary');
  assert.deepEqual([binary.category, binary.type, binary.read_only], [C.SWITCH, 'binary', true]);
  assert.equal(legacy.writers.binary, undefined);
  assert.equal(legacy.readers.find((r) => r.key === 'binary').read({ value: true }), 1);
});

test('I5 / S12: the 0.1.1 on/off of a valve cannot be controlled, even with allow_valves', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  const box = fakeFibaro({ devices: [VALVE] });
  const gladys = createFakeGladys({ config: { ...BASE, allow_valves: true } });
  const ext = 'ext:test-integration:fibaro:700';
  const created = [{ external_id: ext, features: [{ external_id: `${ext}:binary` }] }];
  gladys.devices = created;
  gladys.getDevices = async () => created;
  const app = new FibaroApp({
    gladys,
    connect: box.connect,
    now: () => Date.now(),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  t.mock.timers.tick(0);
  await settle();
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === ext);
  assert.deepEqual(
    device.features.map((f) => `${f.external_id.split(':').at(-1)} ro=${f.read_only}`),
    ['valve ro=true', 'open ro=false', 'close ro=false', 'binary ro=true'],
    'nothing lost',
  );
  await assert.rejects(
    app.setValue({}, { external_id: `${ext}:binary` }, 0),
    /cannot be controlled/,
  );
  assert.deepEqual(box.actions, [], 'an everything off never reaches the valve');
});

test('S14: a thermostatic head whose type has the word valve is a thermostat', () => {
  const d = dev({
    type: 'com.acme.thermostaticValve',
    baseType: 'com.fibaro.hvacSystemHeat',
    actions: ['setHeatingThermostatSetpoint', 'setThermostatMode'],
    properties: { heatingThermostatSetpoint: 20, thermostatMode: 'Heat' },
  });
  assert.equal(roleOf(d), 'thermostat');
});

test('I4: through the app, valve commands are refused while allow_valves is off', async (t) => {
  const devices = [...hc3Devices(), VALVE];
  const off = await setup(t, { devices });
  for (const key of ['open', 'close']) {
    const ack = await off.press('Vanne eau (Cuisine)', key);
    assert.match(ack.error, /refused, not sent: turn on the "allow_valves" option/);
  }
  assert.deepEqual(sent(off.box), []);
});

test('I4: allowed, a valve closes after reading its state again', async (t) => {
  const { box, press } = await setup(t, {
    devices: [...hc3Devices(), VALVE],
    config: { ...BASE, allow_valves: true },
  });
  assert.equal((await press('Vanne eau (Cuisine)', 'close')).success, true);
  assert.deepEqual(sent(box), ['700:turnOff']);
});

// --- Minor points ---------------------------------------------------------------------

test('M1 / S7: whole words only: outdoor, indoor, aggregate are not doors or gates', () => {
  assert.deepEqual(typeWords('com.acme.garageDoorOpener'), [
    'com',
    'acme',
    'garage',
    'door',
    'opener',
  ]);
  for (const type of ['com.acme.outdoorLight', 'com.acme.indoorUnit', 'com.acme.aggregateMeter']) {
    const d = dev({
      type,
      baseType: 'com.fibaro.multilevelSwitch',
      actions: ['turnOn', 'turnOff', 'setValue'],
      properties: { value: 50 },
    });
    assert.equal(isGate(d), false, type);
    assert.equal(roleOf(d), 'dimmer', type);
  }
  assert.equal(isGate(dev({ type: 'com.fibaro.doorSensor' })), false);
  assert.equal(isGate(dev({ type: 'com.acme.door' })), true);
});

test('M2 / S6: an HC2 gate sends "true" / "false" strings', () => {
  assert.equal(gateStateOf({ value: 'true' }), 'open');
  assert.equal(gateStateOf({ value: 'false' }), 'closed');
  assert.equal(gateStateOf({ value: 'Unknown' }), undefined);
  const d = dev({
    type: 'com.fibaro.barrier',
    actions: ['open', 'close'],
    properties: { value: 'false', dead: 'false' },
  });
  const [open] = mapDevice(d).writers.open(1);
  assert.equal(open.decide({ value: 'false', dead: 'false' }), 'send');
  assert.equal(open.decide({ value: 'true', dead: 'false' }), 'skip');
  assert.throws(() => open.decide({ value: 'false', dead: 'true' }), /dead/);
});

test('M3 / S9: nothing skipped unless clearly open (open, true, 95 % and more)', () => {
  assert.equal(gateStateOf({ value: 50 }), 'partial');
  assert.equal(gateStateOf({ value: 95 }), 'open');
  assert.equal(gateStateOf({ value: 5 }), 'closed');
  const gate = dev({
    type: 'com.fibaro.barrier',
    actions: ['open', 'close', 'setValue'],
    properties: { value: 50 },
  });
  assert.equal(mapDevice(gate).writers.open(1)[0].decide({ value: 50 }), 'send', 'half open');
  // 0.1.3 (issue #4): the legacy position / state of a gate only close or
  // stop until "Update"; every other value is refused, nothing sent.
  const fgr = dev({
    type: 'com.fibaro.FGR223',
    baseType: 'com.fibaro.rollerShutter',
    actions: ['open', 'close', 'stop', 'setValue'],
    properties: { value: 99, deviceRole: 'Gate' },
  });
  const m = mapDevice(fgr, undefined, new Set(['position', 'state']));
  assert.ok(!m.features.some((f) => f.key === 'position' || f.key === 'state'), 'not offered');
  assert.deepEqual(m.writers.position(0), [{ name: 'close', args: [], protective: true }]);
  assert.throws(() => m.writers.position(30), /became a gate/);
  assert.throws(() => m.writers.state(1), /became a gate/);
});

test('M4 / S11: no position for a relay with a blinds role (a boolean value)', () => {
  const d = dev({
    type: 'com.fibaro.binarySwitch',
    baseType: 'com.fibaro.actor',
    actions: ['turnOn', 'turnOff', 'toggle'],
    properties: { value: true, deviceRole: 'BlindsWithoutPositioning' },
  });
  assert.equal(roleOf(d), 'cover');
  assert.deepEqual(mapDevice(d).features, [], 'nothing to drive it with: left out, never a switch');
  const hc2 = dev({
    type: 'com.fibaro.FGR221',
    actions: ['open', 'close', 'setValue'],
    properties: { value: 'false' },
  });
  assert.equal(
    mapDevice(hc2).features.some((f) => f.key === 'position'),
    false,
  );
});

test('M5 / S10: an action still queued in the HTTP agent when it times out was not sent', async (t) => {
  const received = [];
  const server = http.createServer((req, res) => {
    received.push(req.url);
    if (req.url.includes('/hold')) {
      setTimeout(() => res.end('{}'), 400);
      return;
    }
    res.end('');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const client = createClient({
    origin: `http://127.0.0.1:${server.address().port}`,
    username: 'u',
    password: 'p',
    verifyCertificate: true,
  });
  t.after(() => client.close());
  // The agent has 4 sockets: all busy.
  const holds = [1, 2, 3, 4].map((i) => client.get(`/hold${i}`, { timeout: 5000 }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const err = await client
    .callAction({ api: 5, deviceId: 7, name: 'open', args: [] }, { timeout: 100 })
    .then(
      () => null,
      (e) => e,
    );
  await Promise.all(holds);
  assert.equal(err.kind, 'timeout');
  assert.equal(err.sent, false);
  assert.equal(
    received.some((u) => u.includes('/action/open')),
    false,
  );

  // Written, then no answer: sent.
  const slow = await client.get('/hold5', { timeout: 100 }).then(
    () => null,
    (e) => e,
  );
  assert.deepEqual([slow.kind, slow.sent], ['timeout', true]);
});

test('M5: the app says "not sent" for a request that never left, "sent" for one that did', async (t) => {
  const { box, press } = await setup(t, { config: ALLOWED });
  box.actionErrors['250:close'] = new FibaroError('timeout', 'no answer within 3 s', {
    sent: false,
  });
  const close = await press('Portail (Entrée)', 'close');
  assert.match(close.error, /^close not sent to device 250/);
  box.actionErrors['250:stop'] = new FibaroError('network', 'connection refused', { sent: false });
  assert.match((await press('Portail (Entrée)', 'stop')).error, /^stop not sent/);
  box.actionErrors['250:stop'] = new FibaroError('network', 'connection reset', { sent: true });
  assert.match(
    (await press('Portail (Entrée)', 'stop')).error,
    /^stop sent to device 250, without confirmation/,
  );
});

test('M6: a skipped command is logged', async (t) => {
  const { box, press, lines } = await setup(t, { config: ALLOWED });
  box.devices.find((d) => d.id === 250).properties.value = 'Open';
  assert.equal((await press('Portail (Entrée)', 'open')).success, true);
  assert.deepEqual(sent(box), []);
  assert.ok(lines.some((l) => /open not sent to device 250: the box reports it already/.test(l)));
});

test('M7: only shutters, gates, locks and valves go through the command queue', () => {
  const inventory = buildInventory({
    devices: [...shutterDevices(), ...hc3Devices()],
    rooms: ROOMS,
  });
  const model = buildModel(
    (id) => ({ device: `d:${id}`, feature: (k) => `d:${id}:${k}` }),
    inventory,
  );
  const serialized = (id) => model.writers.get(id).serialized;
  assert.equal(serialized('d:31:binary'), false, 'a plug');
  assert.equal(serialized('d:41:brightness'), false, 'a light');
  assert.equal(serialized('d:201:position'), true, 'a shutter');
  assert.equal(serialized('d:250:open'), true, 'a gate');
  assert.equal(serialized('d:90:lock'), true, 'a lock');
});

test('M8 / I2: the manifest and the docs say what is off and what the update does', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
  );
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.match(
    fields.intro.description.en,
    /Opening gates and doors, unlocking and valve commands are off/,
  );
  assert.match(
    fields.intro.description.fr,
    /L'ouverture des portails et portes, le déverrouillage et les vannes sont désactivés/,
  );
  for (const key of ['allow_gates', 'allow_unlock', 'allow_valves']) {
    assert.equal(fields[key].default, false, key);
  }
  assert.match(fields.allow_gates.description.en, /set its role to Gate or Garage door in the box/);
  const fr = readFileSync(new URL('../docs/fr.md', import.meta.url), 'utf8');
  const en = readFileSync(new URL('../docs/en.md', import.meta.url), 'utf8');
  assert.match(fr, /historique\s+est\s+supprimé/);
  assert.match(en, /their\s+history\s+is\s+deleted/);
  assert.match(
    fr,
    /rôle\s+Portail\s+\(`Gate`\)\s+ou\s+Porte de garage\s+\(`GarageDoor`\)\s+dans la box/,
  );
  assert.match(en, /Gate \(`Gate`\) or Garage\s+door \(`GarageDoor`\)\s+role\s+in the box/);
  // 0.1.3 (issue #4): "Update" after a gate or a lamp relay changes category.
  assert.match(fr, /supprime ces fonctions volet avec leur historique/);
  assert.match(fr, /seulement le \*\*fermer ou\s+l'arrêter\*\*/);
  assert.match(en, /can only \*\*close or stop\*\* it/);
  assert.match(fr, /garde son\s+historique/);
  assert.match(en, /keeps its history/);
  assert.match(en, /"Update"\s+deletes them with their history/);
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(changelog, /history\s+is\s+deleted/);
  assert.match(changelog, /refused\s+while\s+the\s+option\s+is\s+off/);
});
