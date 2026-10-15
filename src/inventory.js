// -----------------------------------------------------------------------------
// The inventory of the box, normalized (pure).
//
// /api/devices lists everything the box knows: the users and phones, the
// controllers, the physical Z-Wave nodes (a hidden `com.fibaro.zwaveDevice`
// parent) and their endpoints (the visible children the Fibaro interface
// shows: a relay, a temperature sensor…). One Gladys device per endpoint.
// Left out: disabled devices, hidden ones, and plugins / Quick Apps unless the
// user asks for them. One exception to "hidden": the HC3 hides the
// central-scene endpoint of a remote or a push button itself (named
// "175.0.1"): it is kept, named after its physical device.
// -----------------------------------------------------------------------------

import { flag, toList } from './values.js';

/** Users, phones and controllers: never a device (pyfibaro's list, and a few more). */
export const SYSTEM_TYPES = new Set([
  'HC_user',
  'VOIP_user',
  'iOS_device',
  'android_device',
  'com.fibaro.zwavePrimaryController',
  'com.fibaro.zigbeePrimaryController',
  'com.fibaro.niceEngine',
]);

const idOf = (v) => (v === null || v === undefined || v === '' || v === 0 ? undefined : String(v));

/** The central-scene keys of a device: [{ keyId, keyAttributes }]. */
export function centralScene(properties) {
  return toList(properties?.centralSceneSupport)
    .filter((k) => k && typeof k === 'object' && Number.isInteger(Number(k.keyId)))
    .map((k) => ({
      keyId: Number(k.keyId),
      keyAttributes: toList(k.keyAttributes).map(String),
    }));
}

/** One entry of /api/devices. */
export function normalizeDevice(raw) {
  const properties =
    raw.properties && typeof raw.properties === 'object' ? { ...raw.properties } : {};
  return {
    id: String(raw.id),
    name: String(raw.name ?? '').trim() || `Fibaro ${raw.id}`,
    parentId: idOf(raw.parentId),
    roomId: idOf(raw.roomID ?? raw.roomId),
    type: String(raw.type ?? ''),
    baseType: String(raw.baseType ?? ''),
    interfaces: Array.isArray(raw.interfaces) ? raw.interfaces.map(String) : undefined,
    actions: Object.keys(raw.actions && typeof raw.actions === 'object' ? raw.actions : {}),
    properties,
    enabled: flag(raw.enabled, true) !== false,
    visible: flag(raw.visible, true) !== false,
    isPlugin: flag(raw.isPlugin, false) === true,
  };
}

/**
 * The devices Gladys may offer, with their room and section.
 * @param {{ devices: object[], rooms?: object[], sections?: object[], includePlugins?: boolean }} answers
 * @returns {{ devices: object[], skipped: { disabled: number, hidden: number, plugins: number }, total: number }}
 */
export function buildInventory({ devices, rooms = [], sections = [], includePlugins = false }) {
  const sectionNames = new Map(
    sections
      .filter((s) => s && s.id !== undefined)
      .map((s) => [String(s.id), String(s.name ?? '')]),
  );
  const roomsById = new Map(
    rooms
      .filter((r) => r && r.id !== undefined)
      .map((r) => [
        String(r.id),
        {
          name: String(r.name ?? '').trim() || undefined,
          section: sectionNames.get(String(r.sectionID ?? r.sectionId)) || undefined,
        },
      ]),
  );
  const all = devices
    .filter((d) => d && d.id !== undefined && d.id !== null && !SYSTEM_TYPES.has(d.type))
    .map(normalizeDevice);
  const byId = new Map(all.map((d) => [d.id, d]));
  const kept = [];
  const skipped = { disabled: 0, hidden: 0, plugins: 0 };
  for (const device of all) {
    if (!device.enabled) {
      skipped.disabled += 1;
      continue;
    }
    if (device.isPlugin && !includePlugins) {
      skipped.plugins += 1;
      continue;
    }
    let name = device.name;
    if (!device.visible) {
      const parent = byId.get(device.parentId);
      if (centralScene(device.properties).length === 0) {
        skipped.hidden += 1;
        continue;
      }
      if (parent && parent.name && !/^\d+(\.\d+)*$/.test(parent.name)) {
        name = parent.name;
      }
    }
    const room = roomsById.get(device.roomId);
    kept.push({ ...device, name, roomName: room?.name, sectionName: room?.section });
  }
  return { devices: kept, skipped, total: all.length };
}
