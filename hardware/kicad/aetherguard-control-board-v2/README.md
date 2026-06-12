# AetherGuard Control Board v2 KiCad Project

Single-host physical authorization board with RTC, SD card audit logging, and Wi-Fi/BLE.

## Changes from v1

- Added PCF8563 RTC with CR1220 battery backup (I2C 0x51, shared bus)
- Added Micro-SD card slot (SPI mode, GPIO1/2/3/6)
- Expanded ESP32-S3 symbol to expose GPIO1-3, 6-7
- Added 2x 47uF bulk capacitors on 3.3V rail for peak current headroom
- Wi-Fi/BLE enabled (ESP32-S3 PCB antenna, keepout zone preserved)

## Board Specs

- 90mm x 60mm, 4-layer FR-4, 1.6mm
- ENIG surface finish, black solder mask
- JLCPCB SMT compatible (0603 passives, LCSC parts)

## Schematic Hierarchy (5 sheets)

1. `sheets/power-input.kicad_sch` — USB-C, ESD, TPS2121, LMR16006, AP2112K
2. `sheets/mcu-usb-secure.kicad_sch` — ESP32-S3, ATECC608C, USB, UART
3. `sheets/ui-panel.kicad_sch` — OLED, RGB LED, buttons, buzzer
4. `sheets/isolated-io.kicad_sch` — Optocoupler interlock I/O
5. `sheets/rtc-storage.kicad_sch` — PCF8563 RTC + CR1220 + Micro-SD

## Key Components

| Ref | Part | Package | LCSC | Function |
|-----|------|---------|------|----------|
| U1 | ESP32-S3-WROOM-1-N8R2 | Module | — | Main MCU |
| U2 | ATECC608C-SSHDA-T | SOIC-8 | C649795 | Secure element |
| U3 | LMR16006YDDCR | SOT-23-6 | C477878 | 12/24V→5V buck |
| U4 | AP2112K-3.3TRG1 | SOT-23-5 | C51118 | 5V→3.3V LDO |
| U5 | TPS2121DRLR | DHWQFN-14 | C477879 | Power OR-ing |
| U7,U8 | VOS617A | SO-4 | C131455 | Optocouplers |
| U9 | PCF8563T/5 | SOIC-8 | C7488 | RTC |
| BT1 | CR1220 holder | SMD | C70377 | RTC battery |
| J1 | USB4110-GF-A | USB-C | — | USB connector |
| J6 | TF-115 | SMD | C393941 | Micro-SD slot |

## GPIO Assignment

| GPIO | Function | Sheet |
|------|----------|-------|
| 0 | BOOT | mcu-usb-secure |
| 1 | SD_MOSI | rtc-storage |
| 2 | SD_MISO | rtc-storage |
| 3 | SD_SCK | rtc-storage |
| 4 | Cancel button | ui-panel |
| 5 | Confirm button | ui-panel |
| 6 | SD_CS | rtc-storage |
| 7 | RTC_INT# | rtc-storage |
| 8 | I2C SDA | mcu-usb-secure |
| 9 | I2C SCL | mcu-usb-secure |
| 10 | ATECC wake | mcu-usb-secure |
| 11 | RGB LED R | ui-panel |
| 12 | RGB LED G | ui-panel |
| 13 | RGB LED B | ui-panel |
| 14 | Buzzer PWM | ui-panel |
| 15 | Interlock OUT | isolated-io |
| 16 | Interlock FB | isolated-io |
| 17 | UART TX | mcu-usb-secure |
| 18 | UART RX | mcu-usb-secure |
| 19 | USB D- | mcu-usb-secure |
| 20 | USB D+ | mcu-usb-secure |
| 21 | Ext power sense | power-input |

## Layer Stack

| Layer | Function |
|-------|----------|
| F.Cu | Signal + components |
| In1.Cu | Solid GND plane |
| In2.Cu | Power (5V/3.3V split) + signal |
| B.Cu | Signal + components |

## Validation

```powershell
$cli = 'C:\Program Files\KiCad\9.0\bin\kicad-cli.exe'
$tmp = Join-Path $env:TEMP 'ag-v2-test'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

& $cli sch erc hardware/kicad/aetherguard-control-board-v2/aetherguard-control-board-v2.kicad_sch --output "$tmp\erc.rpt"
& $cli pcb drc hardware/kicad/aetherguard-control-board-v2/aetherguard-control-board-v2.kicad_pcb --output "$tmp\drc.rpt"
```

## Manufacturing Target

JLCPCB 4-layer prototype:
- FR-4, 1.6mm, 1oz copper
- ENIG or HASL lead-free
- Black solder mask, white silkscreen
- Min trace/space: 0.15mm
- Signal via: 0.3/0.6mm drill/pad
- Power via: 0.5/1.0mm drill/pad
