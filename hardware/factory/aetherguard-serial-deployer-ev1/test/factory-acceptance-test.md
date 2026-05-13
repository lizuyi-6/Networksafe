# EV1 Factory Acceptance Test

Status: `engineering-prototype-draft`

Run this test on every assembled engineering prototype.

## Equipment

- Current-limited USB power source.
- Known-good USB-C data cable.
- Linux or Windows host for USB enumeration.
- Linux target host with AetherGuard helper test script.
- Multimeter.
- Serial terminal at 115200 baud.
- Firmware built with `serial_deployer_pcb_v1`.

## Incoming Inspection

| Step | Check | Pass criteria |
| --- | --- | --- |
| 1 | Visual inspection | No missing parts, reversed polarized parts, bridges, or damaged connectors. |
| 2 | 5V to GND resistance | No short, value above factory threshold. |
| 3 | 3V3 to GND resistance | No short, value above factory threshold. |
| 4 | USB-C shell and pigtail strain relief | Mechanically secure. |
| 5 | Enclosure fit | No interference, no stuck buttons, USB-C accessible. |

## Power-On Electrical Test

| Step | Check | Pass criteria |
| --- | --- | --- |
| 1 | Current-limited first power | No over-current trip. |
| 2 | 3V3 regulator output | 3.20-3.40 V. |
| 3 | Power LED | On if populated. |
| 4 | Service CP2102N USB enumeration | One serial device appears on rear USB-C. |
| 5 | Target CP2102N USB enumeration | One serial device appears through target pigtail when connected. |

## Firmware Test

| Step | Check | Pass criteria |
| --- | --- | --- |
| 1 | Flash firmware | `platformio run -e serial_deployer_pcb_v1 -t upload` succeeds. |
| 2 | Boot display | OLED shows AetherGuard boot/status screen. |
| 3 | Buttons | OK, NEXT, BACK each register one click. |
| 4 | RGB LED | Red, green, blue, and yellow status states are visible. |
| 5 | Buzzer | Buzzer sounds when firmware requests alert, active level HIGH. |
| 6 | Service serial | Logs visible on rear USB-C serial interface. |
| 7 | Target serial | Target UART communicates at 115200 baud. |

## Protocol Smoke Test

Minimum pass sequence:

```text
Gate -> Host: AG:REQ:ENV
Host -> Gate: AG:ENV:LINUX
```

Full engineering acceptance sequence:

```text
ENV -> BACKUP -> INSTALL -> REMOVE
```

or:

```text
ENV -> BACKUP -> INSTALL -> ROLLBACK
```

## Failure Recording

For each failure record:

- Unit serial number.
- PCB revision.
- Firmware git commit or build identifier.
- Test step.
- Observed behavior.
- Photo if mechanical or soldering related.
- Serial log if firmware or helper related.
