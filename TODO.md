# TODO — Fibaro / Yubii Home v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  once the 10 integrations claimed in /t/10385 (post #178) are published, the
  main session posts one recap message there. A module report ends with
  "Récap forum : <module> — <one French sentence>".

## Status

- [x] **Milestone 1 — core** (2026-10-15): REST client (basic auth, HTTP or
      HTTPS with the certificate check optional), model detection (HC2, HCL,
      HC3, HC3L, Yubii Home, Z-Box; API v4 / v5), inventory (`/api/devices`,
      `/api/rooms`, `/api/sections`; disabled, hidden, plugins and system
      devices left out), mapping (switches, dimmers, RGBW, shutters, locks,
      thermostats, binary sensors, temperature / light / humidity /
      multilevel sensors, power, energy, battery, central-scene keys), the
      `refreshStates` long-poll (changes, `DevicePropertyUpdatedEvent`,
      `CentralSceneEvent` → button states + `button_event` scene trigger,
      device / room events → inventory reload), commands (`callAction` on v4,
      `POST /devices/{id}/action/{name}` on v5), `run_scene` scene action and
      "List the Fibaro scenes" button, transport badges (unreachable box, dead
      device = degraded), connection test, reconnection, manifest, docs en/fr.
      Tests on pyfibaro dumps of real HC2/HC3 boxes and HC3-documented
      fixtures; **not run against a real box** (none available).
- [ ] **Milestone 2 — real boxes**: collect `/api/devices`, `/api/settings/info`
      and a few `refreshStates` answers from testers (HC2, HC3, HC3 Lite,
      Yubii Home) as fixtures; fix what differs. See "To check on a real box".
- [ ] **Milestone 3 — more types**: gates and garage doors
      (`com.fibaro.barrier`), slats / tilt (`value2`, `setValue2`,
      `rotateSlats*`), fan modes (`setFanMode`), the HC2 `operatingMode` of
      HVAC units, AC mode as the Gladys `air-conditioning` category when the
      device cools, sirens, the `SceneActivationEvent` of older Z-Wave
      switches (scene ids as a trigger), alarm zones (arm / disarm, breached),
      Quick App buttons, Fibaro scenes as push buttons on a device (run from
      the dashboard), the `Fibaro-User-PIN` header for protected scenes and
      locks.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic (the forum recap is the main session's, see Working method).

## To check on a real box

- `/api/settings/info` of each model (`platform`, `oemId`, `serialNumber`
  prefixes of an HC3 Lite and a Yubii Home, `currentVersion`).
- `refreshStates`: that the HC2 holds the request too (the loop asks every
  second when it does not), the cursor after a reboot of the box, the size of
  an answer after a long disconnection.
- The `CentralSceneEvent` data (`id` on HC3, `deviceId` on HC2) and the
  attribute names of real remotes (KeyFob, The Button, Walli, S1/S2 inputs);
  which endpoint the event names when the remote endpoint is hidden.
- Actions: `callAction` on a 4.6x HC2, `setColor` with string arguments,
  `setValue` 0–99 vs 0–100 (Zigbee and Nice devices of a Yubii Home), shutters
  that report 0–100.
- Thermostats: the property names of a Fibaro Heat Controller (FGT-001), a
  Danfoss LC-13 on HC2, an HVAC unit (cooling setpoint, modes), and the
  setpoint read while a battery head sleeps (`heatingThermostatSetpointFuture`).
- Locks: `value` vs `secured` per brand.
- HTTPS: the self-signed certificate of an HC3 and of a Yubii Home, and the
  redirect when HTTP is turned off.
- Users: a non-admin account (what `/api/devices` lists, whether `/api/rooms`
  and `/api/sections` answer), and the lock-out after failed logins.

## Decisions

- **Own REST client, no Fibaro library** (Louis's rule: reuse maintained
  community work, rewrite only dead or debt-heavy projects). Checked on
  2026-10-15: on npm, `fibaro-api` (2014, `request`), `fibaro-home-center2-client`
  (2020, GPL-3.0, HC2 only), the Node-RED nodes (2020–2021, GPL-3.0 or
  abandoned) are dead or incompatible; `@smarthomesimple/fibaro-typescript`
  (2026) is HC3-only generated code on a deprecated `@hey-api/client-fetch`,
  without a LICENSE file nor the long-poll; `homebridge-fibaro-home-center`
  (Apache-2.0, maintained) and the Fibaro MCP servers are applications, not
  libraries. pyfibaro (MIT, maintained, used by Home Assistant) is Python. The
  API is a handful of basic-auth GET/POST: a ~250-line client on Node's
  `http`/`https` adds no dependency. pyfibaro, the Home Assistant `fibaro`
  integration and the Homebridge plugin are the protocol documentation
  (credited in README and NOTICE); the pyfibaro test fixtures are copied
  verbatim with their MIT licence.
- Model: serial number prefix, or `platform` / `oemId` when present, longest
  prefix first (pyfibaro reports an HC3 Lite as an HC3). Unknown model: API v4
  with a 4.x firmware, else v5.
- Actions: `GET /api/callAction` on API v4 (the historic HC2 call, as asked in
  the brief; pyfibaro uses the v5 POST on both), the POST on v5. Scenes:
  `POST /api/scenes/{id}/execute` on v5, `POST /api/scenes/{id}/action/start`
  on v4 (pyfibaro).
- One Gladys device per Fibaro device (the endpoints the Fibaro interface
  shows), named `<device> (<room>)`; the hidden Z-Wave node parents are left
  out. Params `FIBARO_ID`, `FIBARO_TYPE`, `FIBARO_ROOM`, `FIBARO_SECTION`.
- Hidden devices are left out, except the central-scene endpoints the HC3
  hides itself (`175.0.1`): kept, named after their physical device, so the
  remotes and S1/S2 keys work.
- Plugins and Quick Apps (`isPlugin`) only with the `include_plugins` option
  (default off, as Home Assistant's `import_plugins`).
- Role by `type`, then `baseType`, then the actions and properties, in the
  order of Home Assistant. A switch or dimmer is a light when `isLight`,
  `deviceRole: Light`, the `light` interface or an FGD212 says so. A generic
  binary sensor follows its HC3 `deviceRole`, else it is an `unknown` feature.
  A multilevel sensor without a known unit is read by its name (Netatmo
  plugin: CO2, pressure, noise, humidity), else left out.
- Levels: Fibaro 0–99 → Gladys 0–100 (over 98 is 100), Gladys 100 → 99.
  Shutters: ≤ 5 % is closed, ≥ 95 % open (HA's calibration slack).
  Shutter `state` (open / close / stop) is write-only and optimistic.
- Shutters (issue #4, 2026-10-20): `isShutter` is checked before every other
  role: type or base type matching shutter / blind / curtain / awning / FGR
  (not FGRGBW) / FGWR, an HC3 blinds `deviceRole`, or open + close actions;
  never for a barrier, gate, garage, door, lock, valve or a `secure` action.
  A shutter is never a switch nor a dimmer. Shutter control stays on by
  default (Louis's off-by-default list is locks, alarms, valves). Command
  values checked strictly (`strictNumber`), commands serialized per device
  (a stop bypasses the queue), action timeout 3 s + queue wait 0.5 s, a
  timeout after sending = "sent, without confirmation".
- "Test the connection": hidden parents of other devices are "technical
  nodes", not "left out"; the types of the devices with nothing to offer are
  listed (5 at most).
- To do (found while fixing #4): `com.fibaro.barrier` (gates, garage doors)
  still falls back to a controllable shutter through its open / close
  actions, and the lock `unsecure` is allowed by default: both go against
  Louis's rule (opening off by default). Needs an option, a migration that
  keeps the created features, and an `xhigh` review.
- RGBW: color = RGB of `color` ("r,g,b,w"), `lastColorSet` when the
  controller is off (0,0,0,0); written with `setColor` and string arguments
  (as Home Assistant), white at 0.
- Thermostats: setpoint from `heatingThermostatSetpointFuture`, then
  `heatingThermostatSetpoint`, then `targetLevel`; written with
  `setHeatingThermostatSetpoint` or `setTargetLevel`. Modes: HC3 names
  (Off/Heat/Cool/Auto, the others not shown) or HC2 Z-Wave codes 0–3 (the
  Gladys values).
- Battery 255 = no reading (pyfibaro): not sent.
- Power / energy of a switch or a light are `switch` features, of anything
  else `energy-sensor` ones (energy as an `index`), like gladys-jeedom.
- Central scene: one `button` feature per key (`button-<keyId>`), states sent
  with `publishStates` (the mqtt-discovery 0.1.2 bug); Pressed → CLICK,
  Pressed2 → DOUBLE_CLICK, Pressed3 → TRIPLE, Pressed4 → QUADRUPLE, Pressed5 →
  MANY, HeldDown → LONG_PRESS, Released → LONG_RELEASE (Gladys
  BUTTON_STATUS). The `button_event` trigger fires for every offered device,
  created or not, within 250 events / minute.
- Dead devices: `local` transport with `degraded: true` and a message (the
  box still answers, the device does not).
- Changes: `refreshStates?last=<cursor>` one request after the other,
  timeout 45 s (an HC3 holds it up to 30 s), at least 1 s between two
  requests. The cursor is read before the inventory, so a change made while
  the inventory is read comes again. Device / room / section events reload
  the inventory after 3 s.
- Errors: 401 → credentials refused, 403 → access refused (both retried every
  5 minutes: the box blocks an address after repeated failed logins), 404 →
  not a Fibaro API, a redirect names its target. `/api/sections` refused or
  missing: ignored.
- Gladys `gladys_version >= 5.1.0` (scene triggers and actions).
