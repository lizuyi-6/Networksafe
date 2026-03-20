# AetherGuard ESP32 Serial Deployer Bundle

This bundle contains only the code and helper files needed to deploy the ESP32 serial deployer prototype.

## Contents

- `esp32/`
  - Full ESP32 PlatformIO project copied from the repo
- `host-helper/`
  - Linux serial helper script
  - Example environment file
  - systemd service unit
- `WIRING.md`
  - Jumper wiring checklist, CP2102 mode map, logic diagram, and legend

## Wiring

See [WIRING.md](./WIRING.md) for the full jumper wiring guide, the breadboard-style prototype diagram, deployment-mode wiring, fallback flash wiring, the logic diagram, silkscreen checks, and the pre-power checklist.

## CP2102 Modes

The single external CP2102 can only serve one role at a time. Always remove power before rewiring.

Use [WIRING.md](./WIRING.md) as the source of truth for:

- deployment-mode UART2 wiring
- fallback flash/debug UART0 wiring
- `VCC` / `5V` / `3V3` disconnect rules
- the manual bootloader sequence

## Build And Flash

```bash
cd esp32
pio run -e serial_deployer_release
```

If the board USB path works, flash with your normal PlatformIO upload flow. If it does not, use the fallback CP2102 wiring in [WIRING.md](./WIRING.md).

## Experimental Compile Smoke

The `esp32/` tree also contains experimental cloud-device modules. They are not part of the active deployer runtime.

Use this only to verify that those experimental headers and dependencies still compile together:

```bash
cd esp32
pio run -e experimental_cloud_smoke
```

This smoke environment does not perform real deployment, host-helper communication, or production cloud connectivity.

## Linux Host Helper Install

1. Copy `host-helper/aetherguard-serial-helper.sh` to `/usr/local/lib/aetherguard/aetherguard-serial-helper.sh`
2. Copy `host-helper/aetherguard-serial-helper.env.example` to `/etc/AetherGuard/serial-helper.env`
3. Update `SERIAL_HELPER_DEVICE` and `AETHERGUARD_INSTALL_CMD`
4. Copy `host-helper/aetherguard-serial-helper.service` to `/etc/systemd/system/aetherguard-serial-helper.service`
5. Run:

```bash
chmod +x /usr/local/lib/aetherguard/aetherguard-serial-helper.sh
systemctl daemon-reload
systemctl enable --now aetherguard-serial-helper
```

## Verification

- `pio run -e serial_deployer_release` succeeds in `esp32/`
- `pio run -e experimental_cloud_smoke` succeeds in `esp32/`
- `bash -n host-helper/aetherguard-serial-helper.sh` succeeds
- Without the helper installed, ESP32 shows `Host helper not ready`
- After the helper is installed, ESP32 receives `AG:ENV:LINUX` and can continue to backup/install/remove flows
