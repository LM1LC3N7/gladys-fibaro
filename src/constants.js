// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration and their scenes) and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
  LIST_SCENES: 'list_scenes',
};

/** Manifest `scene_triggers` keys. */
export const SCENE_TRIGGERS = {
  BUTTON: 'button_event',
};

/** Manifest `scene_actions` keys. */
export const SCENE_ACTIONS = {
  RUN_SCENE: 'run_scene',
};

/** Sensor throttling bounds (seconds), mirrored by the manifest. */
export const SENSOR_INTERVAL = { min: 0, max: 300, default: 10 };

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Gladys accepts 300 scene events per minute. */
  eventsPerMinute: 250,
  /** Size of an answer read (bytes): /api/devices of a big HC2 is a few MB. */
  responseBytes: 32 * 1024 * 1024,
  /** Texts sent to Gladys (names, messages). */
  text: 1000,
  /** Devices published at once (publishDiscoveredDevices). */
  devices: 2000,
  /** Scenes named by the "List the Fibaro scenes" button. */
  scenesListed: 60,
};

export const TIMINGS = {
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** One API request (the inventory ones get `inventoryTimeout`). */
  requestTimeout: 15_000,
  inventoryTimeout: 60_000,
  /**
   * A device action: Gladys waits 5 s for the answer of a command, so the
   * whole command (wait behind the previous one of the device + the action)
   * stays within ~3.5 s: never sent after Gladys already showed a failure.
   */
  commandTimeout: 3000,
  /** Longest wait behind the previous command of the same device; refused (not sent) beyond. */
  commandQueueWait: 500,
  /**
   * A guarded command (gate opening, unlocking): the device is read again
   * first (rereadTimeout), then the action (sensitiveCommandTimeout): with the
   * queue wait, 4 s at most.
   */
  rereadTimeout: 1000,
  sensitiveCommandTimeout: 2500,
  /** A command without confirmation: the device is read again after this delay. */
  confirmReread: 2000,
  /** One request of the connection test (the button waits 90 s). */
  testTimeout: 25_000,
  /**
   * /api/refreshStates holds the request until something changes (about 30 s
   * at most on an HC3): its own, longer timeout.
   */
  longPollTimeout: 45_000,
  /**
   * Shortest time between two refreshStates requests: a box answering at once
   * (no long-poll) is asked every second, never in a busy loop.
   */
  pollGap: 1000,
  /** The inventory is read again this often: new, renamed or removed devices. */
  inventoryRefresh: 10 * 60_000,
  /** A device was added or changed in the box: wait for the burst of events to end. */
  inventoryDebounce: 3000,
  /** Reconnection delays after a failure (doubled each time, up to the max). */
  retryMin: 5000,
  retryMax: 60_000,
  /**
   * Refused credentials are retried slowly: the user has to change them, and
   * the HC3 blocks an address after repeated failed logins.
   */
  authRetry: 5 * 60_000,
};
