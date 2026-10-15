import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseBoxUrl } from '../src/config.js';

test('the address of the box: an IP, an http(s) URL, a page of its interface', () => {
  assert.deepEqual(parseBoxUrl('192.168.1.50'), { origin: 'http://192.168.1.50' });
  assert.deepEqual(parseBoxUrl(' https://192.168.1.50/ '), { origin: 'https://192.168.1.50' });
  assert.deepEqual(parseBoxUrl('http://hc2.lan:8080/fibaro/en/home/index.html'), {
    origin: 'http://hc2.lan:8080',
  });
  assert.deepEqual(parseBoxUrl('http://192.168.1.50/api'), { origin: 'http://192.168.1.50' });
  assert.deepEqual(parseBoxUrl(''), { error: 'empty' });
  assert.deepEqual(parseBoxUrl('ftp://box'), { error: 'invalid' });
  assert.deepEqual(parseBoxUrl('http://'), { error: 'invalid' });
  assert.deepEqual(parseBoxUrl('http://admin:pwd@192.168.1.50'), { error: 'credentials' });
});

test('defaults, bounds and what is missing', () => {
  const config = normalizeConfig({
    host: '192.168.1.50',
    username: ' admin ',
    password: 'p',
    sensor_interval: 9999,
  });
  assert.deepEqual(config, {
    origin: 'http://192.168.1.50',
    error: undefined,
    username: 'admin',
    password: 'p',
    verifyCertificate: true,
    includePlugins: false,
    sensorInterval: 300,
  });
  assert.equal(normalizeConfig({ ...DEFAULTS }).error, 'empty');
  assert.equal(normalizeConfig({ host: 'box' }).error, 'no-user');
  assert.equal(normalizeConfig({ host: 'box', username: 'admin' }).error, 'no-password');
  const custom = normalizeConfig({
    host: 'https://box',
    username: 'a',
    password: 'b',
    verify_certificate: false,
    include_plugins: true,
    sensor_interval: null,
  });
  assert.equal(custom.verifyCertificate, false);
  assert.equal(custom.includePlugins, true);
  assert.equal(custom.sensorInterval, DEFAULTS.sensor_interval);
});
