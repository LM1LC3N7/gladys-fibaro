// Answers of Fibaro boxes, for the tests (no network).
//
// - test/fixtures/pyfibaro/*.json: verbatim copies of the pyfibaro test
//   fixtures (dumps of real HC2 and HC3 boxes), MIT licence, see the LICENSE
//   file next to them.
// - The rest is written here after the HC3 API documentation (the Swagger
//   files served by every HC3 at /assets/docs/hc/), the Home Assistant
//   `fibaro` tests and the pyfibaro fixtures: the device types they lack
//   (dimmer, RGBW, shutters, thermostats, lock, remote, meters).

import { readFileSync } from 'node:fs';

export const pyfibaro = (name) =>
  JSON.parse(readFileSync(new URL(`./pyfibaro/${name}.json`, import.meta.url), 'utf8'));

export const USER = 'admin';
export const PASSWORD = 'secret-password';

export const INFO_HC3 = {
  serialNumber: 'HC3-00012345',
  hcName: 'HC3-00012345',
  mac: 'ac:17:02:00:00:01',
  platform: 'HC3',
  oemId: 'HC3',
  softVersion: '5.150.25',
  currentVersion: { version: '5.150.25', type: 'stable' },
  zwaveEngineVersion: '2.0',
  temperatureUnit: 'C',
  defaultRoomId: 219,
  isSlave: false,
};

export const INFO_YUBII = {
  ...INFO_HC3,
  serialNumber: 'YH-00054321',
  hcName: 'Yubii',
  platform: 'YH',
  oemId: 'YH',
  softVersion: '5.160.12',
  currentVersion: { version: '5.160.12', type: 'stable' },
};

export const SECTIONS = [
  { id: 1, name: 'Rez-de-chaussée', sortOrder: 1 },
  { id: 2, name: 'Étage', sortOrder: 2 },
];

export const ROOMS = [
  { id: 219, name: 'Default Room', sectionID: 1, isDefault: true, visible: true },
  { id: 220, name: 'Salon', sectionID: 1, isDefault: false, visible: true },
  { id: 221, name: 'Cuisine', sectionID: 1, isDefault: false, visible: true },
  { id: 222, name: 'Chambre', sectionID: 2, isDefault: false, visible: true },
  { id: 223, name: 'Entrée', sectionID: 1, isDefault: false, visible: true },
];

/** A device of /api/devices, HC3 style (JSON types). */
const device = (id, name, type, baseType, o = {}) => ({
  id,
  name,
  roomID: o.room ?? 0,
  view: [],
  type,
  baseType,
  enabled: o.enabled ?? true,
  visible: o.visible ?? true,
  isPlugin: o.isPlugin ?? false,
  parentId: o.parent ?? 0,
  viewXml: false,
  hasUIView: true,
  configXml: false,
  interfaces: o.interfaces ?? ['zwave'],
  properties: { dead: false, deviceRole: 'Other', ...o.properties },
  actions: Object.fromEntries((o.actions ?? []).map((a) => [a, a.startsWith('set') ? 1 : 0])),
  created: 1_700_000_000,
  modified: 1_700_000_000,
  sortOrder: id,
});

const node = (id, name, room) =>
  device(id, name, 'com.fibaro.zwaveDevice', 'com.fibaro.device', {
    room,
    visible: false,
    parent: 1,
    actions: ['reconfigure', 'getParameter', 'setParameter'],
  });

const KEYS = ['Pressed', 'Released', 'HeldDown', 'Pressed2', 'Pressed3'];
const SWITCH_ACTIONS = ['turnOn', 'turnOff', 'toggle', 'reconfigure'];

export function hc3Devices() {
  return [
    device(1, 'zwave', 'com.fibaro.zwavePrimaryController', '', { visible: false, room: 219 }),
    device(2, 'admin', 'HC_user', 'com.fibaro.voipUser', { room: 219, interfaces: ['voip'] }),
    device(3, 'YR Weather', 'com.fibaro.yrWeather', 'com.fibaro.weather', {
      isPlugin: true,
      interfaces: [],
    }),
    // A wall plug.
    node(30, 'Prise TV', 220),
    device(31, 'Prise TV', 'com.fibaro.binarySwitch', 'com.fibaro.actor', {
      room: 220,
      parent: 30,
      interfaces: ['energy', 'power', 'zwave'],
      properties: { value: true, state: true, power: 85.3, energy: 12.5 },
      actions: SWITCH_ACTIONS,
    }),
    // A Dimmer 2 with its S1/S2 scene keys (the hidden endpoint 40.0.1).
    node(40, 'Variateur salon', 220),
    device(41, 'Lampe salon', 'com.fibaro.multilevelSwitch', 'com.fibaro.binarySwitch', {
      room: 220,
      parent: 40,
      interfaces: ['energy', 'levelChange', 'light', 'power', 'zwave'],
      properties: { value: 55, deviceRole: 'Light', isLight: true, power: 20.1, energy: 3.2 },
      actions: [...SWITCH_ACTIONS, 'setValue', 'startLevelIncrease', 'stopLevelChange'],
    }),
    device(42, '40.0.1', 'com.fibaro.remoteController', 'com.fibaro.actor', {
      room: 220,
      parent: 40,
      visible: false,
      interfaces: ['zwave', 'zwaveCentralScene'],
      properties: {
        centralSceneSupport: [
          { keyAttributes: KEYS, keyId: 1 },
          { keyAttributes: KEYS, keyId: 2 },
        ],
      },
      actions: ['reconfigure'],
    }),
    device(50, 'Ruban LED', 'com.fibaro.colorController', 'com.fibaro.actor', {
      room: 222,
      interfaces: ['colorComponents', 'levelChange', 'light', 'zwave'],
      properties: { value: 80, color: '255,128,0,0', lastColorSet: '255,128,0,0' },
      actions: [...SWITCH_ACTIONS, 'setValue', 'setColor', 'setW'],
    }),
    device(60, 'Volet salon', 'com.fibaro.rollerShutter', 'com.fibaro.baseShutter', {
      room: 220,
      interfaces: ['energy', 'power', 'zwave'],
      properties: { value: 99, power: 0, energy: 1.2 },
      actions: ['open', 'close', 'stop', 'setValue'],
    }),
    device(61, 'Store terrasse', 'com.fibaro.baseShutter', 'com.fibaro.actor', {
      room: 220,
      properties: { state: 'Unknown' },
      actions: ['open', 'close', 'stop'],
    }),
    // A thermostatic head and its temperature endpoint.
    node(69, 'Tête thermostatique', 222),
    device(70, 'Radiateur chambre', 'com.fibaro.hvacSystemHeat', 'com.fibaro.hvacSystem', {
      room: 222,
      parent: 69,
      interfaces: ['battery', 'zwave'],
      properties: {
        thermostatMode: 'Heat',
        supportedThermostatModes: ['Off', 'Heat', 'ManufacturerSpecific'],
        heatingThermostatSetpoint: 20,
        heatingThermostatSetpointFuture: 20,
        heatingThermostatSetpointCapabilitiesMin: 5,
        heatingThermostatSetpointCapabilitiesMax: 28,
        thermostatOperatingState: 'Heating',
        unit: 'C',
        batteryLevel: 80,
      },
      actions: ['setThermostatMode', 'setHeatingThermostatSetpoint'],
    }),
    device(
      71,
      'Température chambre',
      'com.fibaro.temperatureSensor',
      'com.fibaro.multilevelSensor',
      {
        room: 222,
        parent: 69,
        properties: { value: 19.5, unit: 'C' },
      },
    ),
    device(80, "Porte d'entrée", 'com.fibaro.doorSensor', 'com.fibaro.doorWindowSensor', {
      room: 223,
      interfaces: ['battery', 'fibaroAlarmArm', 'fibaroBreach', 'zwave'],
      properties: { value: false, batteryLevel: 90, armed: false },
      actions: ['setArmed', 'forceArm'],
    }),
    device(81, 'Mouvement couloir', 'com.fibaro.motionSensor', 'com.fibaro.securitySensor', {
      room: 223,
      interfaces: ['battery', 'fibaroBreach', 'zwave'],
      properties: { value: true, batteryLevel: 255 },
    }),
    device(82, 'Luminosité couloir', 'com.fibaro.lightSensor', 'com.fibaro.multilevelSensor', {
      room: 223,
      properties: { value: 120, unit: 'lux' },
    }),
    device(83, 'Fuite lave-linge', 'com.fibaro.floodSensor', 'com.fibaro.securitySensor', {
      room: 221,
      interfaces: ['battery', 'fibaroBreach', 'zwave'],
      properties: { value: false, batteryLevel: 100 },
    }),
    device(84, 'Détecteur fumée', 'com.fibaro.smokeSensor', 'com.fibaro.securitySensor', {
      room: 221,
      interfaces: ['battery', 'fibaroBreach', 'zwave'],
      properties: { value: false, batteryLevel: 95 },
    }),
    device(85, 'Humidité', 'com.fibaro.humiditySensor', 'com.fibaro.multilevelSensor', {
      properties: { value: 62, unit: '%' },
    }),
    device(90, 'Serrure', 'com.fibaro.doorLock', 'com.fibaro.actor', {
      room: 223,
      interfaces: ['battery', 'zwave'],
      properties: { value: true, secured: 255, batteryLevel: 70 },
      actions: ['secure', 'unsecure'],
    }),
    device(95, 'Télécommande', 'com.fibaro.remoteController', 'com.fibaro.actor', {
      room: 220,
      interfaces: ['battery', 'zwave', 'zwaveCentralScene'],
      properties: {
        centralSceneSupport: [1, 2, 3, 4, 5, 6].map((keyId) => ({ keyAttributes: KEYS, keyId })),
        batteryLevel: 100,
      },
    }),
    device(100, 'Ancien module', 'com.fibaro.binarySwitch', 'com.fibaro.actor', {
      room: 221,
      enabled: false,
      properties: { value: false },
      actions: SWITCH_ACTIONS,
    }),
    device(101, 'Lampe cachée', 'com.fibaro.binarySwitch', 'com.fibaro.actor', {
      room: 221,
      visible: false,
      properties: { value: false },
      actions: SWITCH_ACTIONS,
    }),
    device(102, 'QA Lampe', 'com.fibaro.binarySwitch', 'com.fibaro.actor', {
      room: 221,
      isPlugin: true,
      interfaces: ['quickApp'],
      properties: { value: false },
      actions: SWITCH_ACTIONS,
    }),
    device(103, 'Prise garage', 'com.fibaro.binarySwitch', 'com.fibaro.actor', {
      room: 221,
      properties: { value: false, dead: true, deadReason: 'NoResponse' },
      actions: SWITCH_ACTIONS,
    }),
    device(104, 'Compteur', 'com.fibaro.multilevelSensor', 'com.fibaro.sensor', {
      properties: { value: 1250, unit: 'W' },
    }),
    device(105, 'Énergie maison', 'com.fibaro.energyMeter', 'com.fibaro.sensor', {
      properties: { value: 3456.7, unit: 'kWh' },
    }),
    device(106, 'Module inconnu', 'com.fibaro.zwaveDevice', 'com.fibaro.device', {}),
  ];
}

/** HC2 devices the pyfibaro fixtures lack: every property is a string on an HC2. */
export function hc2Devices() {
  const strings = (props) =>
    Object.fromEntries(Object.entries(props).map(([k, v]) => [k, String(v)]));
  const hc2 = (id, name, type, baseType, o) => ({
    ...device(id, name, type, baseType, o),
    properties: strings({ dead: false, ...o.properties }),
  });
  return [
    ...pyfibaro('device'),
    hc2(25, 'Volet', 'com.fibaro.FGRM222', 'com.fibaro.FGR', {
      room: 4,
      interfaces: ['energy', 'power', 'zwave'],
      properties: { value: 50, power: '0.00', energy: '0.40' },
      actions: ['open', 'close', 'stop', 'setValue'],
    }),
    hc2(26, 'Radiateur', 'com.fibaro.thermostatDanfoss', 'com.fibaro.setpoint', {
      room: 5,
      interfaces: ['battery', 'zwave'],
      properties: {
        targetLevel: '21.00',
        value: '21.00',
        mode: 1,
        supportedModes: '0,1',
        unit: 'C',
        batteryLevel: 255,
      },
      actions: ['setTargetLevel', 'setMode'],
    }),
    hc2(27, 'RGBW', 'com.fibaro.FGRGBW441M', 'com.fibaro.colorController', {
      room: 4,
      properties: { value: 0, color: '0,0,0,0', lastColorSet: '10,20,30,0' },
      actions: ['turnOn', 'turnOff', 'setValue', 'setColor'],
    }),
    hc2(29, 'Dimmer', 'com.fibaro.FGD212', 'com.fibaro.multilevelSwitch', {
      room: 5,
      properties: { value: 99, isLight: true },
      actions: ['turnOn', 'turnOff', 'setValue'],
    }),
    // An HC2 keeps the central-scene keys of a device as a JSON string.
    ...pyfibaro('device-scene-support'),
  ];
}

const SHUTTER_ACTIONS = [
  'open',
  'close',
  'stop',
  'setValue',
  'startLevelIncrease',
  'startLevelDecrease',
  'stopLevelChange',
  'reconfigure',
];

/**
 * Shutter modules of an HC3 / Yubii Home and an HC2 (issue #4): the types and
 * base types of the Fibaro modules (FGR223 Roller Shutter 3, FGWR111 Walli
 * Roller Shutter, FGRM222 / FGR221 Roller Shutter 2 and 1), a radio motor
 * without position (remoteBaseShutter), a shutter module the box reports as
 * a multilevel switch, and a gate. Written after the HC3 API documentation
 * and the Home Assistant fixtures, not dumped from a real box.
 */
export function shutterDevices() {
  const strings = (props) =>
    Object.fromEntries(Object.entries(props).map(([k, v]) => [k, String(v)]));
  return [
    node(200, 'Volet séjour', 220),
    device(201, 'Volet séjour', 'com.fibaro.FGR223', 'com.fibaro.rollerShutter', {
      room: 220,
      parent: 200,
      interfaces: ['energy', 'levelChange', 'power', 'zwave', 'zwaveCentralScene'],
      properties: {
        value: 0,
        state: 'Closed',
        deviceRole: 'BlindsWithPositioning',
        power: 0,
        energy: 0.42,
        centralSceneSupport: [
          { keyAttributes: KEYS, keyId: 1 },
          { keyAttributes: KEYS, keyId: 2 },
        ],
      },
      actions: SHUTTER_ACTIONS,
    }),
    node(210, 'Volet chambre', 222),
    device(211, 'Volet chambre', 'com.fibaro.FGWR111', 'com.fibaro.rollerShutter', {
      room: 222,
      parent: 210,
      interfaces: ['energy', 'levelChange', 'power', 'zwave'],
      properties: { value: 99, state: 'Open', deviceRole: 'BlindsWithPositioning', power: 0 },
      actions: SHUTTER_ACTIONS,
    }),
    // A one-way radio motor: open / close / stop, no position, no state.
    device(220, 'Volet cuisine', 'com.fibaro.remoteBaseShutter', 'com.fibaro.baseShutter', {
      room: 221,
      interfaces: [],
      properties: { deviceRole: 'BlindsWithoutPositioning' },
      actions: ['open', 'close', 'stop'],
    }),
    // A shutter module whose type the box reports as a multilevel switch.
    device(230, 'Volet bureau', 'com.acme.shutterModule', 'com.fibaro.multilevelSwitch', {
      room: 222,
      interfaces: ['levelChange', 'zwave'],
      properties: { value: 40, deviceRole: 'BlindsWithPositioning' },
      actions: ['turnOn', 'turnOff', 'setValue', 'open', 'close', 'stop'],
    }),
    // An HC2: every property is a string. (Not "Volet garage": since 0.1.3 a
    // name with "garage" is a gate, the safe way.)
    {
      ...device(240, 'Volet atelier', 'com.fibaro.FGR221', 'com.fibaro.rollerShutter', {
        room: 221,
        actions: ['open', 'close', 'stop', 'setValue'],
      }),
      properties: strings({ dead: false, value: 25 }),
    },
    // A gate driven by a shutter module: never a shutter by the shutter path.
    device(250, 'Portail', 'com.fibaro.barrier', 'com.fibaro.actor', {
      room: 223,
      properties: { value: 'Closed', deviceRole: 'Gate' },
      actions: ['open', 'close', 'stop'],
    }),
  ];
}

export const SCENES_HC3 = [
  { id: 10, name: 'Bonne nuit', type: 'scenario', roomId: 219, hidden: false, enabled: true },
  { id: 11, name: 'Départ', type: 'lua', roomId: 219, hidden: false, enabled: true },
  { id: 12, name: 'Technique', type: 'lua', roomId: 219, hidden: true, enabled: true },
];
