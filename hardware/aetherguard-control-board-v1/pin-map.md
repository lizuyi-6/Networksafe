# Pin Map

## MCU Assignment

| Function | ESP32-S3 Signal | Notes |
|---|---|---|
| USB D+ | GPIO20 / USB_D+ | Native USB to host |
| USB D- | GPIO19 / USB_D- | Native USB to host |
| OLED SDA | GPIO8 | Shared I2C bus |
| OLED SCL | GPIO9 | Shared I2C bus |
| ATECC608C SDA | GPIO8 | Same I2C bus as OLED |
| ATECC608C SCL | GPIO9 | Same I2C bus as OLED |
| ATECC608C WAKE | GPIO10 | Optional dedicated wake |
| RGB LED R | GPIO11 | PWM capable |
| RGB LED G | GPIO12 | PWM capable |
| RGB LED B | GPIO13 | PWM capable |
| Buzzer PWM | GPIO14 | Passive buzzer drive |
| Cancel key | GPIO4 | Active low with pull-up |
| Confirm key | GPIO5 | Active low with pull-up |
| Reset key | EN / dedicated reset | Not part of approval UX |
| Interlock OUT | GPIO15 | Drives isolated output transistor stage |
| Interlock FB | GPIO16 | Reads isolated feedback input |
| UART TXD | GPIO17 | Service UART |
| UART RXD | GPIO18 | Service UART |

## Connector Mapping

| Connector | Pins | Signals |
|---|---|---|
| J1 USB-C | USB2.0 + VBUS + GND + CC | Host CDC-CTRL / CDC-LOG + 5V input |
| J2 External DC | 2 | VIN_EXT, GND |
| J3 Service Header | 6 | 3V3, GND, TXD, RXD, EN, BOOT |
| J4 Interlock Out | 2 | ISO_OUT+, ISO_OUT- |
| J5 Feedback In | 2 | ISO_FB+, ISO_FB- |

## Fixed Rules

- Do not move USB D+/D- off the native USB pins.
- Keep I2C bus at 3V3 only.
- Keep interlock output and feedback on isolated domains; no direct connection to host USB ground beyond the isolation barrier.
- Confirm key remains the only user-facing approval key. Reset and BOOT stay maintenance-only.
