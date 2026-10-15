// The REST client, with a fake transport: no network in the tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMINGS } from '../src/constants.js';
import { FibaroError, createClient, networkError, parseAnswer } from '../src/fibaro.js';

function client(answers = {}) {
  const requests = [];
  const c = createClient({
    origin: 'http://192.168.1.50',
    username: 'admin',
    password: 'secret',
    verifyCertificate: false,
    request: async (url, options) => {
      requests.push({ url, ...options, agent: undefined });
      const path = new URL(url).pathname;
      return answers[path] ?? { status: 200, body: '[]' };
    },
  });
  return { c, requests };
}

const kindOf = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof FibaroError);
    return `${err.kind}: ${err.message}`;
  }
  return 'resolved';
};

test('basic auth on every request, the API under /api', async () => {
  const { c, requests } = client({
    '/api/settings/info': { status: 200, body: '{"serialNumber":"HC3-1"}' },
  });
  assert.deepEqual(await c.info(), { serialNumber: 'HC3-1' });
  assert.deepEqual(requests[0], {
    url: 'http://192.168.1.50/api/settings/info',
    method: 'GET',
    headers: { Authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` },
    body: undefined,
    timeout: TIMINGS.requestTimeout,
    verifyCertificate: false,
    agent: undefined,
  });
  c.close();
});

test('the long-poll has its own timeout and the cursor in the query', async () => {
  const { c, requests } = client({
    '/api/refreshStates': { status: 200, body: '{"last":42,"changes":[]}' },
  });
  assert.deepEqual(await c.refreshStates(41), { last: 42, changes: [] });
  assert.equal(requests[0].url, 'http://192.168.1.50/api/refreshStates?last=41');
  assert.equal(requests[0].timeout, TIMINGS.longPollTimeout);
  const bad = client({ '/api/refreshStates': { status: 200, body: '[]' } });
  await assert.rejects(bad.c.refreshStates(0), { kind: 'format' });
});

test('actions: POST on API v5, callAction on API v4', async () => {
  const { c, requests } = client({ '/api/devices/41/action/setValue': { status: 202, body: '' } });
  assert.equal(
    await c.callAction({ api: 5, deviceId: 41, name: 'setValue', args: [50] }),
    undefined,
  );
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, 'http://192.168.1.50/api/devices/41/action/setValue');
  assert.equal(requests[0].body, '{"args":[50]}');

  await c.callAction({ api: 4, deviceId: 27, name: 'setColor', args: ['255', '0', '10', '0'] });
  assert.equal(requests[1].method, 'GET');
  assert.equal(
    requests[1].url,
    'http://192.168.1.50/api/callAction?deviceID=27&name=setColor&arg1=255&arg2=0&arg3=10&arg4=0',
  );
  await c.callAction({ api: 4, deviceId: 13, name: 'turnOn' });
  assert.equal(requests[2].url, 'http://192.168.1.50/api/callAction?deviceID=13&name=turnOn');
});

test('scenes: execute on API v5, action/start on API v4', async () => {
  const { c, requests } = client();
  await c.runScene({ api: 5, sceneId: 10 });
  await c.runScene({ api: 4, sceneId: 2 });
  assert.deepEqual(
    requests.map((r) => [r.method, r.url, r.body]),
    [
      ['POST', 'http://192.168.1.50/api/scenes/10/execute', '{}'],
      ['POST', 'http://192.168.1.50/api/scenes/2/action/start', undefined],
    ],
  );
});

test('what each HTTP answer means', async () => {
  assert.equal(
    kindOf(() => parseAnswer({ status: 401, body: '' })),
    'auth: user name or password refused',
  );
  assert.equal(
    kindOf(() => parseAnswer({ status: 403, body: '' })),
    'forbidden: access refused',
  );
  assert.equal(
    kindOf(() => parseAnswer({ status: 404, body: '' })),
    'notfound: not found',
  );
  assert.equal(
    kindOf(() =>
      parseAnswer({ status: 301, location: 'https://192.168.1.50/api/devices', body: '' }),
    ),
    'redirect: redirected to https://192.168.1.50',
  );
  assert.equal(
    kindOf(() => parseAnswer({ status: 503, body: '' })),
    'http: HTTP 503',
  );
  assert.equal(
    kindOf(() => parseAnswer({ status: 200, body: '<html>' })),
    'format: not a Fibaro API answer',
  );
  assert.equal(
    kindOf(() => parseAnswer({ status: 200, body: '' })),
    'format: empty answer',
  );
  assert.equal(parseAnswer({ status: 202, body: 'Accepted' }, { json: false }), undefined);
  assert.deepEqual(parseAnswer({ status: 202, body: '{"message":"Accepted"}' }, { json: false }), {
    message: 'Accepted',
  });

  const { c } = client({ '/api/devices': { status: 200, body: '{"error":"x"}' } });
  await assert.rejects(c.devices(), {
    kind: 'format',
    message: 'unexpected answer for /api/devices',
  });
});

test('socket errors become readable reasons', () => {
  assert.deepEqual(
    [networkError({ code: 'ECONNREFUSED' })].map((e) => [e.kind, e.message]),
    [['network', 'connection refused']],
  );
  const cert = networkError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  assert.equal(cert.kind, 'certificate');
  const same = new FibaroError('timeout', 'no answer within 15 s');
  assert.equal(networkError(same), same);
});
