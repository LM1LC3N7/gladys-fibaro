# gladys-fibaro

[Gladys Assistant](https://gladysassistant.com) external integration for the
**Fibaro Home Center 2, Home Center Lite, Home Center 3, HC3 Lite** and **Nice
Yubii Home** boxes: every enabled and visible device of the box becomes a
Gladys device of the Discovery tab, its states follow the box live, Gladys
controls it through the box, the remotes and push buttons become scene
triggers, and a scene action runs a Fibaro scene. Made for Fibaro users who
move to Gladys at their own pace, or run both side by side. Unofficial, not
affiliated with Fibaro or Nice.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **In the Gladys store.** Install it from **Integrations**, or with **Install
> from GitHub** and `https://github.com/LM1LC3N7/gladys-fibaro`. First version,
> written from the API documentation and dumps of real boxes, not yet tested on
> a real Home Center or Yubii Home. Feedback and bug reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-fibaro/issues).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (FibaroApp) ⇄ src/fibaro.js ⇄ box REST API (/api)
                                   ├─ src/model.js      settings/info -> model, API v4 or v5 (pure)
                                   ├─ src/inventory.js  devices, rooms, sections -> device list (pure)
                                   ├─ src/mapping.js    one device -> features, readers, writers (pure)
                                   ├─ src/devices.js    devices -> Gladys devices + routing tables (pure)
                                   └─ src/publisher.js  states within 300/min, sensor throttling, button events
```

Every call goes to `http(s)://<box>/api/…` with HTTP basic auth (the account
of the box):

- **Model**: `GET /api/settings/info`. The serial number prefix (or `platform`
  / `oemId` on recent firmwares) gives the model: `HC2` and `HCL` speak API v4
  (firmware 4.x), `HC3`, `HC3L`, `YH` (Yubii Home) and `ZB` API v5.
- **Inventory**: `/api/devices`, `/api/rooms`, `/api/sections`, at connection,
  every 10 minutes, on Scan, and when the box reports a device or a room added,
  changed or removed. Left out: users, phones, controllers, disabled and hidden
  devices, plugins and Quick Apps (unless the user asks for them). The hidden
  central-scene endpoint the HC3 creates for a remote or a push button is kept,
  named after its physical device.
- **Mapping**: by `type`, then `baseType`, then the actions and properties of
  the device (the order of the Home Assistant integration): switches, dimmers
  (a light when `isLight` / `deviceRole: Light`), RGBW controllers (color as an
  RGB integer, the last color when off), roller shutters (position 0–99 with
  5 % slack at the ends, open / close / stop), gates and garage doors (state,
  Open / Close / Stop; opening only with `allow_gates`), door locks (unlocking
  only with `allow_unlock`; both decided on the state read again from the
  box), thermostats (heating
  and cooling setpoints, HC3 `thermostatMode` names or HC2 Z-Wave mode codes,
  operating state), door/window, motion, flood, smoke, CO sensors,
  temperature, light, humidity, multilevel sensors by unit, power and energy,
  battery, central-scene keys.
- **Changes**: the long-poll `GET /api/refreshStates?last=<cursor>`, one
  request after the other (an HC3 holds it up to 30 s; a box that answers at
  once is asked every second). The `changes` update the properties of the
  devices and their features; `DevicePropertyUpdatedEvent` too;
  `CentralSceneEvent` become button states (through `publishStates`: two
  identical presses are two states) and a `button_event` scene trigger.
  `dead: true` gives a degraded transport badge.
- **Commands**: HC2 `GET /api/callAction?deviceID=…&name=…&arg1=…`, HC3 family
  `POST /api/devices/<id>/action/<name> { "args": […] }`: `turnOn`, `turnOff`,
  `setValue`, `setColor`, `open`, `close`, `stop`,
  `setHeatingThermostatSetpoint`, `setTargetLevel`, `setThermostatMode`,
  `setMode`, `secure`, `unsecure`.
- **Scenes**: the `run_scene` scene action, HC3 `POST /api/scenes/<id>/execute`,
  HC2 `POST /api/scenes/<id>/action/start`; the "List the Fibaro scenes" button
  gives their numbers.
- **Failures**: box unreachable → status message and `unreachable` transport
  badges, reconnection after 5 s, doubling up to 60 s (refused credentials:
  every 5 minutes, the HC3 blocks an address after repeated failed logins). The
  reconnection reads the inventory again: the values changed meanwhile come
  back with it.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/pyfibaro/` holds verbatim copies of the pyfibaro test fixtures
(dumps of real HC2 and HC3 boxes); `test/fixtures/fibaro.js` adds the device
types they lack (dimmer, RGBW, shutters, thermostats, lock, remote, meters),
written after the HC3 API documentation; `test/helpers/fakeFibaro.js` serves
them with a change log. The app tests run the real SDK wiring against the SDK's
fake Gladys. No real box was available: see TODO.md for what needs one.

## Credits

The Fibaro protocol is documented by these projects, used as references only
(no code copied, no runtime dependency):

- [pyfibaro](https://github.com/rappenze/pyfibaro) (MIT), the Python client of
  the Home Assistant integration: model detection, refreshStates, actions and
  scenes per API version, property quirks. Its test fixtures are copied in
  `test/fixtures/pyfibaro/` with their licence.
- The Home Assistant [`fibaro` integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/fibaro)
  (Apache-2.0): the type → platform mapping, covers, lights, climate, events.
- [homebridge-fibaro-home-center](https://github.com/ilcato/homebridge-fibaro-home-center)
  (Apache-2.0): the HC2 / HC3 differences seen in the field.

No maintained JavaScript client of the Fibaro API exists (the npm packages are
abandoned since 2014–2021, GPL-3.0, HC3-only generated code or applications):
the client is written here, see TODO.md "Decisions".

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store.

## License

Apache-2.0 (see NOTICE for the third-party credits). Fibaro, Home Center and
Yubii are trademarks of their owners (Fibar Group, Nice S.p.A.); this project is
not affiliated with Fibaro or Nice.
