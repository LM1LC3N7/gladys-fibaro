// -----------------------------------------------------------------------------
// The Fibaro inventory -> Gladys devices and routing tables (pure).
//
// One Gladys device per Fibaro device (an endpoint of the Fibaro interface).
// External ids:
//   device  ext:<selector>:fibaro:<Fibaro device id>
//   feature <device>:<role>   (src/mapping.js: binary, brightness, position…)
// A box never renumbers its devices (a backup restore keeps the ids): the
// external ids stay stable.
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';
import { mapDevice } from './mapping.js';

/** The roles whose commands of one device run one after the other (physical movement, access, water). */
export const SERIALIZED_ROLES = new Set(['cover', 'gate', 'lock', 'valve']);

/** Device names repeat from room to room ("Light"): the room is part of the name. */
export const deviceName = (dev) =>
  (dev.roomName ? `${dev.name} (${dev.roomName})` : dev.name).slice(0, 100);

const paramsOf = (dev) =>
  [
    { name: 'FIBARO_ID', value: dev.id },
    { name: 'FIBARO_TYPE', value: dev.type },
    { name: 'FIBARO_ROOM', value: dev.roomName },
    { name: 'FIBARO_SECTION', value: dev.sectionName },
  ].filter((p) => p.value);

export function emptyModel() {
  return {
    devices: [],
    /** Fibaro id -> [{ featureId, props: Set, read }] */
    readers: new Map(),
    /** feature id -> { fibaroId, write } */
    writers: new Map(),
    throttled: new Set(),
    optimistic: new Set(),
    /** Fibaro id -> { deviceId, keys: Map(keyId -> featureId), any?: featureId } */
    buttons: new Map(),
    /** Fibaro id -> Gladys device external id */
    deviceIds: new Map(),
    /** devices read, and left out because nothing maps / over the limit */
    counts: { read: 0, empty: 0, overflow: 0 },
    /** "type (baseType)" of the devices left out because nothing maps (for the test button) */
    emptyTypes: [],
  };
}

/**
 * @param {(fibaroId: string) => { device: string, feature: (key: string) => string }} idsOf
 *   the external ids of one device (gladys.externalIds('fibaro', id))
 * @param {{ devices: object[] }} inventory see src/inventory.js
 * @param {{ unit?: 'C' | 'F' }} [box] the temperature unit of the box
 * @param {Iterable<string>} [createdFeatures] the external ids of the features already
 *   created in Gladys: a device keeps them when its mapping changed (no feature lost)
 */
export function buildModel(idsOf, inventory, box, createdFeatures = []) {
  const model = emptyModel();
  /** device external id -> the keys of its created features */
  const existingByDevice = new Map();
  for (const id of createdFeatures) {
    const cut = id.lastIndexOf(':');
    if (cut > 0) {
      const device = id.slice(0, cut);
      if (!existingByDevice.has(device)) {
        existingByDevice.set(device, new Set());
      }
      existingByDevice.get(device).add(id.slice(cut + 1));
    }
  }
  for (const dev of inventory.devices) {
    model.counts.read += 1;
    const mapped = mapDevice(dev, box, existingByDevice.get(idsOf(dev.id).device));
    if (mapped.features.length === 0) {
      model.counts.empty += 1;
      const kind = dev.baseType ? `${dev.type} (${dev.baseType})` : dev.type || '?';
      if (!model.emptyTypes.includes(kind)) {
        model.emptyTypes.push(kind);
      }
      continue;
    }
    if (model.devices.length >= LIMITS.devices) {
      model.counts.overflow += 1;
      continue;
    }
    const ids = idsOf(dev.id);
    model.deviceIds.set(dev.id, ids.device);
    model.devices.push({
      name: deviceName(dev),
      external_id: ids.device,
      should_poll: false,
      params: paramsOf(dev),
      features: mapped.features.map(({ key, ...feature }) => ({
        ...feature,
        external_id: ids.feature(key),
      })),
    });
    model.readers.set(
      dev.id,
      mapped.readers.map(({ key, props, read }) => ({
        featureId: ids.feature(key),
        props: new Set(props),
        read,
      })),
    );
    // Shutters, gates, locks and valves: one command at a time per device.
    const serialized = SERIALIZED_ROLES.has(mapped.role);
    for (const [key, write] of Object.entries(mapped.writers)) {
      model.writers.set(ids.feature(key), { fibaroId: dev.id, write, serialized });
    }
    for (const key of mapped.throttled) {
      model.throttled.add(ids.feature(key));
    }
    for (const key of mapped.optimistic) {
      model.optimistic.add(ids.feature(key));
    }
    const { keys, any } = mapped.buttons;
    if (keys.size > 0 || any) {
      model.buttons.set(dev.id, {
        deviceId: ids.device,
        keys: new Map([...keys].map(([keyId, key]) => [keyId, ids.feature(key)])),
        any: any ? ids.feature(any) : undefined,
      });
    }
  }
  return model;
}
