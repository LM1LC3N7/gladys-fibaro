// -----------------------------------------------------------------------------
// The states sent to Gladys, within its 300 states per minute.
//
// A Fibaro box relays fast devices (a wall plug reports its power every few
// seconds). The publisher keeps the LAST value of each feature, sends the
// pending ones every second within a per-minute budget, skips the unchanged
// ones (publishChangedStates) and spaces the measurements of a same feature by
// the configured interval. Button presses are events: two identical presses
// are two states, so they go through publishStates, in order, never merged
// (publishChangedStates would drop the second one).
// -----------------------------------------------------------------------------

import { LIMITS, TIMINGS } from './constants.js';

export class StatePublisher {
  constructor({ gladys, logger, now = Date.now, timers = globalThis, budget }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.budget = budget ?? LIMITS.statesPerMinute;
    /** featureId -> state */
    this.pending = new Map();
    /** [{ device_feature_external_id, state }] button presses, in order */
    this.events = [];
    /** featureId -> last send time (throttled features) */
    this.lastSent = new Map();
    /** send times of the last minute */
    this.window = [];
    this.interval = 0;
    this.throttled = new Set();
    this.timer = undefined;
    this.flushing = undefined;
  }

  configure({ intervalSeconds, throttled }) {
    this.interval = intervalSeconds * 1000;
    this.throttled = throttled ?? new Set();
  }

  start() {
    this.stop();
    this.timer = this.timers.setInterval(() => {
      this.flush().catch((err) => this.logger.warn(`Sending the states failed: ${err.message}`));
    }, TIMINGS.flushInterval);
  }

  stop() {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  push(featureId, state) {
    this.pending.set(featureId, state);
  }

  pushEvent(featureId, state) {
    // A burst beyond the budget is cut: a press a minute late is worse than none.
    if (this.events.length < this.budget) {
      this.events.push({ device_feature_external_id: featureId, state });
    }
  }

  /** Forget a device (deleted): its pending values are dropped. */
  forget(deviceId) {
    const mine = (id) => id === deviceId || id.startsWith(`${deviceId}:`);
    for (const map of [this.pending, this.lastSent]) {
      for (const key of map.keys()) {
        if (mine(key)) {
          map.delete(key);
        }
      }
    }
    this.events = this.events.filter((e) => !mine(e.device_feature_external_id));
  }

  flush() {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => {
        this.flushing = undefined;
      });
    }
    return this.flushing;
  }

  async doFlush() {
    const now = this.now();
    this.window = this.window.filter((t) => now - t < 60_000);
    let room = this.budget - this.window.length;
    let sent = 0;
    if (room > 0 && this.events.length > 0) {
      const batch = this.events.splice(0, room);
      try {
        await this.gladys.publishStates(batch);
      } catch (err) {
        this.events.unshift(...batch);
        throw err;
      }
      batch.forEach(() => this.window.push(now));
      room -= batch.length;
      sent += batch.length;
    }
    if (room <= 0 || this.pending.size === 0) {
      return sent;
    }
    const batch = [];
    for (const [featureId, state] of this.pending) {
      if (batch.length >= room) {
        break;
      }
      const last = this.lastSent.get(featureId);
      if (this.throttled.has(featureId) && last !== undefined && now - last < this.interval) {
        continue;
      }
      this.pending.delete(featureId);
      batch.push({ device_feature_external_id: featureId, state });
    }
    if (batch.length === 0) {
      return sent;
    }
    try {
      const result = await this.gladys.publishChangedStates(batch, {
        heartbeat: TIMINGS.stateHeartbeat,
      });
      for (const { device_feature_external_id: id } of batch) {
        if (this.throttled.has(id)) {
          this.lastSent.set(id, now);
        }
      }
      const count = result?.count ?? batch.length;
      for (let i = 0; i < count; i += 1) {
        this.window.push(now);
      }
      return sent + count;
    } catch (err) {
      // Keep the values for the next round, unless a newer one arrived meanwhile.
      for (const { device_feature_external_id: id, state } of batch) {
        if (!this.pending.has(id)) {
          this.pending.set(id, state);
        }
      }
      throw err;
    }
  }
}
