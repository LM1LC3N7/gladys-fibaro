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
  };
}

/**
 * @param {(fibaroId: string) => { device: string, feature: (key: string) => string }} idsOf
 *   the external ids of one device (gladys.externalIds('fibaro', id))
 * @param {{ devices: object[] }} inventory see src/inventory.js
 * @param {{ unit?: 'C' | 'F' }} [box] the temperature unit of the box
 */
export function buildModel(idsOf, inventory, box) {
  const model = emptyModel();
  for (const dev of inventory.devices) {
    model.counts.read += 1;
    const mapped = mapDevice(dev, box);
    if (mapped.features.length === 0) {
      model.counts.empty += 1;
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
    for (const [key, write] of Object.entries(mapped.writers)) {
      model.writers.set(ids.feature(key), { fibaroId: dev.id, write });
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
