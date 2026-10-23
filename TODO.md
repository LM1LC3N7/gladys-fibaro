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
- Gates and locks (2026-10-20, Louis's rule: opening off by default):
  `isGate` (barrier / gate / garage types, "door" types except sensors and
  locks, Gate / GarageDoor roles, with an open, close or setValue action) is
  checked before the shutters. A gate: `gate` opening-sensor (read-only) and
  `open` / `close` / `stop` button/push (a push is 1). Open needs
  `allow_gates`, unsecure needs `allow_unlock` (both default off, only a real
  `true`); close, stop and secure always work. A guarded call carries `guard`
  and `decide`: the app refuses at once when the option is off, reads the
  device again (`GET /api/devices/{id}`, 1 s), decides on that fresh state
  only (unknown or dead: refused; already open / unlocked: nothing sent),
  checks the option and the running configuration again, then sends (2.5 s).
  Migration: the features of a device already created are kept
  (`buildModel(..., createdFeatures)`): a gate created as a shutter by 0.1.1
  keeps `state` / `position`, with opening guarded. A timeout after sending
  is "sent, without confirmation" and the device is read again after 2 s.
  Needs an `xhigh` review (physical access).
- After the xhigh review (2026-10-20): roles in this order: gate, lock,
  valve, shutter, then the type table. Type rules match whole words
  (`typeWords`: dots, dashes, camelCase), never substrings. A gate on a plain
  relay (turnOn only): read-only `relay` contact + guarded `open` pulsing
  turnOn, decided only on "alive" (the relay value is not the gate position);
  no switch feature of 0.1.1 is ever kept on a gate. Valves (`valve` word,
  Valve / WaterValve / GasValve roles): read-only `valve` (1 open) + `open`
  / `close` push, both behind `allow_valves` (on = open for a relay valve,
  an assumption); a 0.1.1 `binary` is kept read-only (no writer: history
  kept, no "everything off" reaches the valve). A thermostat is never a valve. Protective
  calls (`protective: true`: stop, close, secure, position 0) skip the queue
  and bump a per-device cancel counter; a guarded call checks it after the
  re-read and right before callAction. `skip` only when clearly open (open,
  true, ≥ 95 %). No position for a boolean value. The client marks a failure
  `sent` once the request was fully written ('finish'); the app says "not
  sent" before that. Only cover / gate / lock / valve commands are queued.
  Not done: republishing the old switch / dimmer of a shutter read-only to
  keep its history (the reviewer's option): "Update" deletes it, documented.
- Issue #4 after 0.1.2 (2026-10-23, Yubii Home 5.210, no device dump: the
  user's `/api/devices/<id>` answered "not found"; screenshots only: "Portail"
  offered with "Shutter state" only, "Éclairage extérieur" with "Button
  click" only). Causes taken, not confirmed:
  - Gate: a shutter module or a Nice radio motor whose role is not exactly
    `Gate` / `GarageDoor` (left to a blinds role, or another spelling) and
    whose type has no gate word. Rule, the safest and broadest: `isGate` also
    on any role whose words contain gate / garage / door / barrier / portal
    (not sensor, lock, detector, bell: `GateSensor`, `VideoGateBell`), on the
    HC3 `gates` category (`properties.categories`, a JSON string on an HC2),
    and on the name (`GATE_NAME`: portail, portillon, gate, barrière, porte de
    garage, garage door, Garagentor, Tor, cancello, "Garage" alone) **only for
    a shutter-like device** (never a relay: "Prise garage", "Lumière
    portail"). A wrong gate only puts opening behind `allow_gates`; a wrong
    shutter lets "close the shutters" and scene openings reach a gate.
  - The 0.1.2 migration (a gate created as a shutter kept `state` /
    `position`, opening guarded) is dropped: a gate never carries a shutter
    feature (Louis's brief: never reached by "close the shutters" nor by a
    shutter-opening scene). The created features have no writer (refused,
    nothing sent) until "Update" removes them; documented. External ids are
    unchanged.
  - A gate that reports neither `value` nor `state` (one-way radio motor):
    opening decided on "alive" only, like the relay gate (otherwise it could
    never open). A `state` that reads Unknown is still refused. To review.
  - Light: the pyfibaro HC3 dump of a switch module (`device-scene-support-hc3`)
    has a hidden node, a **hidden** `binarySwitch` and a hidden
    central-scene endpoint: 0.1.2 offered only the endpoint, named after the
    module, with button features: the user's exact symptom. Now a hidden
    output (turnOn / setValue / open / close, not a node) whose module's
    central-scene endpoint is offered is offered too, under its own name (the
    module's when its own is numeric). The keys stay their own device (same
    external ids); when both carry the same name, the keys become "<name>
    S1/S2" (name only, created devices keep theirs). Also: `isLight` on any
    lamp role (`Light`, `OutdoorLight`, `GardenLamp`, `NightLamp`, `Bracket`,
    words light / lamp / lighting / bracket / chandelier) and on the `lights`
    category; a lamp relay created as a switch changes category ("Update",
    history of that feature lost, documented).
  - "Not found" on `/api/devices/<id>`: likely the Gladys external id
    (`fibaro:123`) or an id of the Yubii app / web page instead of the bare
    `FIBARO_ID`, or the hidden endpoint searched by its Gladys name;
    documented with the export steps (whole list, block and parent).
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
