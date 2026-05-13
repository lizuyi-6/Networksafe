# Requirements Document

## Introduction

The AetherGuard ESP32 Physical Confirmation Gate is a security dongle that acts as an air-gapped physical confirmation gate for dangerous server operations. Even if the server software layer is fully compromised, an attacker cannot trigger high-risk operations without a human physically present at the device. This document captures the hardware and firmware interface requirements derived from the approved hardware design, covering power supply, GPIO assignments, display, user input, status indication, audio feedback, serial communication, PCB construction, and the AG protocol.

---

## Glossary

- **AG_Protocol**: The AetherGuard serial communication protocol using `AG:REQ:*` commands and `AG:BEGIN/*`, `AG:STEP/*`, `AG:OK/*`, `AG:ERR/*` responses.
- **AMS1117**: The AMS1117-3.3 LDO linear voltage regulator used to convert 5 V USB input to 3.3 V.
- **BOM**: Bill of Materials — the complete list of components required to manufacture the PCB.
- **Buzzer**: The active buzzer module (3.3 V, low-level triggered, 85 dB) driven via NPN transistor Q1.
- **CH340C**: The onboard USB-to-Serial bridge IC that connects USB-C to UART0 (GPIO1/GPIO3).
- **DRC**: Design Rule Check — the automated verification of PCB layout against manufacturing constraints.
- **ESP32**: The ESP32-WROOM-32E module (240 MHz dual-core, 4 MB Flash, 520 KB SRAM) acting as the main controller.
- **Firmware**: The embedded software running on the ESP32, configured via `config.h` macros.
- **Gerber**: The industry-standard PCB fabrication file format required by PCB manufacturers.
- **GPIO**: General Purpose Input/Output pin on the ESP32.
- **I2C**: Inter-Integrated Circuit bus used to communicate with the OLED display at 400 kHz.
- **J1**: The 4-pin 2.54 mm header exposing UART2 (GND, RX2, TX2, 3.3 V) for the deployment link.
- **JLC**: JLCPCB — the target PCB manufacturer whose design rules govern minimum trace widths, via sizes, and surface finish options.
- **LDO**: Low-Dropout linear voltage regulator.
- **OLED**: The SSD1306 0.96-inch 128×64 I2C display module used for user-facing status output.
- **PCB**: Printed Circuit Board — the physical substrate on which all components are mounted.
- **RGB_LED**: The common-cathode RGB LED (5 mm through-hole or 0805 SMD) used for status colour indication.
- **UART0**: Universal Asynchronous Receiver/Transmitter port 0 (GPIO1/GPIO3), used for debug and firmware flashing via CH340C.
- **UART2**: Universal Asynchronous Receiver/Transmitter port 2 (GPIO16/GPIO17), used as the deployment link to the host machine.

---

## Requirements

### Requirement 1: Power Supply

**User Story:** As a hardware engineer, I want a stable 3.3 V power rail derived from USB 5 V input, so that the ESP32 and all peripherals operate within their rated voltage range under all load conditions.

#### Acceptance Criteria

1. THE AMS1117 SHALL accept a USB input voltage in the range 4.5 V–5.5 V and produce a regulated 3.3 V output.
2. WHEN the USB input voltage is within 4.5 V–5.5 V, THE AMS1117 SHALL maintain the 3.3 V output rail within ±5% (3.135 V–3.465 V).
3. THE PCB SHALL place a 100 µF/10 V electrolytic capacitor on the 5 V input rail for bulk filtering.
4. THE PCB SHALL place a 10 µF electrolytic capacitor and a 100 nF MLCC capacitor on the 3.3 V output rail for filtering.
5. THE PCB SHALL place one 100 nF MLCC decoupling capacitor at each ESP32 VCC pin, with trace length less than 5 mm.
6. THE PCB SHALL place one 10 µF MLCC decoupling capacitor within 10 mm of the ESP32 module to handle Wi-Fi transmit current transients.
7. WHEN the ESP32 Wi-Fi transmitter is active, THE power rail SHALL remain within the ±5% tolerance defined in criterion 2.
8. THE AMS1117 SHALL be rated for a continuous output current of at least 1 A to accommodate the peak system load of at least 610 mA.
9. IF the USB input voltage falls below 4.5 V or rises above 5.5 V, THE system SHALL not guarantee regulated 3.3 V output and the ESP32 may reset or behave unpredictably.

---

### Requirement 2: ESP32 Main Controller

**User Story:** As a firmware engineer, I want the ESP32-WROOM-32E module to be the sole main controller, so that I can use the PlatformIO ecosystem and the established firmware codebase without hardware changes.

#### Acceptance Criteria

1. THE PCB SHALL use the ESP32-WROOM-32E (4 MB Flash) as the main controller.
2. THE PCB SHALL expose a BOOT button connected to GPIO0 (active-low, pulls GPIO0 to GND) to enable firmware download mode.
3. THE PCB SHALL expose an EN/RESET button connected to the EN pin (active-low); pressing EN/RESET SHALL cause the ESP32 to restart and re-execute firmware from boot.
4. THE Firmware SHALL define GPIO assignments as macros where each macro resolves to the physical GPIO number matching the PCB schematic pin assignments exactly.
5. WHEN the BOOT button is held during power-on, THE ESP32 SHALL enter firmware download mode via UART0, indicated by the ROM bootloader prompt appearing on UART0 within 5 seconds and a serial flashing tool being able to connect.

---

### Requirement 3: UART0 Debug and Flash Interface

**User Story:** As a firmware engineer, I want an onboard USB-Serial bridge for UART0, so that I can flash firmware and read debug output without an external USB-TTL adapter.

#### Acceptance Criteria

1. THE PCB SHALL integrate a CH340C USB-to-Serial bridge connecting USB-C D+/D− to GPIO1 (UART0 TX) and GPIO3 (UART0 RX).
2. THE CH340C SHALL be powered from the 3.3 V rail with a 100 nF MLCC decoupling capacitor placed within 1 mm of the CH340C power pin.
3. THE PCB SHALL route USB D+ and D− as a differential pair with equal-length traces (±0.1 mm tolerance) and 0.2 mm spacing, avoiding right-angle bends.
4. THE Firmware SHALL configure UART0 at 115200 baud, 8N1, 3.3 V TTL logic level for debug output.
5. WHEN a host computer connects via USB-C, THE CH340C SHALL enumerate as a USB CDC serial device, forwarding host-to-device data to GPIO3 (UART0 RX) and forwarding GPIO1 (UART0 TX) data to the host.
6. THE PCB SHALL include an auto-reset circuit connecting RTS to EN and DTR to GPIO0 each via a 100 nF capacitor, so that a serial flashing tool can reset the ESP32 into download mode without manual button presses.

---

### Requirement 4: UART2 Deployment Link

**User Story:** As a system integrator, I want a dedicated UART2 header for the AG protocol deployment link, so that the host machine can send operation requests and receive responses independently of the debug interface.

#### Acceptance Criteria

1. THE PCB SHALL expose a 4-pin 2.54 mm header J1 with pins ordered: GND, GPIO16 (RX2), GPIO17 (TX2), 3.3 V reference.
2. THE Firmware SHALL configure UART2 at 115200 baud, 8N1, 3.3 V TTL logic level.
3. THE J1 header SHALL NOT provide 5 V on any pin, to prevent reverse-powering the ESP32 from an external source.
4. WHEN a host machine transmits an `AG:REQ:*` message (newline-terminated) on J1, THE Firmware SHALL receive all bytes up to and including the newline terminator without loss at 115200 baud with trace length less than 100 mm.
5. WHEN the Firmware transmits an `AG:BEGIN/*`, `AG:STEP/*`, `AG:OK/*`, or `AG:ERR/*` response on UART2, THE host machine SHALL receive the complete newline-terminated frame without truncation.
6. THE PCB SHALL provide test points TP3 (GPIO16/RX2) and TP4 (GPIO17/TX2) for production verification of the UART2 deployment link.
7. IF the Firmware receives an unrecognised message on UART2 (not matching any `AG:REQ:*` pattern), THE Firmware SHALL discard the message and SHALL NOT transmit any response.

---

### Requirement 5: AG Protocol

**User Story:** As a security engineer, I want the ESP32 to implement the AG protocol over UART2, so that the host machine can request dangerous operations and the device can enforce physical human confirmation before authorising them.

#### Acceptance Criteria

1. WHEN the Firmware receives `AG:REQ:ENV`, THE Firmware SHALL respond with `AG:ENV:LINUX` to confirm the host environment.
2. WHEN the Firmware receives `AG:REQ:BACKUP`, THE Firmware SHALL respond with `AG:BEGIN:BACKUP`, followed by one or more `AG:STEP:<percent>` messages where `<percent>` is an integer in the range 0–100, and finally `AG:OK:BACKUP` upon completion; IF the backup operation fails, THE Firmware SHALL respond with `AG:ERR:BACKUP` instead of `AG:OK:BACKUP`.
3. WHEN the Firmware receives `AG:REQ:INSTALL`, THE Firmware SHALL display the operation name on the OLED and wait for the user to press the OK button before responding with `AG:BEGIN:INSTALL`.
4. WHEN the Firmware receives `AG:REQ:REMOVE`, THE Firmware SHALL display the operation name on the OLED and wait for the user to press the OK button before responding with `AG:BEGIN:REMOVE`.
5. IF the user presses the Back button during a pending `AG:REQ:REMOVE` confirmation, THEN THE Firmware SHALL respond with `AG:ERR:REMOVE` and cancel the operation.
6. IF the user presses the Back button during a pending `AG:REQ:INSTALL` confirmation, THEN THE Firmware SHALL respond with `AG:ERR:INSTALL` and cancel the operation.
7. WHEN the Firmware receives any `AG:REQ:*` message (newline-terminated), THE Firmware SHALL parse the complete message before generating any response; IF a second `AG:REQ:*` message arrives while a confirmation is already pending, THE Firmware SHALL respond with `AG:ERR:BUSY` and discard the second request.
8. THE Firmware SHALL NOT authorise any INSTALL or REMOVE operation without a physical OK button press on the device registered after the corresponding request was received.

---

### Requirement 6: OLED Display

**User Story:** As a user, I want an OLED display showing operation status and confirmation prompts, so that I can understand what action is being requested and make an informed decision before pressing a button.

#### Acceptance Criteria

1. THE PCB SHALL connect the SSD1306 OLED module to GPIO21 (SDA) and GPIO22 (SCL) via I2C.
2. THE PCB SHALL place 4.7 kΩ pull-up resistors on both SDA and SCL lines to the 3.3 V rail.
3. THE Firmware SHALL configure the I2C bus at 400 kHz (Fast Mode) with `DISPLAY_I2C_CLOCK_HZ = 400000`.
4. THE OLED SHALL use I2C address 0x3C (SA0 pin tied to GND on the module).
5. WHEN an `AG:REQ:*` message requiring confirmation is received, THE Firmware SHALL display the operation name and the text "CONFIRM?" on the OLED within 500 ms; IF no button is pressed within 60 seconds, THE Firmware SHALL auto-cancel the operation, respond with `AG:ERR:<operation>`, and revert the OLED to idle state.
6. WHEN an operation completes, THE Firmware SHALL update the OLED to display the result status (OK or ERR) for at least 5 seconds before reverting to idle state.
7. THE PCB SHALL position the OLED connector within 10 mm of the board edge to allow an enclosure window cutout.
8. THE PCB SHALL route I2C SDA and SCL as parallel traces with spacing ≥ 0.2 mm and total length < 50 mm.

---

### Requirement 7: User Input Buttons

**User Story:** As a user, I want three tactile buttons (OK, Next, Back) for navigating confirmation prompts, so that I can approve, cycle through options, or reject a requested operation.

#### Acceptance Criteria

1. THE PCB SHALL connect the OK button to GPIO18, the Next button to GPIO19, and the Back button to GPIO23.
2. THE Firmware SHALL configure GPIO18, GPIO19, and GPIO23 as `INPUT_PULLUP`, with the button connecting the GPIO to GND when pressed.
3. THE PCB SHALL NOT use GPIO0, GPIO2, GPIO5, GPIO12, or GPIO15 for user buttons, to avoid interference with ESP32 strapping pins during boot.
4. THE PCB SHALL space the three user buttons at least 10 mm apart to prevent accidental simultaneous activation.
5. WHEN a button is pressed, THE Firmware SHALL place exactly one discrete button event (identifying OK, Next, or Back) into the button event queue; all GPIO transitions on that button within the following 50 ms SHALL be ignored; a continuously held button SHALL NOT generate repeat events.
6. THE application layer SHALL read discrete button identifiers (OK, Next, Back) from the button event queue in the order they were received.
7. WHEN one button is pressed, THE GPIO voltage on the other two unpressed button lines SHALL remain at or above 2.8 V (no cross-talk).
8. THE buttons SHALL be rated for a minimum of 100,000 actuation cycles.

---

### Requirement 8: RGB LED Status Indicator

**User Story:** As a user, I want an RGB LED that shows the current device state through distinct colours, so that I can immediately understand the device status at a glance.

#### Acceptance Criteria

1. THE PCB SHALL connect the RGB LED red anode to GPIO25, green anode to GPIO26, and blue anode to GPIO27, with the common cathode connected to GND.
2. THE Firmware SHALL configure `RGB_COMMON_ANODE = 0` (value 0 = common-cathode: high level on a channel pin illuminates that channel).
3. THE PCB SHALL place a 150 Ω current-limiting resistor in series with the red channel (targeting 10 mA at Vf ≈ 2.0 V).
4. THE PCB SHALL place a 33 Ω current-limiting resistor in series with each of the green and blue channels (targeting 10 mA at Vf ≈ 3.0 V).
5. WHEN the Firmware calls `setColor(color)` with a defined `LEDColor` enum value, THE RGB_LED SHALL display exactly the colour specified by the following mapping with no intermediate states:

   | LEDColor enum value | GPIO25 (Red) | GPIO26 (Green) | GPIO27 (Blue) |
   |---------------------|:------------:|:--------------:|:-------------:|
   | IDLE                | LOW          | LOW            | HIGH          |
   | PENDING             | HIGH         | HIGH           | LOW           |
   | OK                  | LOW          | HIGH           | LOW           |
   | ERROR               | HIGH         | LOW            | LOW           |
   | BUSY                | HIGH         | LOW            | HIGH          |

6. IF a colour channel is not required to be HIGH by the mapping in criterion 5 for the given `LEDColor` value, THEN that channel SHALL be LOW.
7. THE PCB SHALL position the RGB LED within 10 mm of the board edge to allow an enclosure aperture.
8. WHEN the Firmware calls `setBlink(color, onMs, offMs)`, THE RGB_LED SHALL alternate between the colour defined in criterion 5 and all channels OFF, with the on-phase lasting `onMs` milliseconds (±10%) and the off-phase lasting `offMs` milliseconds (±10%).
9. THE Firmware SHALL map device states to LED colours as follows: idle → IDLE (blue); awaiting confirmation → PENDING (yellow, blinking 500 ms on / 500 ms off); operation in progress → BUSY (magenta); operation succeeded → OK (green, 3 s solid); operation failed or rejected → ERROR (red, 3 s solid).

---

### Requirement 9: Buzzer Audio Feedback

**User Story:** As a user, I want audible feedback from the buzzer when operations start, complete, or are rejected, so that I receive confirmation of device actions without needing to watch the display.

#### Acceptance Criteria

1. THE PCB SHALL drive the active buzzer via an NPN transistor (S8050 or 2N2222) with the collector connected to the buzzer negative terminal and the emitter connected to GND.
2. THE PCB SHALL connect GPIO14 to the NPN base through a 1 kΩ current-limiting resistor.
3. THE PCB SHALL connect the buzzer positive terminal to the 3.3 V rail.
4. THE PCB SHALL place a 1N4148 flyback diode in parallel with the buzzer to suppress inductive back-EMF.
5. THE Firmware SHALL configure `PIN_BUZZER = 14` and `BUZZER_ACTIVE_LEVEL = LOW` (GPIO14 low → transistor conducts → buzzer sounds).
6. WHEN the Firmware activates the buzzer, THE buzzer SHALL produce an audible tone of at least 85 dB measured at 10 cm from the buzzer; each tone pulse SHALL last between 50 ms and 2000 ms.
7. THE buzzer circuit SHALL NOT draw more than 30 mA through GPIO14 at any time; the NPN transistor SHALL handle the full buzzer current.
8. THE Firmware SHALL produce the following distinct buzzer patterns for each event: operation started (AG:BEGIN received) → 1 pulse of 100 ms; operation completed successfully (AG:OK) → 2 pulses of 100 ms with 100 ms gap; operation rejected or failed (AG:ERR) → 3 pulses of 100 ms with 100 ms gaps.

---

### Requirement 10: PCB Physical Construction

**User Story:** As a hardware engineer, I want the PCB to conform to defined mechanical and manufacturing specifications, so that it can be fabricated by JLC, fits a standard enclosure, and passes design rule checks.

#### Acceptance Criteria

1. THE PCB SHALL use FR-4 substrate with Tg ≥ 130 °C and 1.6 mm board thickness.
2. THE PCB SHALL be a 2-layer board: top layer for signals, bottom layer as a continuous GND plane.
3. THE PCB SHALL have outer dimensions of 80 mm × 55 mm with R2 mm corner radii.
4. THE PCB SHALL use 1 oz (35 µm) copper weight on both layers.
5. THE PCB SHALL apply either HASL (lead-free) or ENIG surface finish (one finish selected per production run), with either green or black solder mask and white silkscreen on both sides.
6. THE PCB SHALL have minimum trace width/spacing of 0.15 mm / 0.15 mm to comply with JLC standard process rules.
7. THE PCB SHALL use a minimum via drill diameter of 0.3 mm with a 0.6 mm pad for signal vias, and 0.5 mm drill with a 1.0 mm pad for power vias.
8. THE PCB SHALL pass JLC DRC with zero violations before Gerber files are submitted for fabrication.
9. THE PCB SHALL carry white silkscreen labels on all connectors, test points, and the following polarity-sensitive components: C1, C2, C7, D2, LED1, BZ1, Q1, U3.
10. ALL component courtyard areas and board edge copper SHALL maintain a minimum clearance of 0.25 mm from the board edge to prevent JLC DRC violations.

---

### Requirement 11: PCB Layout Rules

**User Story:** As a PCB designer, I want defined layout and routing rules, so that signal integrity, power integrity, and EMC requirements are met without requiring a 4-layer board.

#### Acceptance Criteria

1. THE PCB SHALL route power traces on the 3.3 V rail at ≥ 0.5 mm width and the 5 V USB input trace at ≥ 1.0 mm width.
2. THE PCB SHALL route all signal traces (I2C, UART, GPIO) at 0.2 mm width.
3. THE PCB SHALL flood-fill the bottom layer with GND copper and flood-fill GND on the top layer in areas not occupied by signal traces.
4. THE PCB SHALL place the AMS1117-3.3 within 5 mm of the USB-C connector with its exposed thermal pad connected to the bottom GND plane via thermal vias.
5. THE PCB SHALL place the CH340C within 10 mm of the USB-C connector with USB D+/D− routed as a differential pair with equal-length traces (±0.5 mm), 0.2 mm spacing, and no right-angle bends.
6. THE PCB SHALL place the OLED connector within 10 mm of the board edge.
7. THE PCB SHALL place the three user buttons within 5 mm of the board edge with ≥ 10 mm spacing between adjacent buttons.
8. THE PCB SHALL place the RGB LED within 5 mm of the board edge.
9. THE PCB SHALL place the buzzer at least 20 mm from the OLED and at least 20 mm from the nearest user button to minimise mechanical vibration interference.

---

### Requirement 12: Production Test Points

**User Story:** As a production test engineer, I want labelled test points on the PCB for all critical nets, so that I can verify power, ground, and serial signals during manufacturing test without probing component leads.

#### Acceptance Criteria

1. THE PCB SHALL expose test point TP1 as an unpopulated through-hole or SMD pad with a minimum exposed copper diameter of 1.0 mm on the 3.3 V net for power voltage verification.
2. THE PCB SHALL expose test point TP2 as an unpopulated through-hole or SMD pad with a minimum exposed copper diameter of 1.0 mm on the GND net as a reference.
3. THE PCB SHALL expose test point TP3 as an unpopulated through-hole or SMD pad with a minimum exposed copper diameter of 1.0 mm on GPIO16 (UART2 RX) for deployment link signal verification.
4. THE PCB SHALL expose test point TP4 as an unpopulated through-hole or SMD pad with a minimum exposed copper diameter of 1.0 mm on GPIO17 (UART2 TX) for deployment link signal verification.
5. THE PCB SHALL expose test point TP5 as an unpopulated through-hole or SMD pad with a minimum exposed copper diameter of 1.0 mm on GPIO1 (UART0 TX) for debug serial output verification.
6. THE PCB SHALL expose test point TP6 as an unpopulated through-hole or SMD pad with a minimum exposed copper diameter of 1.0 mm on GPIO3 (UART0 RX) for debug serial input verification.
7. THE PCB SHALL label all test points with their net name in the silkscreen layer, with the label placed within 2 mm of the pad and not obscured by component courtyard areas.

---

### Requirement 13: Bill of Materials Completeness

**User Story:** As a procurement engineer, I want a complete and accurate BOM with JLC part numbers, so that all components can be sourced and the board can be assembled without manual part lookup.

#### Acceptance Criteria

1. THE BOM SHALL include every component with the following six columns: reference designator, description, value/model, quantity, package, and JLC part number.
2. THE BOM SHALL specify the ESP32-WROOM-32E (4 MB Flash) as U1.
3. THE BOM SHALL specify the CH340C in SOP-16 package as U2.
4. THE BOM SHALL specify the AMS1117-3.3 in SOT-223 package as U3.
5. THE BOM SHALL specify the 1N4148 flyback diode in SOD-123 package as D2.
6. THE BOM SHALL specify all passive resistors (R1–R6) in 0402 package and all capacitors (C1–C8) in the packages defined in design section 2.9 (C1, C2: radial electrolytic; C3–C6, C8: 0402 MLCC; C7: 0805 MLCC).
7. THE BOM SHALL include entries for Q1 (NPN transistor, SOT-23), D1 (SSD1306 OLED module), BZ1 (active buzzer, through-hole), J1 (4-pin 2.54 mm header), J2 (USB Type-C 16P), and LED1 (common-cathode RGB LED).
8. IF the BOM is imported into JLC's assembly service and a line item's JLC part number is not found in JLC's current stock, THEN that line item SHALL be flagged as a sourcing failure requiring manual resolution before order placement.

---

### Requirement 14: Firmware–Hardware Pin Consistency

**User Story:** As a firmware engineer, I want the `config.h` macro definitions to exactly match the PCB pin assignments, so that firmware compiled against `config.h` operates correctly on the manufactured board without any manual pin remapping.

#### Acceptance Criteria

1. THE Firmware `config.h` SHALL define `PIN_I2C_SDA = 21`, `PIN_I2C_SCL = 22`.
2. THE Firmware `config.h` SHALL define `PIN_BTN_OK = 18`, `PIN_BTN_NEXT = 19`, `PIN_BTN_BACK = 23`.
3. THE Firmware `config.h` SHALL define `PIN_RGB_RED = 25`, `PIN_RGB_GREEN = 26`, `PIN_RGB_BLUE = 27`.
4. THE Firmware `config.h` SHALL define `RGB_COMMON_ANODE = 0` (value 0 indicates common-cathode configuration).
5. THE Firmware `config.h` SHALL define `PIN_BUZZER = 14` and `BUZZER_ACTIVE_LEVEL = 0` (value 0 = logic-low active).
6. THE Firmware `config.h` SHALL define `TARGET_RX_PIN = 16`, `TARGET_TX_PIN = 17`, `TARGET_BAUD = 115200`.
7. THE Firmware `config.h` SHALL define all 14 macros listed in criteria 1–6; IF any macro is absent, THE firmware build SHALL fail with a compile-time error.
8. WHEN the PCB schematic pin assignments are changed, THE Firmware `config.h` SHALL be updated to match before the next release firmware build is compiled.
