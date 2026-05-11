# Implementation Plan: AetherGuard ESP32 Physical Confirmation Gate

## Overview

This plan covers the full hardware design lifecycle and firmware hardening for the AetherGuard ESP32 Physical Confirmation Gate. The firmware skeleton already exists in `deployment/esp32-serial-deployer-bundle/esp32/src/`; tasks focus on closing the gaps between the current implementation and the requirements, producing all hardware design artifacts (schematic, PCB, BOM, Gerbers), and verifying correctness through property-based tests and bring-up checks.

Work is split into five tracks that can partially overlap:
- **Track A** — Hardware design artifacts (schematic → PCB → BOM → Gerbers/DRC)
- **Track B** — Firmware `config.h` audit and compile-time guards
- **Track C** — Firmware module hardening (UART2/AG protocol, button handler, OLED UI, RGB LED, buzzer)
- **Track D** — Property-based tests (Properties 2–6 from the design)
- **Track E** — Hardware bring-up verification scripts

---

## Tasks

- [x] 1. Schematic capture — power supply and ESP32 core
  - [x] 1.1 Draw USB-C input, AMS1117-3.3 LDO, and decoupling network
    - Create schematic sheet in KiCad (or equivalent EDA tool) under `hardware/aetherguard-gate/`
    - Place J2 (USB Type-C 16P), AMS1117-3.3 (SOT-223), C1 (100 µF/10 V electrolytic), C2 (10 µF electrolytic), and 100 nF MLCC on 3.3 V output rail
    - Wire 5 V input rail (≥ 1.0 mm trace annotation) and 3.3 V output rail (≥ 0.5 mm trace annotation)
    - Add auto-reset circuit: RTS → EN via 100 nF cap, DTR → GPIO0 via 100 nF cap (Requirement 3.6)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.8, 3.6_

  - [x] 1.2 Place ESP32-WROOM-32E module with decoupling array
    - Add U1 (ESP32-WROOM-32E 4 MB) symbol and footprint
    - Place four 100 nF MLCC caps (C3–C6) at each VCC pin with trace-length annotation < 5 mm
    - Place one 10 µF MLCC (C7, 0805) within 10 mm of module for Wi-Fi transient decoupling
    - Add BOOT button (SW4, GPIO0 → GND) and EN/RESET button (SW5, EN → GND)
    - _Requirements: 1.5, 1.6, 2.1, 2.2, 2.3_

- [x] 2. Schematic capture — communication interfaces
  - [x] 2.1 Draw CH340C USB-Serial bridge (UART0)
    - Place U2 (CH340C, SOP-16) connected to USB-C D+/D− and GPIO1/GPIO3
    - Add C8 (100 nF MLCC) within 1 mm of CH340C VCC pin
    - Annotate USB D+/D− as differential pair with equal-length traces (±0.1 mm) and 0.2 mm spacing, no right-angle bends
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [x] 2.2 Draw UART2 deployment link header J1
    - Place J1 (4-pin 2.54 mm header) with pin order: GND, GPIO16 (RX2), GPIO17 (TX2), 3.3 V reference
    - Confirm no 5 V pin on J1
    - Add test points TP3 (GPIO16) and TP4 (GPIO17) as SMD pads (≥ 1.0 mm exposed copper)
    - _Requirements: 4.1, 4.3, 4.6_

- [x] 3. Schematic capture — user interface peripherals
  - [x] 3.1 Draw SSD1306 OLED I2C interface
    - Place D1 (SSD1306 0.96" module connector), R1 (4.7 kΩ SDA pull-up, 0402), R2 (4.7 kΩ SCL pull-up, 0402)
    - Wire GPIO21 → SDA, GPIO22 → SCL; annotate I2C address 0x3C (SA0 tied to GND)
    - Annotate I2C traces as parallel pair, spacing ≥ 0.2 mm, length < 50 mm
    - _Requirements: 6.1, 6.2, 6.4, 6.8_

  - [x] 3.2 Draw three user buttons (OK, Next, Back)
    - Place SW1 (OK, GPIO18), SW2 (Next, GPIO19), SW3 (Back, GPIO23) as 6×6 mm tactile switches to GND
    - Confirm none use strapping pins (GPIO0/2/5/12/15)
    - Annotate INPUT_PULLUP — no external pull-up resistors needed
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 3.3 Draw RGB LED circuit and buzzer circuit
    - Place LED1 (common-cathode RGB): GPIO25 → R3 (150 Ω, 0402) → red anode; GPIO26 → R4 (33 Ω, 0402) → green anode; GPIO27 → R5 (33 Ω, 0402) → blue anode; common cathode → GND
    - Place BZ1 (active buzzer), Q1 (S8050/2N2222, SOT-23), R6 (1 kΩ, 0402 base resistor), D2 (1N4148, SOD-123 flyback diode)
    - Wire GPIO14 → R6 → Q1 base; Q1 collector → BZ1 negative; Q1 emitter → GND; 3.3 V → BZ1 positive; D2 across BZ1
    - _Requirements: 8.1, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4_

- [ ] 4. Schematic capture — test points and production aids
  - [x] 4.1 Add all six test points and silkscreen labels
    - Place TP1 (3.3 V), TP2 (GND), TP3 (GPIO16/RX2), TP4 (GPIO17/TX2), TP5 (GPIO1/UART0 TX), TP6 (GPIO3/UART0 RX) as SMD pads with ≥ 1.0 mm exposed copper diameter
    - Add silkscreen net-name labels within 2 mm of each pad, not obscured by courtyard areas
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [-] 4.2 Run ERC and fix all electrical rule violations
    - Execute ERC in the EDA tool; resolve all errors and warnings before proceeding to layout
    - Verify all 14 `config.h` macros have matching net names in the schematic
    - _Requirements: 2.4, 14.1–14.7_

- [ ] 5. PCB layout — board setup and power domain
  - [ ] 5.1 Configure board outline, stackup, and design rules
    - Set board dimensions to 80 mm × 55 mm with R2 mm corner radii
    - Configure 2-layer stackup: top = signal, bottom = GND plane (FR-4, 1.6 mm, 1 oz copper)
    - Set DRC constraints: min trace width 0.15 mm, min spacing 0.15 mm, signal via drill 0.3 mm / pad 0.6 mm, power via drill 0.5 mm / pad 1.0 mm, courtyard-to-edge clearance 0.25 mm
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.10_

  - [ ] 5.2 Place and route power section
    - Place J2 (USB-C), AMS1117-3.3 within 5 mm of J2 with thermal pad connected to bottom GND via thermal vias
    - Place C1, C2 near AMS1117; route 5 V trace ≥ 1.0 mm, 3.3 V trace ≥ 0.5 mm
    - Place CH340C within 10 mm of J2; route USB D+/D− as differential pair (equal length ±0.5 mm, 0.2 mm spacing, no right-angle bends)
    - _Requirements: 11.1, 11.4, 11.5_

  - [ ] 5.3 Place ESP32 module with decoupling capacitors
    - Place U1 (ESP32-WROOM-32E) in the ESP32 core zone
    - Place C3–C6 (100 nF) at each VCC pin with trace length < 5 mm; place C7 (10 µF) within 10 mm of module
    - Flood-fill bottom layer with GND copper; flood-fill GND on top layer in non-signal areas
    - _Requirements: 1.5, 1.6, 11.3_

- [ ] 6. PCB layout — user interface and communication zones
  - [ ] 6.1 Place and route OLED, buttons, RGB LED, and buzzer
    - Place OLED connector within 10 mm of board edge; route SDA/SCL as parallel traces (spacing ≥ 0.2 mm, length < 50 mm)
    - Place SW1/SW2/SW3 within 5 mm of board edge with ≥ 10 mm spacing between adjacent buttons
    - Place LED1 within 5 mm of board edge; place BZ1 ≥ 20 mm from OLED and ≥ 20 mm from nearest button
    - _Requirements: 6.7, 6.8, 7.4, 11.6, 11.7, 11.8, 11.9_

  - [ ] 6.2 Place J1 header, test points, and add silkscreen
    - Place J1 (UART2 header) with TP3/TP4 adjacent; place TP1/TP2/TP5/TP6 in accessible locations
    - Add white silkscreen labels on all connectors, test points, and polarity-sensitive components (C1, C2, C7, D2, LED1, BZ1, Q1, U3)
    - Verify all courtyard areas and board-edge copper maintain ≥ 0.25 mm clearance from board edge
    - _Requirements: 10.9, 10.10, 12.7_

- [ ] 7. DRC, Gerber export, and BOM
  - [ ] 7.1 Run JLC DRC and achieve zero violations
    - Execute DRC with JLC design rules loaded; fix all violations (trace width, spacing, via size, courtyard, silkscreen)
    - Verify differential pair length matching on USB D+/D− (±0.5 mm tolerance)
    - _Requirements: 10.8_

  - [ ] 7.2 Export Gerber files and drill files
    - Generate Gerber files for: F.Cu, B.Cu, F.Mask, B.Mask, F.Silkscreen, B.Silkscreen, Edge.Cuts
    - Generate Excellon drill file; verify file set opens correctly in a Gerber viewer (e.g., KiCad GerbView or gerbv)
    - _Requirements: 10.8_

  - [ ] 7.3 Export and validate BOM
    - Export BOM CSV with columns: reference designator, description, value/model, quantity, package, JLC part number
    - Verify all 28 line items from design section 2.9 are present with correct packages (C1/C2 radial electrolytic; C3–C6/C8 0402 MLCC; C7 0805 MLCC; R1–R6 0402; Q1 SOT-23; D2 SOD-123; U2 SOP-16; U3 SOT-223)
    - Confirm JLC part numbers are populated for all standard components; flag any without stock numbers
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

- [x] 8. Firmware `config.h` audit and compile-time guards
  - [x] 8.1 Audit and harden `config.h` macro definitions
    - Verify all 14 pin macros in `config.h` match the schematic: `PIN_I2C_SDA=21`, `PIN_I2C_SCL=22`, `PIN_BTN_OK=18`, `PIN_BTN_NEXT=19`, `PIN_BTN_BACK=23`, `PIN_RGB_RED=25`, `PIN_RGB_GREEN=26`, `PIN_RGB_BLUE=27`, `RGB_COMMON_ANODE=0`, `PIN_BUZZER=14`, `BUZZER_ACTIVE_LEVEL=LOW` (value 0), `TARGET_RX_PIN=16`, `TARGET_TX_PIN=17`, `TARGET_BAUD=115200`
    - Add `#error` compile-time guards for each macro so the build fails if any macro is undefined (Requirement 14.7)
    - Rename `BUZZER_ACTIVE` to `BUZZER_ACTIVE_LEVEL` if not already consistent; ensure `BUZZER_ACTIVE_LEVEL=0` (LOW) per Requirement 14.5
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [ ] 9. Firmware — button event queue
  - [x] 9.1 Replace polling-based button reads with a discrete event queue
    - Refactor `button_handler.h`: add a fixed-size circular queue (capacity ≥ 8) that stores `ButtonEvent` enum values (`BTN_OK`, `BTN_NEXT`, `BTN_BACK`)
    - On rising-edge detection (release), enqueue exactly one event; suppress all further transitions on that button for 50 ms (debounce window)
    - Ensure a continuously held button does not enqueue repeat events
    - Expose `bool dequeue(ButtonEvent& out)` for the application layer to consume events in FIFO order
    - Update `main.cpp` to call `btns.dequeue()` instead of `isOkClicked()` / `isNextClicked()` / `isBackClicked()`
    - _Requirements: 7.5, 7.6_

  - [-] 9.2 Write property test for button debounce correctness (Property 2)
    - **Property 2: Button Debounce Correctness** — for any sequence of GPIO transitions within a 50 ms window, exactly one event is enqueued
    - Use a host-side C++ test harness (Unity or GoogleTest) with a mock `millis()` and `digitalRead()` to inject arbitrary transition sequences
    - Generate random transition sequences (1–20 edges) within a 0–49 ms window and assert queue depth == 1 after processing
    - Also test sequences spanning > 50 ms and assert each distinct press-release pair produces exactly one event
    - **Validates: Requirements 7.5**

- [ ] 10. Firmware — AG protocol hardening
  - [x] 10.1 Add `AG:ERR:BUSY` response for concurrent requests
    - In `deployment.h`, when `pending.active == true` and a new `AG:REQ:*` line is received on UART2, immediately transmit `AG:ERR:BUSY\n` and discard the second request
    - Add `SERIAL_PROTO_ERR_BUSY` constant to `config.h`
    - _Requirements: 5.7_

  - [x] 10.2 Add physical confirmation gate enforcement in `deployment.h`
    - Modify `startInstall()` and `startUninstall()` so they do NOT send `AG:REQ:INSTALL` / `AG:REQ:REMOVE` to UART2 until a physical OK button press event has been dequeued after the request was received
    - The state machine already has `ST_CONFIRM_INSTALL` and `ST_CRITICAL_CONFIRM` — wire these states to consume a button event from the queue before calling `startInstall()` / `startUninstall()`
    - Ensure `AG:BEGIN:INSTALL` / `AG:BEGIN:REMOVE` is never emitted without a prior physical OK press (Property 6)
    - _Requirements: 5.3, 5.4, 5.8_

  - [x] 10.3 Add Back-button rejection paths for INSTALL and REMOVE confirmations
    - In `handleButtons()`, when state is `ST_CONFIRM_INSTALL` and Back is pressed, transmit `AG:ERR:INSTALL\n` on UART2 and return to `ST_MENU_SELECT`
    - When state is `ST_CRITICAL_CONFIRM` and Back is pressed, transmit `AG:ERR:REMOVE\n` on UART2 and return to `ST_MENU_SELECT`
    - _Requirements: 5.5, 5.6_

  - [x] 10.4 Add 60-second auto-cancel timeout for pending confirmations
    - In `loop()` / state update logic, when in `ST_CONFIRM_INSTALL` or `ST_CRITICAL_CONFIRM`, check `millis() - stateEnteredAt >= 60000`; if elapsed, transmit `AG:ERR:<operation>\n`, update OLED to idle, and transition to `ST_MENU_SELECT`
    - _Requirements: 6.5_

  - [-] 10.5 Write property test for AG protocol response sequence (Property 5)
    - **Property 5: AG Protocol Response Sequence** — for any `AG:REQ:BACKUP` operation, the UART2 output sequence is exactly: one `AG:BEGIN:BACKUP`, one or more `AG:STEP:<n>` with non-decreasing `<n>`, then one `AG:OK:BACKUP`
    - Build a host-side test harness that feeds mock UART2 input to `DeploymentModule` and captures its output calls
    - Use property-based generation to vary the number of STEP messages (1–10) and percent values; assert ordering invariants
    - **Validates: Requirements 5.2, 5.7**

  - [-] 10.6 Write property test for physical confirmation security invariant (Property 6)
    - **Property 6: Physical Confirmation Security Invariant** — for any `AG:REQ:INSTALL` or `AG:REQ:REMOVE` received, `AG:BEGIN:INSTALL` / `AG:BEGIN:REMOVE` is never emitted unless a physical OK button press event was registered after the request
    - Generate random sequences of: request arrival, button events (OK / Back / none), and timeouts; assert the invariant holds in all cases
    - **Validates: Requirements 5.3, 5.4, 5.8**

- [x] 11. Firmware — OLED UI compliance
  - [x] 11.1 Add 500 ms display update deadline for confirmation prompts
    - In `handleStateEntry()` for `ST_CONFIRM_INSTALL` and `ST_CRITICAL_CONFIRM`, call `renderUi()` immediately (within the same loop tick) to meet the 500 ms display requirement
    - Show operation name and "CONFIRM?" text on the OLED
    - _Requirements: 6.5_

  - [x] 11.2 Add 5-second result display before reverting to idle
    - In `ST_SUCCESS` and `ST_ERROR` state handling, after displaying the result, wait ≥ 5 seconds before allowing transition back to `ST_BOOT` / `ST_MENU_SELECT`
    - Enforce the 5-second hold in `loop()` by checking `millis() - stateEnteredAt >= 5000` before accepting OK/Back button events in those states
    - _Requirements: 6.6_

- [ ] 12. Firmware — RGB LED state machine compliance
  - [x] 12.1 Align LED colour mapping with Requirement 8.5 and add BUSY/PENDING states
    - Audit `hardware_ctrl.h` `LEDColor` enum: add `COLOR_IDLE` (blue), `COLOR_PENDING` (yellow blink 500/500 ms), `COLOR_BUSY` (magenta/purple), `COLOR_OK` (green), `COLOR_ERROR` (red) if not already present under those names
    - Update `applyColor()` to map the five required states: IDLE → blue only; PENDING → red+green (yellow); OK → green only; ERROR → red only; BUSY → red+blue (magenta)
    - Update `main.cpp` state entries to use the correct colour constants per Requirement 8.9
    - _Requirements: 8.2, 8.5, 8.6, 8.9_

  - [-] 12.2 Write property test for RGB colour exclusivity (Property 4)
    - **Property 4: RGB Colour Exclusivity** — for any `LEDColor` enum value, `applyColor()` sets exactly the GPIO levels specified by the mapping in Requirement 8.5, with no spurious channel activations
    - Build a host-side test harness with mock `digitalWrite()` that records pin state after each `applyColor()` call
    - For each of the five defined `LEDColor` values, assert the exact GPIO25/26/27 output levels match the table in Requirement 8.5
    - **Validates: Requirements 8.5, 8.6**

- [ ] 13. Firmware — buzzer pattern compliance
  - [x] 13.1 Align buzzer sequences with Requirement 9.8
    - In `hardware_ctrl.h`, update `playSuccess()` to emit 2 pulses of 100 ms with 100 ms gap (currently 2 × 100 ms / 50 ms gap — fix gap to 100 ms)
    - Update `playError()` to emit 3 pulses of 100 ms with 100 ms gaps (currently 1 × 350 ms — replace with 3 × 100 ms / 100 ms gap)
    - Add `playBegin()` method: 1 pulse of 100 ms (for `AG:BEGIN` events)
    - Wire `playBegin()` call in `deployment.h` `handleBeginMarker()` via a callback or flag consumed in `main.cpp`
    - _Requirements: 9.8_

  - [-] 13.2 Write unit tests for buzzer sequence timing
    - Build a host-side test harness with mock `millis()` and `digitalWrite()` that steps time forward and records buzzer pin transitions
    - Test `playBegin()`: assert exactly 1 HIGH→LOW transition pair with duration 100 ms ± 10%
    - Test `playSuccess()`: assert exactly 2 pulse pairs with 100 ms on / 100 ms gap ± 10%
    - Test `playError()`: assert exactly 3 pulse pairs with 100 ms on / 100 ms gap ± 10%
    - _Requirements: 9.6, 9.8_

- [ ] 14. Firmware — UART2 transmission integrity test harness
  - [-] 14.1 Write property test for UART2 transmission integrity (Property 3)
    - **Property 3: UART2 Transmission Integrity** — for any AG protocol message of length 1–2048 bytes, the byte sequence received equals the byte sequence sent in both directions
    - Build a loopback test: connect GPIO16 (RX2) to GPIO17 (TX2) on the physical board via a jumper wire; write a PlatformIO test (`test/test_uart2_loopback/`) that sends random byte sequences and asserts byte-for-byte equality of received data
    - Use `unity` test framework (already available in PlatformIO) with `RUN_TEST` macros
    - **Validates: Requirements 4.4, 4.5**

- [ ] 15. Checkpoint — firmware unit tests pass
  - Ensure all host-side property tests and unit tests compile and pass
  - Run `pio test -e serial_deployer` (or equivalent host-side test runner) and confirm zero failures
  - Ask the user if any questions arise before proceeding to bring-up verification

- [ ] 16. Hardware bring-up verification
  - [ ] 16.1 Write bring-up verification checklist script
    - Create `hardware/bring-up/verify_bringup.py` — a Python script that connects to the ESP32 via serial (pyserial) and performs automated checks:
      1. Power-on: confirm UART0 outputs boot splash within 5 seconds
      2. OLED: confirm "AetherGuard" splash appears (manual visual check, logged)
      3. UART2 loopback: send `AG:REQ:ENV\n` on J1, assert response contains `AG:ENV:LINUX` within 2 seconds (requires host helper running)
      4. Button check: prompt operator to press each button; confirm corresponding event logged on UART0
      5. RGB LED: cycle through all five states via serial command; prompt operator to confirm colours
      6. Buzzer: trigger each pattern; prompt operator to confirm audible output
    - _Requirements: 2.5, 4.4, 5.1_

  - [ ] 16.2 Write power rail verification test procedure
    - Create `hardware/bring-up/power_rail_check.md` documenting the bench measurement procedure for Property 1:
      - Measure TP1 (3.3 V) with USB input at 4.5 V, 5.0 V, and 5.5 V; assert reading within 3.135 V–3.465 V
      - Measure voltage difference between any two ESP32 VCC pins; assert < 50 mV
      - Measure TP1 while ESP32 Wi-Fi transmitter is active (run `pio run -e serial_deployer_release` and trigger a Wi-Fi scan); assert rail stays within ±5%
    - _Requirements: 1.2, 1.7 (Property 1)_

- [ ] 17. Final checkpoint — all artifacts complete
  - Confirm Gerber files pass JLC DRC with zero violations
  - Confirm BOM has JLC part numbers for all 28 line items
  - Confirm `pio run -e serial_deployer_release` builds without errors or warnings
  - Confirm all property tests pass
  - Ask the user if questions arise before submitting for PCB fabrication

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; all non-starred tasks are required for a production-ready board
- Hardware design artifacts should be placed under `hardware/aetherguard-gate/` (create this directory)
- Bring-up scripts go under `hardware/bring-up/`
- The existing firmware in `deployment/esp32-serial-deployer-bundle/esp32/src/` is the baseline; all firmware tasks modify files in that directory
- Property tests 2, 4, 5, 6 are host-side C++ tests; Property 3 is an on-device PlatformIO test; Property 1 is a bench measurement procedure
- The `serial_deployer_release` PlatformIO environment is the production build target; all firmware changes must compile cleanly under it
- Checkpoints ensure incremental validation at natural break points between hardware and firmware tracks

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "8.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1", "3.2", "3.3", "9.1"] },
    { "id": 2, "tasks": ["4.1", "10.1", "10.2", "10.3", "10.4", "11.1", "11.2", "12.1", "13.1"] },
    { "id": 3, "tasks": ["4.2", "9.2", "10.5", "10.6", "12.2", "13.2", "14.1"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 5, "tasks": ["6.1", "6.2"] },
    { "id": 6, "tasks": ["7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3"] },
    { "id": 8, "tasks": ["16.1", "16.2"] }
  ]
}
```
