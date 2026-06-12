# AetherGuard Control Board v2 — Pin Map

## ESP32-S3-WROOM-1-N8R2 GPIO Assignments

| GPIO | Net Label | Direction | Function | Sheet | Notes |
|------|-----------|-----------|----------|-------|-------|
| 0 | BOOT | Input | Boot strapping | mcu-usb-secure | 10k pull-up, hold low for download mode |
| 1 | SD_MOSI | Output | SD card SPI MOSI | rtc-storage | 10k pull-up (R25) |
| 2 | SD_MISO | Input | SD card SPI MISO | rtc-storage | 10k pull-up (R26) |
| 3 | SD_SCK | Output | SD card SPI clock | rtc-storage | 10k pull-up (R27) |
| 4 | BTN_CANCEL | Input | Cancel button | ui-panel | Active low, internal pull-up |
| 5 | BTN_CONFIRM | Input | Confirm button | ui-panel | Active low, internal pull-up |
| 6 | SD_CS | Output | SD card chip select | rtc-storage | 10k pull-up (R28), active low |
| 7 | RTC_INT | Input | PCF8563 interrupt | rtc-storage | Open-drain, 100k pull-up (R29) |
| 8 | I2C_SDA | Bidir | I2C data | mcu-usb-secure | 4.7k pull-up, shared: OLED + ATECC + RTC |
| 9 | I2C_SCL | Output | I2C clock | mcu-usb-secure | 4.7k pull-up, shared: OLED + ATECC + RTC |
| 10 | ATECC_WAKE | Output | ATECC608C wake-assist | mcu-usb-secure | Drives 2N7002 gate to pull SDA low |
| 11 | LED_R | Output | RGB LED red | ui-panel | PWM, 330R series (R18) |
| 12 | LED_G | Output | RGB LED green | ui-panel | PWM, 330R series (R19) |
| 13 | LED_B | Output | RGB LED blue | ui-panel | PWM, 330R series (R20) |
| 14 | BUZZER | Output | Passive buzzer | ui-panel | PWM drive |
| 15 | INTERLOCK_OUT | Output | Isolated interlock output | isolated-io | Drives optocoupler U7 via transistor |
| 16 | INTERLOCK_FB | Input | Isolated interlock feedback | isolated-io | Reads optocoupler U8 output |
| 17 | UART_TX | Output | Service UART transmit | mcu-usb-secure | 3.3V TTL |
| 18 | UART_RX | Input | Service UART receive | mcu-usb-secure | 3.3V TTL |
| 19 | USB_DN | Bidir | USB D- | mcu-usb-secure | Native USB, 90Ω diff pair |
| 20 | USB_DP | Bidir | USB D+ | mcu-usb-secure | Native USB, 90Ω diff pair |
| 21 | EXT_PWR_SENSE | Input | External power present | power-input | ADC, voltage divider from 5V_BUCK |

## Connectors

| Ref | Type | Pins | Function |
|-----|------|------|----------|
| J1 | USB-C (USB4110-GF-A) | 16 | Host data (CDC) + 5V power |
| J2 | Phoenix 3.5mm 2P | 2 | External DC input (12-24V) |
| J3 | Pin header 1x6 2.54mm | 6 | Service UART (3V3, GND, TX, RX, EN, BOOT) |
| J4 | Phoenix 3.5mm 2P | 2 | Interlock output (isolated) |
| J5 | Phoenix 3.5mm 2P | 2 | Interlock feedback input (isolated) |
| J6 | Micro-SD push-push | 9+1 | SD card (SPI mode) |

## I2C Bus Devices

| Address | Device | Function |
|---------|--------|----------|
| 0x3C | SSD1306 | 0.96" OLED display |
| 0x51 | PCF8563 | Real-time clock |
| 0x60 | ATECC608C | Secure element |

## Power Rails

| Rail | Source | Voltage | Max Current | Consumers |
|------|--------|---------|-------------|-----------|
| VIN_EXT | J2 terminal | 12-24V | 1A (fused) | LMR16006 input |
| VBUS | J1 USB-C | 5V | 500mA (polyfuse) | TPS2121 IN1 |
| 5V_BUCK | LMR16006 | 5V | 600mA | TPS2121 IN2, interlock opto |
| 5V_SYS | TPS2121 OUT | 5V | 600mA | AP2112K input |
| +3V3 | AP2112K | 3.3V | 600mA | ESP32-S3, ATECC, RTC, OLED, SD |

## Interlock Behavior

- Output optocoupler (U7) LED powered from 5V_BUCK
- If external DC absent → 5V_BUCK = 0V → interlock output cannot energize → **fail-closed**
- Feedback optocoupler (U8) reads external relay state
- Mismatch between commanded and sensed state triggers `interlock_fault` alert
