# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- Shutters (issue #4): every Fibaro or Yubii shutter is offered as a Gladys
  shutter (position, open, close, stop), whatever its type: Roller Shutter 3
  (FGR223), Walli Roller Shutter (FGWR111), Roller Shutter 1/2 (FGR221,
  FGRM222), `rollerShutter`, `baseShutter`, `remoteBaseShutter`, a module set
  to a blinds role in the box, or any device with open and close actions. A
  shutter is never offered as a switch or a dimmer any more (a module the box
  reports as a multilevel switch was one). A shutter that reports a position
  but cannot be set to one keeps it as a read-only reading.
- Shutter commands: the value is checked strictly before anything is sent
  (an empty or invalid position is refused, never taken for 0, which closed
  the shutter); the commands of one device run one after the other, a stop
  never waits; an action times out after 3 s, within the 5 s Gladys waits;
  a command that may have reached the box is reported "sent, without
  confirmation", never "not sent".
- "Test the connection" no longer counts the hidden technical nodes of the box
  (the Z-Wave parent of each module) as devices left out, and names the
  Fibaro types of the devices with nothing to offer.

### Changed

- README: the store install note replaces the work-in-progress notice, and the
  Releasing section no longer says the store topic is still to be added.

## [0.1.1] - 2026-10-16

### Added

- Connection to a Fibaro Home Center 2, Home Center Lite, Home Center 3, HC3
  Lite or Nice Yubii Home through its local REST API (user name and password
  of the box, http or https; TLS verification can be turned off for the
  self-signed certificate of an HC3 or a Yubii Home). The model and its API
  version are detected.
- Every enabled and visible device of the box offered in Discovery, named
  after its room; plugins and Quick Apps on demand.
- Switches and wall plugs (with their power and energy), dimmers, RGBW
  controllers (color), roller shutters (position, open, close, stop), door
  locks, thermostats (setpoint, mode, heating state), door/window, motion,
  flood, smoke and CO sensors, temperature, light, humidity, power and energy
  sensors, battery levels.
- The states follow the box live (`refreshStates` long-poll); the values
  missed while the box was unreachable come back at the reconnection.
- Remotes, push buttons and S1/S2 inputs with scene activation: one button
  feature per key and the "Fibaro remote or button" scene trigger (key,
  gesture).
- "Run a Fibaro scene" scene action, and a "List the Fibaro scenes" button
  giving their numbers.
- Transport badges: unreachable when the box is, degraded when the box
  reports a device as dead.
- "Test the connection" button: model, firmware, devices and scenes, what is
  offered and what is left out.
- Sensor readings throttled to a configurable interval, all states within the
  Gladys rate limit.

[Unreleased]: https://github.com/LM1LC3N7/gladys-fibaro/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-fibaro/releases/tag/v0.1.1
