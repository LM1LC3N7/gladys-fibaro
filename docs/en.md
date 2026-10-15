# Fibaro / Yubii Home

This integration connects Gladys to **your Fibaro Home Center 2, Home Center
Lite, Home Center 3, HC3 Lite or Nice Yubii Home** and offers the devices of
the box in the **Discovery** tab of Gladys: switches, dimmers, RGBW
controllers, roller shutters, thermostats, locks and sensors. Once a device is
added, its states follow the box live, and Gladys controls it **through the
box**, which keeps running: your Z-Wave network, your Fibaro scenes and your
Yubii app stay as they are. The remotes and push buttons become **scene
triggers**, and a scene action runs a **Fibaro scene**. Unofficial, not
affiliated with Fibaro or Nice.

> **Development version (0.1).** Written from the documentation of the API and
> from dumps of real boxes, not yet tested on a real Home Center or Yubii
> Home. Your feedback is welcome on the GitHub repository.

## Setup

1. Find the IP address of the box (in its web interface, or in your router).
   Give it a fixed address in your router.
2. In Gladys, open **Integrations → Fibaro / Yubii Home → Configuration** and
   type:
   - the **address**: `http://192.168.1.50` (a bare IP address means
     `http://`). An HC3 or a Yubii Home set to HTTPS only: `https://…`, and
     turn off **Verify the TLS certificate** (their certificate is
     self-signed);
   - the **user name** and **password** you log in to the box with (`admin`
     on a Home Center 2, often an e-mail address on an HC3 or a Yubii Home).
     An administrator account sees every device; a user account only the
     devices it was given.
3. Press **Test the connection**: the model, its firmware and the number of
   devices offered show up under the button.
4. Open the **Discovery** tab and add the devices you want.

## What you get

| In the box                                                | In Gladys                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| Relay, wall plug (binary switch)                          | a switch, with its power and energy when the module measures them   |
| Dimmer (Dimmer 2, Walli Dimmer…)                          | a light (on/off, brightness) when it drives a lamp, else a dimmer   |
| RGBW controller                                           | a light: on/off, brightness, color                                  |
| Roller shutter (Roller Shutter 2/3, Walli Roller Shutter) | a shutter: position, open, close, stop                              |
| Shutter without position                                  | open, close, stop                                                   |
| Thermostatic head, thermostat, HVAC                       | a thermostat: setpoint, mode (off, heat, cool, auto), heating state |
| Door lock                                                 | a lock                                                              |
| Door/window, motion, flood, smoke, CO sensor              | the matching Gladys sensor                                          |
| Temperature, light, humidity, power, energy sensors       | the matching Gladys sensor                                          |
| Battery level                                             | a battery feature                                                   |
| Remote, push button, S1/S2 inputs with scene activation   | one button per key, and the "Fibaro remote or button" trigger       |

Each device is named after its room, as in the box: `Wall plug (Living
room)`. Left out: the disabled and hidden devices, the users and phones of
the box, and the devices of the plugins (HC2) and Quick Apps (HC3), unless
you turn on **Also offer the plugins and Quick Apps**.

A device the box reports as **dead** (it no longer answers: battery, range,
power) keeps a badge with an orange dot in Gladys until it answers again.

## Remotes and buttons in scenes

A key of a remote (KeyFob), of a push button (The Button) or the S1/S2 input
of a Fibaro switch, dimmer or shutter with scene activation enabled sends a
**central scene** event. Two ways to use it:

- the **button** feature of the device (one per key) changes on every press:
  "click", "double click", "triple click", "held", "released";
- the **Fibaro remote or button** scene trigger: pick the remote, the key
  number and the gesture. Its variables give the key, the gesture and the
  attribute sent by the box (`Pressed`, `Pressed2`, `HeldDown`, `Released`…).

The S1/S2 keys only send events when **scene activation** is enabled in the
parameters of the module (parameter 28 on a Dimmer 2; see the manual of the
others).

## Running a Fibaro scene

Press **List the Fibaro scenes** in the configuration: the number of each
visible scene shows up under the button. In a Gladys scene, add the action
**Run a Fibaro scene** and type the number. Scenes protected by a PIN code
cannot be started this way.

## Good to know

- **Real time**: Gladys keeps a request open with the box
  (`/api/refreshStates`), which answers as soon as something changes.
- **Measurements**: a wall plug can report its power every few seconds.
  Gladys keeps the last reading every **Minimum interval between two readings
  of a sensor** (10 s by default); switches, buttons and opening or motion
  sensors are never delayed.
- **Changes in the box** (a device added, renamed, moved): Gladys reads the
  list again within seconds; press **Scan** in Discovery to force it.
- The box blocks an address after **repeated failed logins**: after a
  password error, Gladys retries only every 5 minutes.

## Troubleshooting

- **"refused the user name or the password"**: type them again; try them in
  the web interface of the box.
- **"certificate refused"**: turn off **Verify the TLS certificate**, or use
  `http://`.
- **"unreachable"**: use the LAN IP address of the box (not `localhost`, not
  a remote access address), and check that the Gladys machine reaches it.
- **A device is missing**: is it enabled and visible in the box? Is it a
  plugin or a Quick App (turn on the option)? Press **Test the connection**:
  the message counts the devices left out and why.
