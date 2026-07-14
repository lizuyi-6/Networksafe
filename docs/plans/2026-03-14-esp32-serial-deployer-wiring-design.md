# AetherGuard ESP32 Jumper-Prototype Wiring Plan

- Date: 2026-03-14
- Status: Accepted
- Scope: `esp32/platformio.ini` current `serial_deployer_release` baseline

## 1. Goal

Lock the current ESP32 deployer to a jumper-wire breadboard prototype that can be built from an ESP32 development board, one external CP2102, an I2C OLED, three buttons, a common-cathode RGB module, and an active-low buzzer module.

The firmware keeps the current host-helper protocol:

- `AG:REQ:ENV`
- `AG:REQ:BACKUP`
- `AG:REQ:INSTALL`
- `AG:REQ:REMOVE`

The target Linux host still needs a one-time serial-helper install. After that, plugging the deployment-mode CP2102 into the host is enough to run the deployer.

## 2. Wiring Baseline

All peripherals are powered from the ESP32 development board `3V3` and `GND`.

- OLED:
  - `VCC -> 3V3`
  - `GND -> GND`
  - `SDA -> GPIO21`
  - `SCL -> GPIO22`
- Buttons:
  - one side of each button -> `GND`
  - the other side -> `GPIO18`, `GPIO19`, `GPIO23`
  - firmware uses `INPUT_PULLUP`
- RGB module:
  - common `GND/- -> GND`
  - `R -> GPIO25`
  - `G -> GPIO26`
  - `B -> GPIO27`
- Buzzer module:
  - `SIG -> GPIO14`
  - `VCC -> 3V3`
  - `GND -> GND`
  - logic is active-low

## 3. CP2102 Mode Switching

The single external CP2102 cannot be used for flash/debug and deployment at the same time.

### Flash / Debug Mode

- Preferred path: use the ESP32 board USB port directly
- Fallback path when board USB is unavailable:
  - `CP2102 TXD -> GPIO3 (U0RXD)`
  - `CP2102 RXD -> GPIO1 (U0TXD)`
  - `CP2102 GND -> GND`
  - manual bootloader entry: hold `BOOT`, tap `EN/RESET`, then start flashing

### Deployment Mode

- `CP2102 TXD -> GPIO16 (RX2)`
- `CP2102 RXD -> GPIO17 (TX2)`
- `CP2102 GND -> GND`
- do not connect `VCC`, `5V`, or `3V3` from CP2102 to ESP32
- connect CP2102 USB to the target Linux host

### Safety Rule

Any CP2102 rewiring must happen with ESP32 power removed and the USB link unplugged.

## 4. Verification Targets

1. Power-on shows the OLED splash screen and the buzzer stays idle.
2. `OK`, `Next`, and `Back` each register exactly one click per press.
3. RGB colors match state expectations: blue detect, yellow running, green success, red error.
4. Buzzer sounds only during warning/error flows and stays silent when idle.
5. In deployment mode, the Linux host helper replies with `AG:ENV:LINUX` before timeout.
6. Without the helper installed, ESP32 shows `Host helper not ready`.
