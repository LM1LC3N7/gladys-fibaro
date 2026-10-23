# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- Gates (issue #4): a gate motor on a shutter module or a radio gate motor of
  a Yubii Home was offered as a shutter ("Shutter state"). A device is now a
  gate also when its role in the box contains gate, garage, door, barrier or
  portal in any spelling (`gate`, `SlidingGate`, `GarageDoors`,
  `VideoGateOpen`…), when it is in the HC3 / Yubii "gates" category, or when a
  shutter-like device is named portail, portillon, gate, barrière, porte de
  garage, garage door, Garagentor, Tor or "Garage" ("Volet garage" stays a
  shutter). A gate offers its state (when it reports one) and Open / Close /
  Stop buttons: opening only with `allow_gates` (off by default), close and
  stop always. A gate is never a shutter, a switch or a dimmer any more, not
  even one created as a shutter by 0.1.1 or 0.1.2: its old shutter features
  are no longer driven (a command is refused, nothing sent) and "Update" in
  Discovery removes them. A one-way gate motor that reports neither a value
  nor a state is opened (once allowed) when the box says it is alive, like a
  gate on a relay.
- Lights (issue #4): a relay with a lamp role in the box (`Light`,
  `OutdoorLight`, `GardenLamp`, `NightLamp`, `Bracket`…) or in the "lights"
  category is a Gladys light, not a switch. The relay or dimmer of a module
  that the box hides while it shows the module's S1/S2 keys is offered too, as
  its own device: an outdoor light is no longer offered as its keys only
  ("Button click"). The keys stay a separate device, a scene trigger; when
  both carry the same name, the keys are called "<name> S1/S2".

### Changed

- Docs: how to export the devices of the box for an issue (`/api/devices`, the
  whole list) and why `/api/devices/<id>` can answer "not found".

## [0.1.2] - 2026-10-20

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
  the shutter); the commands of one shutter, gate, lock or valve run one
  after the other (lights and plugs are never held); an action times out
  after 3 s, within the 5 s Gladys waits.
- Gates, garage doors and motorized doors (`com.fibaro.barrier`, the words
  gate / garage / door / barrier in the type, the Gate and GarageDoor roles,
  a relay included) are never offered as switches, dimmers or shutters: their
  state (read-only) and Open, Close, Stop buttons; a gate on a plain relay:
  the relay contact (read-only) and an Open button pulsing it. Opening is off
  by default, behind the new "Allow opening gates, garage doors and doors"
  option (`allow_gates`); closing and stopping always work. A gate driven by
  a shutter module stays a shutter: set its role to Gate or Garage door in
  the box.
- Door locks (secure / unsecure actions or a lock type, before any other
  role): unlocking is off by default, behind the new "Allow unlocking the
  door locks" option (`allow_unlock`); locking always works.
- Water and gas valves (a valve type or role) are no longer switches: their
  state (read-only) and Open and Close buttons, both off by default behind
  the new "Allow opening and closing the valves" option (`allow_valves`).
  A relay valve: relay on is read as open. A thermostatic valve head stays a
  thermostat.
- With the option on, opening, unlocking and valve commands are decided on
  the state read again from the box just before (refused when unknown or the
  device is dead; nothing sent, and logged, when it is already clearly open,
  unlocked or in the state asked; a relay gate is only checked to be alive),
  and the option is checked again right before sending. A Stop, Close or
  Lock is sent at once and cancels an opening or unlocking still waiting
  ("cancelled by a later Stop / Close / Lock, not sent").
- A command the box did not confirm: "sent, without confirmation" only when
  the request was fully written to the box (the device is then read again a
  few seconds later), "not sent" when it never left.
- Update from 0.1.1: the devices already added keep their features, but an
  opening, unlocking or valve command, from the dashboard or from a 0.1.1
  scene, is refused while the option is off. A shutter added as a switch or a
  dimmer shows "Update" in Discovery: it replaces On/off and Level with
  Position and Open/close, and their history is deleted. A gate added as a
  shutter keeps its shutter features (opening guarded); a gate added as a
  switch loses that feature and its history on "Update". A valve added as a
  switch keeps its On/off feature and history, read-only: only Open and Close
  drive it, and the 0.1.1 scenes using that switch must move to the buttons.
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

[Unreleased]: https://github.com/LM1LC3N7/gladys-fibaro/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-fibaro/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-fibaro/releases/tag/v0.1.1
