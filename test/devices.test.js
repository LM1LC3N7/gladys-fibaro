import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildModel, deviceName } from '../src/devices.js';
import { buildInventory } from '../src/inventory.js';
import { ROOMS, SECTIONS, hc3Devices } from './fixtures/fibaro.js';

const gladys = createFakeGladys();
const idsOf = (id) => gladys.externalIds('fibaro', id);
const inventory = buildInventory({ devices: hc3Devices(), rooms: ROOMS, sections: SECTIONS });
const DEVICE = (id) => `ext:test-integration:fibaro:${id}`;

test('one Gladys device per Fibaro device, named after its room', () => {
  const model = buildModel(idsOf, inventory, { unit: 'C' });
  assert.equal(model.devices.length, 19);
  assert.deepEqual(model.counts, { read: 20, empty: 1, overflow: 0 });
  const plug = model.devices.find((d) => d.external_id === DEVICE(31));
  assert.equal(plug.name, 'Prise TV (Salon)');
  assert.equal(plug.should_poll, false);
  assert.deepEqual(plug.params, [
    { name: 'FIBARO_ID', value: '31' },
    { name: 'FIBARO_TYPE', value: 'com.fibaro.binarySwitch' },
    { name: 'FIBARO_ROOM', value: 'Salon' },
    { name: 'FIBARO_SECTION', value: 'Rez-de-chaussée' },
  ]);
  assert.deepEqual(
    plug.features.map((f) => f.external_id),
    ['binary', 'power', 'energy'].map((k) => `${DEVICE(31)}:${k}`),
  );
  assert.equal(deviceName({ name: 'Humidité' }), 'Humidité');
});

test('the routing tables: readers per Fibaro id, writers per feature, buttons', () => {
  const model = buildModel(idsOf, inventory);
  const readers = model.readers.get('31');
  assert.deepEqual(
    readers.map((r) => [r.featureId, [...r.props]]),
    [
      [`${DEVICE(31)}:binary`, ['value']],
      [`${DEVICE(31)}:power`, ['power']],
      [`${DEVICE(31)}:energy`, ['energy']],
    ],
  );
  assert.equal(model.writers.get(`${DEVICE(41)}:brightness`).fibaroId, '41');
  assert.ok(model.throttled.has(`${DEVICE(71)}:temperature`));
  assert.ok(model.optimistic.has(`${DEVICE(60)}:state`));
  assert.deepEqual(model.buttons.get('42'), {
    deviceId: DEVICE(42),
    keys: new Map([
      [1, `${DEVICE(42)}:button-1`],
      [2, `${DEVICE(42)}:button-2`],
    ]),
    any: undefined,
  });
  assert.equal(model.deviceIds.get('95'), DEVICE(95));
  assert.equal(model.deviceIds.has('106'), false, 'nothing to offer');
});

test('the discovered devices pass the checks of the Gladys host API', async () => {
  const fake = createFakeGladys();
  const model = buildModel((id) => fake.externalIds('fibaro', id), inventory);
  await fake.publishDiscoveredDevices(model.devices);
  assert.equal(fake.fake.discoveredDevices.length, 19);
});
