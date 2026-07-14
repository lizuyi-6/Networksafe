# Mechanical Baseline

- Board outline: `90 mm x 60 mm`
- Layer count: `4`
- Enclosure: external ABS or PC box with front access to OLED, RGB LED window, Cancel, Confirm, and rear/side access to USB-C and terminal blocks
- Mounting: `4 x M3` corner holes

## Placement Rules

- Front face: OLED, RGB LED, Cancel, Confirm, buzzer acoustic opening.
- Rear or side face: USB-C, external 12/24V terminal, interlock output terminal, interlock feedback terminal.
- Service UART header may remain internal or side-access only; it is not a user-facing connector.

## User-Facing UX

- Confirm key must be the most prominent button.
- Cancel key must be physically separated from Confirm to reduce accidental approval.
- Reset must be recessed or internal.
- The enclosure must label:
  - `USB-C Host`
  - `12/24V In`
  - `Interlock Out`
  - `Feedback In`
  - `Confirm`
  - `Cancel`
