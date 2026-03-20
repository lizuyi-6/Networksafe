# ADR: ESP32 Jumper-Prototype Wiring Baseline

- Date: 2026-03-14
- Status: Accepted

## Context

The current firmware already uses the fixed host-helper protocol over `Serial2`, but the recent docs drifted toward a future single-board, dual-bridge hardware design. That no longer matches the actual hardware available for the prototype build: one ESP32 development board, one external CP2102, jumper wires, breadboard modules, and no custom PCB.

## Decision

Fix the v1 hardware baseline to a jumper-wire prototype:

- keep the current GPIO map
- keep the current `AG:REQ:*` plus `AG:*` helper protocol
- use a single external CP2102 that switches between flash/debug fallback and deployment mode
- prefer the ESP32 board USB port for flashing whenever available
- treat the buzzer module as active-low

## Consequences

### Positive

- matches the real hardware on hand
- removes the false dual-bridge / single-board assumption from the docs
- keeps the firmware protocol and local UI flow intact

### Negative

- the single CP2102 cannot serve two roles at once
- operators must power down before moving the CP2102 between modes

### Neutral

- Linux hosts still need the serial helper installed once
- the OLED, button, RGB, and UART2 pin assignments stay unchanged

## References

- `esp32/src/config.h`
- `esp32/src/hardware_ctrl.h`
- `docs/esp32-serial-host-helper.md`
- `docs/plans/2026-03-14-esp32-serial-deployer-wiring-design.md`
