// -----------------------------------------------------------------------------
// The local REST API of a Fibaro box: the only network access.
//
// Every box answers on <origin>/api with HTTP basic auth (the user of the box):
//   - Home Center 2 / Home Center Lite: API v4, actions through
//     GET /api/callAction?deviceID=<id>&name=<action>&arg1=…
//   - Home Center 3, HC3 Lite, Yubii Home: API v5, actions through
//     POST /api/devices/<id>/action/<action> { args: […] }, HTTP or HTTPS (a
//     self-signed certificate by default).
// Both serve /api/settings/info, /api/devices, /api/rooms, /api/sections,
// /api/scenes and the long-poll /api/refreshStates?last=<n> (held up to 30 s
// by an HC3). The protocol facts come from pyfibaro (MIT), the Home Assistant
// `fibaro` integration and homebridge-fibaro-home-center (Apache-2.0), used as
// documentation only (see NOTICE).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

export class FibaroError extends Error {
  /**
   * @param {'auth'|'forbidden'|'notfound'|'network'|'certificate'|'timeout'|'http'|'redirect'|'format'|'size'} kind
   */
  constructor(kind, message, { status } = {}) {
    super(message);
    this.name = 'FibaroError';
    this.kind = kind;
    this.status = status;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
  EPROTO: 'TLS handshake failed',
};

const CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** A socket error -> FibaroError (never the credentials: they are in a header only). */
export function networkError(err) {
  if (err instanceof FibaroError) {
    return err;
  }
  if (CERTIFICATE_CODES.has(err?.code)) {
    return new FibaroError('certificate', `certificate refused (${err.code})`);
  }
  const reason = NETWORK_REASONS[err?.code] ?? err?.code ?? err?.message ?? 'network error';
  return new FibaroError('network', reason);
}

/**
 * One HTTP request; resolves { status, location, body }.
 * @param {string} url
 * @param {{ method: string, headers: object, body?: string, timeout: number,
 *   verifyCertificate: boolean, agent?: http.Agent, maxBytes?: number }} options
 */
export function httpRequest(
  url,
  { method, headers, body, timeout, verifyCertificate, agent, maxBytes },
) {
  const limit = maxBytes ?? LIMITS.responseBytes;
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    /** The first outcome wins: a destroyed request may still end or fail after it. */
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(
      target,
      {
        method,
        agent,
        headers: {
          Accept: 'application/json',
          ...headers,
          ...(body === undefined
            ? {}
            : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
        },
        rejectUnauthorized: verifyCertificate,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > limit) {
            // Rejected before the destroy: the 'end' that may follow is ignored.
            const mb = Math.max(1, Math.round(limit / 1048576));
            settle(reject, new FibaroError('size', `answer larger than ${mb} MB`));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          settle(resolve, {
            status: res.statusCode,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', (err) => settle(reject, networkError(err)));
      },
    );
    timer = setTimeout(() => {
      settle(
        reject,
        new FibaroError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end(body);
  });
}

const originOf = (location) => {
  try {
    return new URL(location).origin;
  } catch {
    return location ?? '';
  }
};

/**
 * The JSON of an answer, or the FibaroError it means.
 * @param {{ status: number, location?: string, body: string }} answer
 * @param {{ json?: boolean }} options json: false accepts an empty or non-JSON body (actions)
 */
export function parseAnswer({ status, location, body }, { json = true } = {}) {
  if (status >= 300 && status < 400) {
    throw new FibaroError('redirect', `redirected to ${originOf(location)}`, { status });
  }
  if (status === 401) {
    throw new FibaroError('auth', 'user name or password refused', { status });
  }
  if (status === 403) {
    throw new FibaroError('forbidden', 'access refused', { status });
  }
  if (status === 404) {
    throw new FibaroError('notfound', 'not found', { status });
  }
  if (status < 200 || status >= 300) {
    throw new FibaroError('http', `HTTP ${status}`, { status });
  }
  const text = String(body ?? '').trim();
  if (text === '') {
    if (json) {
      throw new FibaroError('format', 'empty answer', { status });
    }
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    if (json) {
      throw new FibaroError('format', 'not a Fibaro API answer', { status });
    }
    return undefined;
  }
}

/** A list answer: anything else means the address is not a Fibaro API. */
export function asList(value, what) {
  if (!Array.isArray(value)) {
    throw new FibaroError('format', `unexpected answer for ${what}`);
  }
  return value;
}

/**
 * A client of one box.
 * @param {{ origin: string, username: string, password: string, verifyCertificate: boolean,
 *   request?: typeof httpRequest }} options
 */
export function createClient({
  origin,
  username,
  password,
  verifyCertificate,
  request = httpRequest,
}) {
  const agent = new (origin.startsWith('https:') ? https : http).Agent({
    keepAlive: true,
    // The long-poll holds one socket: the commands and the inventory need others.
    maxSockets: 4,
  });
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  async function send(
    method,
    path,
    { payload, timeout = TIMINGS.requestTimeout, json = true } = {},
  ) {
    const answer = await request(`${origin}/api${path}`, {
      method,
      headers: { Authorization: authorization },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      timeout,
      verifyCertificate,
      agent,
    });
    return parseAnswer(answer, { json });
  }

  const get = (path, options) => send('GET', path, options);

  return {
    get,
    info: (options) => get('/settings/info', options),
    devices: async (options) => asList(await get('/devices', options), '/api/devices'),
    rooms: async (options) => asList(await get('/rooms', options), '/api/rooms'),
    sections: async (options) => asList(await get('/sections', options), '/api/sections'),
    scenes: async (options) => asList(await get('/scenes', options), '/api/scenes'),
    /** One device, read again before a guarded command. */
    device: (id, options) => get(`/devices/${encodeURIComponent(id)}`, options),

    /** The changes since the cursor `last` (0: only the current cursor matters). */
    async refreshStates(last, { timeout = TIMINGS.longPollTimeout } = {}) {
      const answer = await get(`/refreshStates?last=${Number(last) || 0}`, { timeout });
      if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
        throw new FibaroError('format', 'unexpected answer for /api/refreshStates');
      }
      return answer;
    },

    /**
     * Runs an action of a device.
     * @param {{ api: 4 | 5, deviceId: number|string, name: string, args?: Array }} action
     * @param {{ timeout?: number }} [options]
     */
    callAction({ api, deviceId, name, args = [] }, { timeout } = {}) {
      if (api >= 5) {
        return send(
          'POST',
          `/devices/${encodeURIComponent(deviceId)}/action/${encodeURIComponent(name)}`,
          { payload: { args }, json: false, timeout },
        );
      }
      const query = new URLSearchParams({ deviceID: String(deviceId), name });
      args.forEach((arg, i) => query.set(`arg${i + 1}`, String(arg)));
      return send('GET', `/callAction?${query}`, { json: false, timeout });
    },

    /**
     * Starts a scene (the calls of pyfibaro's SceneModel.start).
     * @param {{ api: 4 | 5, sceneId: number|string }} scene
     */
    runScene({ api, sceneId }) {
      const id = encodeURIComponent(sceneId);
      return api >= 5
        ? send('POST', `/scenes/${id}/execute`, { payload: {}, json: false })
        : send('POST', `/scenes/${id}/action/start`, { json: false });
    },

    close() {
      agent.destroy();
    },
  };
}
