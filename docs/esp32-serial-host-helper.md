# AetherGuard ESP32 Serial Host Helper

The ESP32 serial deployer no longer writes arbitrary shell commands to the host serial link. It sends a fixed allow-list request set instead:

- `AG:REQ:ENV`
- `AG:REQ:BACKUP`
- `AG:REQ:INSTALL`
- `AG:REQ:REMOVE`

The Linux host-side helper maps those requests to local commands and returns the existing `AG:BEGIN`, `AG:STEP`, `AG:OK`, and `AG:ERR` markers expected by the firmware.

## Jumper Prototype Assumption

This helper assumes the breadboard prototype is already in deployment mode:

- external CP2102 `TXD/RXD/GND` wired to `GPIO16/GPIO17/GND`
- CP2102 USB connected to the target Linux host
- CP2102 `VCC`, `5V`, and `3V3` left disconnected from the ESP32 board

If the same CP2102 is temporarily used for flash/debug fallback, power off first and move it back to `GPIO3/GPIO1/GND` only for the flashing step.

## Install

1. Copy [aetherguard-serial-helper.sh](../deployment/production/aetherguard-serial-helper.sh) to `/usr/local/lib/aetherguard/aetherguard-serial-helper.sh`
2. Copy [aetherguard-serial-helper.env.example](../deployment/production/aetherguard-serial-helper.env.example) to `/etc/AetherGuard/serial-helper.env`
3. Update `SERIAL_HELPER_DEVICE` and `AETHERGUARD_INSTALL_CMD`
4. Copy [aetherguard-serial-helper.service](../deployment/production/aetherguard-serial-helper.service) to `/etc/systemd/system/aetherguard-serial-helper.service`
5. Run:

```bash
chmod +x /usr/local/lib/aetherguard/aetherguard-serial-helper.sh
systemctl daemon-reload
systemctl enable --now aetherguard-serial-helper
```

## Notes

- The helper is Linux-only.
- The ESP32 reports `Host helper not ready` if the serial helper does not answer the environment probe in time.
- `INSTALL` is intentionally not hard-coded in firmware anymore; the operator configures it on the host through `/etc/AetherGuard/serial-helper.env`.
