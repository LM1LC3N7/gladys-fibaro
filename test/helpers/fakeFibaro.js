// A fake Fibaro box behind the client of src/fibaro.js: the fixtures, a change
// log for /api/refreshStates, the actions and scenes run, failures.

import { FibaroError } from '../../src/fibaro.js';
import {
  INFO_HC3,
  PASSWORD,
  ROOMS,
  SCENES_HC3,
  SECTIONS,
  USER,
  hc3Devices,
} from '../fixtures/fibaro.js';

export function fakeFibaro({
  info = INFO_HC3,
  devices = hc3Devices(),
  rooms = ROOMS,
  sections = SECTIONS,
  scenes = SCENES_HC3,
} = {}) {
  const box = {
    info,
    devices,
    rooms,
    sections,
    scenes,
    /** refreshStates cursor */
    last: 1000,
    /** [{ seq, change } | { seq, event }] */
    log: [],
    /** every call: { method, args } */
    calls: [],
    /** the device actions run: { api, deviceId, name, args } */
    actions: [],
    /** the scenes run: { api, sceneId } */
    scenesRun: [],
    /** an error every call throws (a FibaroError) */
    fail: undefined,
    /** "<device id>:<action>" -> error thrown by callAction */
    actionErrors: {},
    clients: [],
  };

  /** A property changes in the box: its refreshStates change, and the device follows. */
  box.change = (id, values) => {
    box.last += 1;
    box.log.push({ seq: box.last, change: { id, ...values } });
    const dev = box.devices.find((d) => d.id === id);
    if (dev) {
      Object.assign(dev.properties, values);
    }
  };

  box.event = (type, data) => {
    box.last += 1;
    box.log.push({ seq: box.last, event: { type, data } });
  };

  box.callsOf = (method) => box.calls.filter((c) => c.method === method);

  const answer = (method, args) => {
    switch (method) {
      case 'info':
        return structuredClone(box.info);
      case 'devices':
        return structuredClone(box.devices);
      case 'rooms':
        return structuredClone(box.rooms);
      case 'sections':
        if (box.sections instanceof Error) {
          throw box.sections;
        }
        return structuredClone(box.sections);
      case 'scenes':
        return structuredClone(box.scenes);
      case 'refreshStates': {
        const [last] = args;
        const entries = last === 0 ? [] : box.log.filter((e) => e.seq > last);
        return {
          status: 'IDLE',
          last: box.last,
          timestamp: 1_700_000_000,
          logs: [],
          changes: entries.filter((e) => e.change).map((e) => e.change),
          events: entries.filter((e) => e.event).map((e) => e.event),
          alarmChanges: [],
        };
      }
      case 'callAction': {
        const [action] = args;
        const error = box.actionErrors[`${action.deviceId}:${action.name}`];
        if (error) {
          throw error;
        }
        box.actions.push({ ...action, deviceId: String(action.deviceId) });
        return undefined;
      }
      case 'runScene': {
        const [scene] = args;
        if (!box.scenes.some((s) => s.id === scene.sceneId)) {
          throw new FibaroError('notfound', 'not found', { status: 404 });
        }
        box.scenesRun.push(scene);
        return undefined;
      }
      default:
        throw new Error(`unknown method ${method}`);
    }
  };

  box.connect = (config) => {
    const client = { config, closed: false };
    for (const method of [
      'info',
      'devices',
      'rooms',
      'sections',
      'scenes',
      'refreshStates',
      'callAction',
      'runScene',
    ]) {
      client[method] = async (...args) => {
        box.calls.push({ method, args });
        if (box.fail) {
          throw box.fail;
        }
        if (config.username !== USER || config.password !== PASSWORD) {
          throw new FibaroError('auth', 'user name or password refused', { status: 401 });
        }
        return answer(method, args);
      };
    }
    client.close = () => {
      client.closed = true;
    };
    box.clients.push(client);
    return client;
  };

  return box;
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
