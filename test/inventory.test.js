import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInventory, centralScene } from '../src/inventory.js';
import { ROOMS, SECTIONS, hc3Devices, pyfibaro } from './fixtures/fibaro.js';

const names = (inventory) => inventory.devices.map((d) => `${d.id} ${d.name}`);

test('a real HC2: users and controllers out, the Z-Wave node hidden, its endpoint kept', () => {
  const inventory = buildInventory({ devices: pyfibaro('device'), rooms: pyfibaro('room') });
  assert.deepEqual(names(inventory), ['13 Hifi']);
  assert.deepEqual(inventory.skipped, { disabled: 0, hidden: 1, plugins: 0 });
  const [hifi] = inventory.devices;
  assert.equal(hifi.roomName, 'Wohnen');
  assert.equal(hifi.parentId, '12');
  assert.deepEqual(hifi.actions.slice(0, 3), ['abortUpdate', 'reconfigure', 'reset']);
  assert.equal(hifi.properties.value, 'true', 'the values stay raw: the mapping reads them');
});

test('a real HC3: nothing but system devices and a weather plugin', () => {
  const inventory = buildInventory({ devices: pyfibaro('device-hc3') });
  assert.deepEqual(inventory.devices, []);
  assert.deepEqual(inventory.skipped, { disabled: 0, hidden: 0, plugins: 1 });
});

test('the hidden central-scene endpoint of a switch is kept, named after its device', () => {
  for (const fixture of ['device-scene-support', 'device-scene-support-hc3']) {
    const inventory = buildInventory({ devices: pyfibaro(fixture) });
    assert.deepEqual(names(inventory), ['387 Licht Roman Main'], fixture);
    assert.equal(inventory.skipped.hidden, 2, 'the node and the hidden light');
  }
  const [hc2] = buildInventory({ devices: pyfibaro('device-scene-support') }).devices;
  assert.deepEqual(
    centralScene(hc2.properties).map((k) => k.keyId),
    [1, 2, 3, 4],
    'an HC2 serializes the keys as a JSON string',
  );
});

test('plugins and Quick Apps only when asked', () => {
  const devices = pyfibaro('device-netatmo-plugin');
  assert.equal(buildInventory({ devices }).devices.length, 0);
  const inventory = buildInventory({ devices, includePlugins: true });
  assert.equal(inventory.devices.length, 18);
  assert.equal(inventory.skipped.hidden, 2, 'the hidden station parents');
});

test('rooms and sections name the devices', () => {
  const inventory = buildInventory({ devices: hc3Devices(), rooms: ROOMS, sections: SECTIONS });
  assert.equal(inventory.total, 27);
  assert.deepEqual(inventory.skipped, { disabled: 1, hidden: 4, plugins: 2 });
  assert.equal(inventory.devices.length, 20);
  const byId = new Map(inventory.devices.map((d) => [d.id, d]));
  assert.deepEqual([byId.get('70').roomName, byId.get('70').sectionName], ['Chambre', 'Étage']);
  assert.equal(byId.get('42').name, 'Variateur salon');
  assert.equal(byId.get('85').roomName, undefined);
});
