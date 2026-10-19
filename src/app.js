// -----------------------------------------------------------------------------
// The integration: one Fibaro box, its devices turned into Gladys devices, the
// change loop (/api/refreshStates) feeding the states and the button events,
// and the commands sent back. index.js only wires the SDK handlers to it.
//
// Lifecycle: start -> open (settings/info: model and API version, the change
// cursor, the inventory) -> refreshStates long-poll, one request after the
// other -> on a failure, reconnect with a growing delay (the reconnection
// reads the inventory again: the values missed meanwhile come back with it).
// The inventory is also read again every 10 minutes, on Scan, and when the
// box says a device or a room was added, changed or removed.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { LIMITS, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import { buildModel, emptyModel } from './devices.js';
import { FibaroError, createClient } from './fibaro.js';
import { T } from './i18n.js';
import { buildInventory } from './inventory.js';
import { decodeKeyAttribute } from './mapping.js';
import { detectModel, looksLikeInfo } from './model.js';
import { StatePublisher } from './publisher.js';
import { flag, toBool, toNumber } from './values.js';

/** Events of refreshStates that change the device list rather than a state. */
const INVENTORY_EVENTS =
  /^(Device(Created|Removed|Modified|ChangedRoom)|Room(Created|Removed|Modified)|Section(Created|Removed|Modified))Event$/;

const listOf = (v) => (Array.isArray(v) ? v : []);

export class FibaroApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'fibaro' }),
    connect = createClient,
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.connect = connect;
    this.now = now;
    this.timers = timers;
    this.config = normalizeConfig();
    this.client = null;
    /** the box: { name, api, serial, version, unit } */
    this.box = undefined;
    this.model = emptyModel();
    this.inventory = undefined;
    /** Fibaro id -> its properties, kept up to date by the changes */
    this.props = new Map();
    /** refreshStates cursor */
    this.last = 0;
    this.online = false;
    /** feature id -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    /** device external id -> the transport entry last published */
    this.transports = new Map();
    this.timer = undefined;
    this.inventoryTimer = undefined;
    this.failures = 0;
    this.generation = 0;
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.warned = new Set();
    /** times of the scene events of the last minute */
    this.sceneEvents = [];
    /** Fibaro id -> the tail of its command queue */
    this.queues = new Map();
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.refreshCreated();
    if (this.config.error) {
      await this.setStatus(false, T.configError(this.config.error));
      return;
    }
    this.client = this.newClient(this.config);
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: this.model.throttled,
    });
    this.publisher.start();
    await this.setStatus(false, T.connecting);
    await this.open(generation);
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.timer);
    this.timers.clearTimeout(this.inventoryTimer);
    this.timer = undefined;
    this.inventoryTimer = undefined;
    this.publisher.stop();
    this.client?.close?.();
    this.client = null;
    this.online = false;
    this.failures = 0;
  }

  newClient(config) {
    return this.connect({
      origin: config.origin,
      username: config.username,
      password: config.password,
      verifyCertificate: config.verifyCertificate,
    });
  }

  current(generation) {
    return generation === this.generation;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  /** Runs `fn` after `ms`, unless the app was restarted or stopped meanwhile. */
  schedule(generation, ms, fn) {
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      if (this.current(generation)) {
        fn().catch((err) => this.logger.error(`Fibaro loop: ${err.message}`));
      }
    }, ms);
  }

  /** Reads which box answers. */
  async readBox(client, options) {
    const info = await client.info(options);
    if (!looksLikeInfo(info)) {
      throw new FibaroError('format', 'not a Fibaro box');
    }
    return detectModel(info);
  }

  /** Connects: the model of the box, the change cursor, the inventory. */
  async open(generation) {
    const client = this.client;
    try {
      const box = await this.readBox(client);
      // The cursor first: a change made while the inventory is read comes again.
      const first = await client.refreshStates(0);
      this.box = box;
      await this.loadInventory(generation);
      if (!this.current(generation)) {
        return;
      }
      this.last = toNumber(first.last) ?? 0;
      this.online = true;
      this.failures = 0;
      this.logger.info(
        `Connected to the ${box.name} ${box.version} at ${this.config.origin} (API v${box.api})`,
      );
      await this.setStatus(true, T.connected(box, this.model.devices.length));
      await this.publishAllTransports();
      this.schedule(generation, 0, () => this.poll(generation));
      this.scheduleInventory(generation, TIMINGS.inventoryRefresh);
    } catch (err) {
      await this.fail(generation, err);
    }
  }

  async fail(generation, err) {
    if (!this.current(generation)) {
      return;
    }
    this.online = false;
    this.failures += 1;
    const slow = err?.kind === 'auth' || err?.kind === 'forbidden';
    const delay = slow
      ? TIMINGS.authRetry
      : Math.min(TIMINGS.retryMax, TIMINGS.retryMin * 2 ** (this.failures - 1));
    if (err instanceof FibaroError) {
      this.logger.warn(`Fibaro: ${err.message} (retrying in ${Math.round(delay / 1000)} s)`);
    } else {
      this.logger.error('Fibaro: unexpected failure', err);
    }
    await this.setStatus(false, T.failure(err));
    await this.publishAllTransports();
    this.timers.clearTimeout(this.inventoryTimer);
    this.schedule(generation, delay, () => this.open(generation));
  }

  // --- Changes -----------------------------------------------------------------

  /** One refreshStates request; the box holds it until something changes. */
  async poll(generation) {
    const client = this.client;
    const started = this.now();
    try {
      const answer = await client.refreshStates(this.last);
      if (!this.current(generation)) {
        return;
      }
      this.applyChanges(generation, answer);
    } catch (err) {
      await this.fail(generation, err);
      return;
    }
    // A box that answers at once (no long-poll) is asked every second, not in a loop.
    const wait = Math.max(0, TIMINGS.pollGap - (this.now() - started));
    this.schedule(generation, wait, () => this.poll(generation));
  }

  /**
   * One answer of refreshStates: { last, changes: [{ id, <property>: value }],
   * events: [{ type, data }] }.
   */
  applyChanges(generation, answer) {
    const last = toNumber(answer?.last);
    if (last !== undefined) {
      this.last = last;
    }
    /** Fibaro id -> the properties changed */
    const touched = new Map();
    for (const change of listOf(answer?.changes)) {
      if (change && change.id !== undefined && change.id !== null) {
        const { id, log: _log, logTemp: _logTemp, ...values } = change;
        this.mergeProps(String(id), values, touched);
      }
    }
    let reload = false;
    for (const event of listOf(answer?.events)) {
      const type = String(event?.type ?? '');
      const data = event?.data && typeof event.data === 'object' ? event.data : {};
      if (type.toLowerCase() === 'centralsceneevent') {
        this.onCentralScene(data);
      } else if (type === 'DevicePropertyUpdatedEvent' && data.id !== undefined && data.property) {
        this.mergeProps(String(data.id), { [data.property]: data.newValue }, touched);
      } else if (INVENTORY_EVENTS.test(type)) {
        reload = true;
      }
    }
    for (const [id, props] of touched) {
      this.readDevice(id, props);
    }
    if (reload) {
      this.scheduleInventory(generation, TIMINGS.inventoryDebounce);
    }
  }

  mergeProps(id, values, touched) {
    const props = this.props.get(id);
    if (!props) {
      return; // not offered (hidden, disabled, a plugin…)
    }
    Object.assign(props, values);
    if (!touched.has(id)) {
      touched.set(id, new Set());
    }
    for (const key of Object.keys(values)) {
      touched.get(id).add(key);
    }
  }

  /** Reads the features of a device (only those depending on `changed`, if given). */
  readDevice(id, changed) {
    const props = this.props.get(id) ?? {};
    for (const { featureId, props: deps, read } of this.model.readers.get(id) ?? []) {
      if (changed && ![...deps].some((p) => changed.has(p))) {
        continue;
      }
      let value;
      try {
        value = read(props);
      } catch (err) {
        this.warnOnce(`read:${featureId}`, `${featureId}: ${err.message}`);
        continue;
      }
      if (value !== undefined) {
        this.record(featureId, value);
      }
    }
    if (changed?.has('dead')) {
      this.publishTransport(id).catch((err) =>
        this.logger.warn(`Transport badge failed: ${err.message}`),
      );
    }
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, state) {
    this.lastValues.set(featureId, state);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, state);
    }
  }

  /** A remote, a push button or a wall switch: the button feature and the scene trigger. */
  onCentralScene(data) {
    const fibaroId = String(data.id ?? data.deviceId ?? '');
    const deviceId = this.model.deviceIds.get(fibaroId);
    if (!deviceId) {
      return; // a device Gladys does not offer
    }
    const keyId = toNumber(data.keyId);
    const { event, status } = decodeKeyAttribute(data.keyAttribute);
    const route = this.model.buttons.get(fibaroId);
    const featureId = route ? (route.keys.get(keyId) ?? route.any) : undefined;
    if (featureId && status !== undefined && this.created.has(featureId)) {
      this.publisher.pushEvent(featureId, status);
    }
    const t = this.now();
    this.sceneEvents = this.sceneEvents.filter((at) => t - at < 60_000);
    if (this.sceneEvents.length >= LIMITS.eventsPerMinute) {
      this.warnOnce('events-budget', 'Too many button events this minute: some are dropped');
      return;
    }
    this.sceneEvents.push(t);
    this.gladys
      .publishSceneEvent(SCENE_TRIGGERS.BUTTON, {
        device: deviceId,
        button: keyId ?? null,
        event,
        attribute: String(data.keyAttribute ?? ''),
      })
      .catch((err) => this.logger.warn(`Scene event failed: ${err.message}`));
  }

  // --- Inventory -----------------------------------------------------------------

  idsOf(fibaroId) {
    return this.gladys.externalIds('fibaro', fibaroId);
  }

  async readInventory(client, timeout = TIMINGS.inventoryTimeout) {
    const devices = await client.devices({ timeout });
    const rooms = await client.rooms({ timeout });
    // Sections only name the floors: a box that refuses them still works.
    const sections = await client.sections({ timeout }).catch((err) => {
      if (err?.kind === 'notfound' || err?.kind === 'format' || err?.kind === 'forbidden') {
        return [];
      }
      throw err;
    });
    return buildInventory({
      devices,
      rooms,
      sections,
      includePlugins: this.config.includePlugins,
    });
  }

  /** Reads the devices and rooms; publishes the devices and the values. */
  async loadInventory(generation, { force = false } = {}) {
    const inventory = await this.readInventory(this.client);
    if (!this.current(generation)) {
      return;
    }
    const model = buildModel((id) => this.idsOf(id), inventory, this.box);
    this.inventory = inventory;
    this.model = model;
    this.props = new Map(inventory.devices.map((d) => [d.id, d.properties]));
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: model.throttled,
    });
    for (const id of model.readers.keys()) {
      this.readDevice(id);
    }
    const json = JSON.stringify(model.devices);
    if (force || json !== this.publishedDevices) {
      try {
        await this.gladys.publishDiscoveredDevices(model.devices);
        this.publishedDevices = json;
        this.logger.info(
          `${model.devices.length} devices offered in Discovery (${inventory.devices.length} enabled and visible Fibaro devices)` +
            (model.emptyTypes.length > 0
              ? `; nothing to offer for: ${model.emptyTypes.join(', ')}`
              : ''),
        );
      } catch (err) {
        this.logger.error(`Publishing the discovered devices failed: ${err.message}`);
      }
    }
  }

  scheduleInventory(generation, ms) {
    this.timers.clearTimeout(this.inventoryTimer);
    this.inventoryTimer = this.timers.setTimeout(() => {
      this.inventoryTimer = undefined;
      if (!this.current(generation) || !this.online) {
        return; // the reconnection reads it anyway
      }
      this.loadInventory(generation)
        .then(async () => {
          if (this.current(generation) && this.online) {
            await this.setStatus(true, T.connected(this.box, this.model.devices.length));
            await this.publishAllTransports();
          }
        })
        .catch((err) => this.logger.warn(`Reading the Fibaro inventory failed: ${err.message}`))
        .finally(() => {
          if (this.current(generation) && !this.inventoryTimer) {
            this.scheduleInventory(generation, TIMINGS.inventoryRefresh);
          }
        });
    }, ms);
  }

  /** The Scan button of the Discovery tab. */
  async rescan() {
    if (!this.online || !this.client) {
      await this.gladys.publishDiscoveredDevices(this.model.devices);
      return;
    }
    await this.loadInventory(this.generation, { force: true });
  }

  // --- Transport badges ----------------------------------------------------------

  /** The badge of a device: unreachable with the box, degraded when the box says it is dead. */
  transportOf(fibaroId) {
    if (!this.online) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (toBool(this.props.get(fibaroId)?.dead) === true) {
      return { transport: DEVICE_TRANSPORTS.LOCAL, degraded: true, message: T.dead };
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  /** The entries of the devices whose badge changed (only those created in Gladys). */
  changedTransports(fibaroIds) {
    const created = this.createdDevices();
    const entries = [];
    for (const fibaroId of fibaroIds) {
      const deviceId = this.model.deviceIds.get(fibaroId);
      if (!deviceId || !created.has(deviceId)) {
        continue;
      }
      const entry = this.transportOf(fibaroId);
      const key = JSON.stringify(entry);
      if (this.transports.get(deviceId) !== key) {
        this.transports.set(deviceId, key);
        entries.push({ external_id: deviceId, ...entry });
      }
    }
    return entries;
  }

  async publishTransport(fibaroId) {
    const entries = this.changedTransports([fibaroId]);
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  async publishAllTransports() {
    const entries = this.changedTransports([...this.model.deviceIds.keys()]);
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Devices created by the user -------------------------------------------------

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  fibaroIdOf(deviceId) {
    for (const [fibaroId, id] of this.model.deviceIds) {
      if (id === deviceId) {
        return fibaroId;
      }
    }
    return undefined;
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value !== undefined) {
        this.publisher.push(f.external_id, value);
      }
    }
    const fibaroId = this.fibaroIdOf(device?.external_id);
    if (fibaroId) {
      await this.publishTransport(fibaroId).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  // --- Commands ------------------------------------------------------------------

  async setValue(device, feature, value) {
    const client = this.client;
    if (!client || !this.online) {
      throw new Error(T.notConnected.en);
    }
    const writer = this.model.writers.get(feature.external_id);
    if (!writer) {
      throw new Error(`${feature.name ?? feature.external_id} cannot be controlled`);
    }
    // The value is checked by the writer before anything is sent.
    const calls = writer.write(value, this.props.get(writer.fibaroId) ?? {});
    const send = () => this.sendCalls(client, writer.fibaroId, calls);
    // A stop is never held behind a previous command of the device.
    const urgent = calls.length > 0 && calls.every((c) => c.name === 'stop');
    await (urgent ? send() : this.serialize(writer.fibaroId, send));
    this.logger.debug(`${calls.map((c) => c.name).join(', ')} sent to device ${writer.fibaroId}`);
    if (this.model.optimistic.has(feature.external_id)) {
      this.record(feature.external_id, Number(value));
    }
  }

  /**
   * Runs the commands of one device one after the other. A command that would
   * wait too long behind the previous one is refused before it is sent (Gladys
   * stops waiting after 5 s).
   */
  serialize(fibaroId, fn) {
    const queuedAt = this.now();
    const previous = this.queues.get(fibaroId) ?? Promise.resolve();
    const next = previous.then(() => {
      if (this.now() - queuedAt > TIMINGS.commandQueueWait) {
        throw new Error(
          `Device ${fibaroId} is busy with a previous command: this one was not sent, try again`,
        );
      }
      return fn();
    });
    const tail = next.catch(() => {});
    this.queues.set(fibaroId, tail);
    tail.then(() => {
      if (this.queues.get(fibaroId) === tail) {
        this.queues.delete(fibaroId);
      }
    });
    return next;
  }

  /** The actions of one command; a timeout or a cut connection may have reached the box. */
  async sendCalls(client, fibaroId, calls) {
    for (const { name, args } of calls) {
      try {
        await client.callAction(
          { api: this.box.api, deviceId: fibaroId, name, args },
          { timeout: TIMINGS.commandTimeout },
        );
      } catch (err) {
        const maybeSent =
          err?.kind === 'timeout' ||
          (err?.kind === 'network' && /reset|closed/.test(String(err.message)));
        if (maybeSent) {
          throw new Error(
            `${name} sent to device ${fibaroId}, without confirmation from the box (${err.message}): its state will follow`,
            { cause: err },
          );
        }
        throw err;
      }
    }
  }

  // --- Scenes ----------------------------------------------------------------------

  /** The "Run a Fibaro scene" scene action. */
  async runScene(fields) {
    const sceneId = Number(fields?.scene);
    if (!Number.isInteger(sceneId) || sceneId <= 0) {
      throw new Error(`"${fields?.scene ?? ''}" is not a Fibaro scene number`);
    }
    const client = this.client;
    if (!client || !this.online) {
      throw new Error(T.notConnected.en);
    }
    try {
      await client.runScene({ api: this.box.api, sceneId });
    } catch (err) {
      if (err?.kind === 'notfound') {
        throw new Error(`The box has no scene ${sceneId}`, { cause: err });
      }
      throw err;
    }
    this.logger.info(`Fibaro scene ${sceneId} started`);
    return undefined;
  }

  /** Runs `fn` with a client of the saved configuration (the connection buttons). */
  async withClient(fn) {
    const config = this.config;
    if (config.error) {
      return T.configError(config.error);
    }
    const client = this.newClient(config);
    try {
      return await fn(client);
    } catch (err) {
      if (!(err instanceof FibaroError)) {
        this.logger.error('Fibaro request failed', err);
      }
      return T.failure(err);
    } finally {
      client.close?.();
    }
  }

  /** The "List the Fibaro scenes" button: their numbers, for the scene action. */
  listScenes() {
    return this.withClient(async (client) => {
      const scenes = (await client.scenes({ timeout: TIMINGS.testTimeout }))
        .filter((s) => s && s.id !== undefined)
        .filter((s) => flag(s.visible, true) !== false && flag(s.hidden, false) !== true)
        .map((s) => ({ id: Number(s.id), name: String(s.name ?? '').trim() || `#${s.id}` }))
        .sort((a, b) => a.id - b.id);
      if (scenes.length === 0) {
        return T.scenes.none;
      }
      const shown = scenes.slice(0, LIMITS.scenesListed);
      return T.scenes.list(shown, scenes.length - shown.length);
    });
  }

  // --- Configuration screen button ---------------------------------------------------

  /** Reads the box, its devices and scenes with the saved configuration, and counts. */
  testConnection() {
    return this.withClient(async (client) => {
      const timeout = TIMINGS.testTimeout;
      const box = await this.readBox(client, { timeout });
      const inventory = await this.readInventory(client, timeout);
      const scenes = await client.scenes({ timeout }).catch(() => []);
      const model = buildModel((id) => this.idsOf(id), inventory, box);
      return T.test.ok({
        model: box,
        devices: model.devices.length,
        read: inventory.devices.length,
        disabled: inventory.skipped.disabled,
        hidden: inventory.skipped.hidden,
        plugins: inventory.skipped.plugins,
        nodes: inventory.skipped.nodes,
        empty: model.counts.empty,
        emptyTypes: model.emptyTypes,
        scenes: scenes.length,
      });
    });
  }
}
