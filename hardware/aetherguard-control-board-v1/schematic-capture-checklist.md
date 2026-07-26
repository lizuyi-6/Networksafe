# Schematic Capture Checklist

## Electrical

- USB-C is sink-only with 5.1k CC resistors and no backfeed path into host VBUS.
- External 12/24V input is TVS-protected and reverse-polarity protected before the buck stage.
- USB 5V and external DC combine through a controlled OR-ing path with external DC priority.
- Interlock output is isolated and low-voltage only.
- Interlock feedback input is isolated and tolerant of the chosen field voltage.
- ATECC608C shares the I2C bus with the OLED and has valid pull-ups at 3V3.
- ESP32-S3 EN and BOOT strapping follow Espressif recommendations.

## Layout

- 4-layer stack only: Top signal / GND plane / Power plane / Bottom signal.
- Keep clear copper under the ESP32-S3 antenna zone if the WROOM variant with PCB antenna is used.
- Route USB D+/D- as a matched pair with uninterrupted ground reference.
- Keep the isolation barrier between MCU domain and interlock I/O domain explicit in silkscreen and copper.
- Place OLED, Confirm, Cancel, RGB LED, and buzzer on the user-facing edge of the enclosure.

## DFM / Bring-up

- Provide at least one accessible Tag-Connect or 1x6 service header for UART recovery.
- Expose test pads for 3V3, 5V, VIN_EXT, GND, EN, BOOT, I2C SDA, and I2C SCL.
- Mark J4 and J5 polarity on silkscreen.
- Reserve assembly option for same-footprint ESP32-S3-WROOM-1 variants with >= 8MB flash.
- Confirm OLED footprint orientation before fabrication.
