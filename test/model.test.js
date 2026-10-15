import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectModel, looksLikeInfo } from '../src/model.js';
import { INFO_HC3, INFO_YUBII, pyfibaro } from './fixtures/fibaro.js';
import { parseColor, toBool, toList, toNumber } from '../src/values.js';

test('the model and API version of each box', () => {
  assert.deepEqual(detectModel(pyfibaro('info')), {
    name: 'Home Center 2',
    api: 4,
    serial: 'HC2-011111',
    version: '4.630',
    unit: 'C',
  });
  assert.deepEqual(detectModel(INFO_HC3), {
    name: 'Home Center 3',
    api: 5,
    serial: 'HC3-00012345',
    version: '5.150.25',
    unit: 'C',
  });
  assert.equal(detectModel(INFO_YUBII).name, 'Yubii Home');
  // An older firmware without `platform`: the serial number decides, longest prefix first.
  assert.equal(
    detectModel({ serialNumber: 'HC3L-00011111', softVersion: '5.100.1' }).name,
    'Home Center 3 Lite',
  );
  assert.equal(detectModel({ serialNumber: 'HCL-005555', softVersion: '4.600' }).api, 4);
  assert.equal(detectModel({ serialNumber: 'ZB-001', softVersion: '5.1' }).name, 'Z-Box Hub');
  assert.deepEqual(
    detectModel({ serialNumber: 'XYZ-1', softVersion: '4.1', temperatureUnit: 'F' }),
    {
      name: 'Home Center',
      api: 4,
      serial: 'XYZ-1',
      version: '4.1',
      unit: 'F',
    },
  );
  assert.equal(detectModel({}).api, 5);
  assert.equal(looksLikeInfo(pyfibaro('info')), true);
  assert.equal(looksLikeInfo({ status: 'ok' }), false);
  assert.equal(looksLikeInfo('<html>'), false);
});

test('HC2 strings and HC3 JSON types read alike', () => {
  assert.equal(toNumber('21,50'), 21.5);
  assert.equal(toNumber({ value: '19.0', unit: 'C' }), 19);
  assert.equal(toNumber(''), undefined);
  assert.equal(toNumber('abc'), undefined);
  assert.equal(toBool('true'), true);
  assert.equal(toBool(false), false);
  assert.equal(toBool('0'), false);
  assert.equal(toBool(255), true);
  assert.equal(toBool('maybe'), undefined);
  assert.deepEqual(toList('0,1, 2'), ['0', '1', '2']);
  assert.deepEqual(toList('[{"keyId":1}]'), [{ keyId: 1 }]);
  assert.deepEqual(toList(undefined), []);
  assert.deepEqual(parseColor('255,128,0,10'), [255, 128, 0, 10]);
  assert.equal(parseColor('255,128,0'), undefined);
});
