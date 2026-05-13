# EV1 Firmware Flash Guide

Firmware profile: `serial_deployer_pcb_v1`

## Build

From the repository root:

```powershell
cd esp32
platformio run -e serial_deployer_pcb_v1
```

## Flash

Connect the rear USB-C service/debug port and run:

```powershell
cd esp32
platformio run -e serial_deployer_pcb_v1 -t upload
```

If auto-download fails, use the BOOT/RESET buttons according to ESP32 flashing procedure.

## Monitor

```powershell
cd esp32
platformio device monitor -e serial_deployer_pcb_v1 -b 115200
```

## PCB Profile Requirements

The PlatformIO profile sets:

```text
AG_HW_PROFILE_PCB_V1=1
BUZZER_ACTIVE_LEVEL=HIGH
```

Do not flash the jumper prototype profile to EV1 production samples unless explicitly debugging a polarity issue.

## Factory Smoke Command

After flashing, connect the target pigtail to a Linux helper test host and confirm:

```text
AG:REQ:ENV -> AG:ENV:LINUX
```

