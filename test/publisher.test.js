import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { StatePublisher } from '../src/publisher.js';

const silent = { warn() {}, debug() {}, info() {}, error() {} };

function publisher({ budget, interval = 0, throttled = [] } = {}) {
  let now = 1_000_000;
  const gladys = createFakeGladys();
  const p = new StatePublisher({ gladys, logger: silent, now: () => now, budget });
  p.configure({ intervalSeconds: interval, throttled: new Set(throttled) });
  return { gladys, p, advance: (ms) => (now += ms) };
}

const id = (n) => `ext:test-integration:fibaro:31:${n}`;

test('only the last value of a feature is sent, unchanged ones are skipped', async () => {
  const { gladys, p } = publisher();
  p.push(id('binary'), 1);
  p.push(id('binary'), 0);
  p.push(id('power'), 12.5);
  assert.equal(await p.flush(), 2);
  p.push(id('binary'), 0);
  assert.equal(await p.flush(), 0, 'publishChangedStates drops an unchanged value');
  assert.deepEqual(
    gladys.fake.states.map((s) => [s.device_feature_external_id, s.state]),
    [
      [id('binary'), 0],
      [id('power'), 12.5],
    ],
  );
});

test('two identical button presses are two states, in order', async () => {
  const { gladys, p } = publisher();
  p.pushEvent(id('button-1'), 1);
  p.pushEvent(id('button-1'), 1);
  p.pushEvent(id('button-1'), 2);
  assert.equal(await p.flush(), 3);
  assert.deepEqual(
    gladys.fake.states.map((s) => s.state),
    [1, 1, 2],
  );
});

test('the per-minute budget holds the rest for later', async () => {
  const { gladys, p, advance } = publisher({ budget: 3 });
  p.pushEvent(id('button-1'), 1);
  for (let i = 0; i < 4; i += 1) {
    p.push(id(`s${i}`), i);
  }
  assert.equal(await p.flush(), 3);
  assert.equal(await p.flush(), 0, 'budget spent');
  advance(60_000);
  assert.equal(await p.flush(), 2);
  assert.equal(gladys.fake.states.length, 5);
});

test('throttled features wait for the interval, the others do not', async () => {
  const { gladys, p, advance } = publisher({ interval: 10, throttled: [id('power')] });
  p.push(id('power'), 1);
  p.push(id('binary'), 1);
  await p.flush();
  p.push(id('power'), 2);
  p.push(id('binary'), 0);
  await p.flush();
  assert.equal(gladys.fake.lastState(id('power')), 1);
  assert.equal(gladys.fake.lastState(id('binary')), 0);
  advance(10_000);
  await p.flush();
  assert.equal(gladys.fake.lastState(id('power')), 2);
});

test('a failed request keeps the values, a deleted device drops them', async (t) => {
  const { gladys, p } = publisher();
  t.mock.method(gladys, 'publishChangedStates', async () => {
    throw new Error('429');
  });
  t.mock.method(gladys, 'publishStates', async () => {
    throw new Error('429');
  });
  p.push(id('binary'), 1);
  p.pushEvent(id('button-1'), 1);
  await assert.rejects(p.flush(), /429/);
  assert.equal(p.events.length, 1);
  p.events = [];
  await assert.rejects(p.flush(), /429/);
  assert.equal(p.pending.get(id('binary')), 1);
  p.pushEvent(id('button-1'), 1);
  p.forget('ext:test-integration:fibaro:31');
  assert.equal(p.pending.size, 0);
  assert.equal(p.events.length, 0);
});
