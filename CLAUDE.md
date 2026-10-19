# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency. It reads the devices of the user's Fibaro box (Home Center
2 / Lite: API v4; Home Center 3 / HC3 Lite / Nice Yubii Home: API v5) through
its local REST API, turns every enabled and visible device into a Gladys
device, follows the changes with the `refreshStates` long-poll, sends the
Gladys commands back as device actions, turns the central-scene events of the
remotes into button states and a scene trigger, and runs Fibaro scenes from a
scene action. Unofficial, not affiliated with Fibaro or Nice.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/mapping.test.js          # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          FibaroApp: connection, refreshStates loop, inventory
                    reloads, states, buttons, commands, scenes, transports
src/fibaro.js       the only network access: REST client (basic auth), error kinds
src/model.js        /api/settings/info -> model and API version (pure)
src/inventory.js    /api/devices + rooms + sections -> device list (pure)
src/mapping.js      one device -> features, readers, writers (pure)
src/devices.js      devices -> Gladys devices + routing tables (pure)
src/values.js       HC2 strings / HC3 JSON types -> numbers, booleans, lists
src/publisher.js    states within the Gladys rate limit, button events
src/config.js       config_schema normalized (address of the box)
src/constants.js    manifest keys, limits, timings
src/i18n.js         runtime texts (en/fr)
test/fixtures/      pyfibaro dumps of real boxes (MIT) + HC3-documented devices
test/helpers/       a fake Fibaro box; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `fibaro:<Fibaro device id>`, feature
  = `<role>` (`binary`, `brightness`, `dimmer`, `color`, `position`, `state`,
  `lock`, `gate`, `open`, `close`, `stop`, `setpoint`, `cooling-setpoint`, `mode`, `operating-state`,
  `opening`, `motion`, `leak`, `smoke`, `co`, `vibration`, `value`,
  `temperature`, `humidity`, `illuminance`, `co2`, `pressure`, `noise`,
  `power`, `energy`, `voltage`, `current`, `battery`, `button-<keyId>`,
  `button`). Never change how they are built.
- The manifest keys (`test_connection`, `list_scenes`, `button_event` and its
  fields/variables, `run_scene` and `scene`, the config keys) are frozen:
  users store them in their configuration and scenes.
- Value conventions: Fibaro levels are 0–99 (99 = full), an HC2 sends every
  property as a string (`src/values.js` reads both); the Gladys side follows
  the enums of `server/utils/constants.js` (copied in `src/mapping.js`, the SDK
  does not export them). Door/window: Fibaro `true` = open, Gladys
  `OPENING_SENSOR_STATE` OPEN 0 / CLOSE 1.
- Button presses go through `publishStates` (`publisher.pushEvent`), never
  `publishChangedStates`: two identical presses are two states.
- Never send a unit Gladys does not know: the whole device list would be refused.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Never log or put in a status message the password (it travels in the
  Authorization header only).
- Tests never touch the network: `test/helpers/fakeFibaro.js` stands for the
  box. The real HTTP path needs a real box (see TODO.md).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
