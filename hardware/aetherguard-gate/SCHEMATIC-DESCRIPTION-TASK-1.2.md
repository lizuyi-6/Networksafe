# Task 1.2 Schematic Description — ESP32-WROOM-32E Module with Decoupling Array

**Sheet:** `hardware/aetherguard-gate/sheets/esp32-core.kicad_sch`  
**Sheet page:** 3 (ESP32-Core)  
**Requirements:** 1.5, 1.6, 2.1, 2.2, 2.3  
**Date:** 2026-03-28  

---

## 1. Components Placed

### U1 — ESP32-WROOM-32E (4 MB Flash)

| Field | Value |
|-------|-------|
| Reference | U1 |
| Value | ESP32-WROOM-32E |
| Footprint | RF_Module:ESP32-WROOM-32 |
| JLC Part | C701341 |
| Package | Module, 18 × 25.5 mm, 38 castellated pads + GND pad |
| Placement | Centre of ESP32-Core sheet at (120.65, 101.6) mm |

**Requirement 2.1:** U1 is the sole main controller. All GPIO assignments match `config.h` macros exactly (Requirement 14.1–14.7).

#### U1 Pin Assignments (key signals)

| Pin | Name | Net | config.h Macro |
|-----|------|-----|----------------|
| 2 | 3V3 | 3V3 | — |
| 3 | EN | EN | — |
| 10 | GPIO25/DAC1 | GPIO25_RED | PIN_RGB_RED = 25 |
| 11 | GPIO26/DAC2 | GPIO26_GREEN | PIN_RGB_GREEN = 26 |
| 12 | GPIO27 | GPIO27_BLUE | PIN_RGB_BLUE = 27 |
| 13 | GPIO14 | GPIO14_BUZZER | PIN_BUZZER = 14 |
| 20 | VCC | 3V3 | — |
| 27 | GPIO0/BOOT | GPIO0_BOOT | — |
| 29 | GPIO16/RX2 | GPIO16_RX2 | TARGET_RX_PIN = 16 |
| 30 | GPIO17/TX2 | GPIO17_TX2 | TARGET_TX_PIN = 17 |
| 32 | GPIO18/VSPI_CLK | GPIO18_OK | PIN_BTN_OK = 18 |
| 33 | GPIO19/VSPI_MISO | GPIO19_NEXT | PIN_BTN_NEXT = 19 |
| 35 | GPIO21/SDA | GPIO21_SDA | PIN_I2C_SDA = 21 |
| 36 | RXD0/GPIO3 | GPIO3_RX0 | — |
| 37 | TXD0/GPIO1 | GPIO1_TX0 | — |
| 38 | GPIO22/SCL | GPIO22_SCL | PIN_I2C_SCL = 22 |
| 39 | GPIO23 | GPIO23_BACK | PIN_BTN_BACK = 23 |
| 1, 15, 21, 34, GND_PAD | GND | GND | — |

---

### C3 — 100 nF MLCC 0402 (VCC Pin 2 Decoupling)

| Field | Value |
|-------|-------|
| Reference | C3 |
| Value | 100nF |
| Footprint | Capacitor_SMD:C_0402_1005Metric |
| JLC Part | C1525 |
| Spec | 100nF, 10V, X5R, 0402 |
| Placement | Adjacent to U1 pin 2 (3V3), trace < 5 mm |
| Connections | Pin 1 → 3V3 rail; Pin 2 → GND |

**Requirement 1.5:** One 100 nF MLCC at each ESP32 VCC pin, trace length < 5 mm.

---

### C4 — 100 nF MLCC 0402 (VCC Pin 20 Decoupling)

| Field | Value |
|-------|-------|
| Reference | C4 |
| Value | 100nF |
| Footprint | Capacitor_SMD:C_0402_1005Metric |
| JLC Part | C1525 |
| Spec | 100nF, 10V, X5R, 0402 |
| Placement | Adjacent to U1 pin 20 (VCC), trace < 5 mm |
| Connections | Pin 1 → 3V3 rail; Pin 2 → GND |

**Requirement 1.5:** One 100 nF MLCC at each ESP32 VCC pin, trace length < 5 mm.

---

### C5 — 100 nF MLCC 0402 (VCC Pin 15 Area Decoupling)

| Field | Value |
|-------|-------|
| Reference | C5 |
| Value | 100nF |
| Footprint | Capacitor_SMD:C_0402_1005Metric |
| JLC Part | C1525 |
| Spec | 100nF, 10V, X5R, 0402 |
| Placement | Adjacent to U1 pin 15 (GND) / nearby 3V3 rail, trace < 5 mm |
| Connections | Pin 1 → 3V3 rail; Pin 2 → GND |

**Requirement 1.5:** One 100 nF MLCC at each ESP32 VCC pin, trace length < 5 mm.

---

### C6 — 100 nF MLCC 0402 (VCC Pin 21 Area Decoupling)

| Field | Value |
|-------|-------|
| Reference | C6 |
| Value | 100nF |
| Footprint | Capacitor_SMD:C_0402_1005Metric |
| JLC Part | C1525 |
| Spec | 100nF, 10V, X5R, 0402 |
| Placement | Adjacent to U1 pin 21 (GND) / nearby 3V3 rail, trace < 5 mm |
| Connections | Pin 1 → 3V3 rail; Pin 2 → GND |

**Requirement 1.5:** One 100 nF MLCC at each ESP32 VCC pin, trace length < 5 mm.

> **PCB Layout Note (C3–C6):** All four 100 nF caps must be placed on the same side as U1 with their positive terminal connected to the 3V3 pour and their negative terminal to the GND plane via a short via. The trace from each cap to the nearest U1 VCC pad must be ≤ 5 mm. Caps should be placed in the order: C3 near pin 2, C4 near pin 20, C5 near pin 15, C6 near pin 21.

---

### C7 — 10 µF MLCC 0805 (Wi-Fi Transient Bulk Decoupling)

| Field | Value |
|-------|-------|
| Reference | C7 |
| Value | 10uF |
| Footprint | Capacitor_SMD:C_0805_2012Metric |
| JLC Part | C15850 |
| Spec | 10µF, 10V, X5R, 0805 |
| Placement | Within 10 mm of U1 module boundary |
| Connections | Pin 1 → 3V3 rail; Pin 2 → GND |

**Requirement 1.6:** One 10 µF MLCC within 10 mm of the ESP32 module to handle Wi-Fi transmit current transients.

> **PCB Layout Note (C7):** Place C7 on the 3V3 rail within 10 mm of the nearest edge of the ESP32-WROOM-32E module footprint. The 0805 package provides sufficient bulk capacitance for the ~500 mA Wi-Fi TX current spike. Connect positive terminal to 3V3 pour, negative to GND plane via a power via (0.5 mm drill / 1.0 mm pad).

---

### SW4 — BOOT Button (GPIO0 → GND)

| Field | Value |
|-------|-------|
| Reference | SW4 |
| Value | BOOT |
| Footprint | Button_Switch_SMD:SW_SPST_CK_RS282G05A3 |
| JLC Part | C318884 |
| Spec | 6×6 mm tactile switch, SPST-NO, 50 mA / 12 V, 100 k cycle life |
| Connections | Pin A → GPIO0_BOOT net (U1 pin 27); Pin B → GND |

**Requirement 2.2:** BOOT button connected to GPIO0 (active-low, pulls GPIO0 to GND). Holding SW4 during power-on causes the ESP32 ROM bootloader to enter UART download mode.

> **Note:** GPIO0 is a strapping pin. SW4 must NOT be pressed during normal operation. The button is for firmware flashing only. The auto-reset circuit (RTS/DTR via 100 nF caps, Task 1.1) handles automated flashing without manual button presses.

---

### SW5 — EN/RESET Button (EN → GND)

| Field | Value |
|-------|-------|
| Reference | SW5 |
| Value | EN/RESET |
| Footprint | Button_Switch_SMD:SW_SPST_CK_RS282G05A3 |
| JLC Part | C318884 |
| Spec | 6×6 mm tactile switch, SPST-NO, 50 mA / 12 V, 100 k cycle life |
| Connections | Pin A → EN net (U1 pin 3); Pin B → GND |

**Requirement 2.3:** EN/RESET button connected to EN pin (active-low). Pressing SW5 causes the ESP32 to restart and re-execute firmware from boot.

---

## 2. Net Connections Summary

```
3V3 rail ──┬── U1 pin 2  (3V3)
           ├── U1 pin 20 (VCC)
           ├── C3 pin 1  [trace < 5mm to U1 pin 2]
           ├── C4 pin 1  [trace < 5mm to U1 pin 20]
           ├── C5 pin 1  [trace < 5mm to U1 pin 15 area]
           ├── C6 pin 1  [trace < 5mm to U1 pin 21 area]
           └── C7 pin 1  [within 10mm of U1 module]

GND rail ──┬── U1 pin 1  (GND)
           ├── U1 pin 15 (GND)
           ├── U1 pin 21 (GND)
           ├── U1 pin 34 (GND)
           ├── U1 GND_PAD (bottom thermal pad)
           ├── C3 pin 2
           ├── C4 pin 2
           ├── C5 pin 2
           ├── C6 pin 2
           ├── C7 pin 2
           ├── SW4 pin B
           └── SW5 pin B

GPIO0_BOOT ── U1 pin 27 (GPIO0/BOOT) ── SW4 pin A
EN         ── U1 pin 3  (EN)          ── SW5 pin A

GPIO25_RED    ── U1 pin 10 → UI-Panel sheet (PIN_RGB_RED=25)
GPIO26_GREEN  ── U1 pin 11 → UI-Panel sheet (PIN_RGB_GREEN=26)
GPIO27_BLUE   ── U1 pin 12 → UI-Panel sheet (PIN_RGB_BLUE=27)
GPIO14_BUZZER ── U1 pin 13 → UI-Panel sheet (PIN_BUZZER=14)
GPIO16_RX2    ── U1 pin 29 → Comms sheet  (TARGET_RX_PIN=16)
GPIO17_TX2    ── U1 pin 30 → Comms sheet  (TARGET_TX_PIN=17)
GPIO18_OK     ── U1 pin 32 → UI-Panel sheet (PIN_BTN_OK=18)
GPIO19_NEXT   ── U1 pin 33 → UI-Panel sheet (PIN_BTN_NEXT=19)
GPIO21_SDA    ── U1 pin 35 → UI-Panel sheet (PIN_I2C_SDA=21)
GPIO22_SCL    ── U1 pin 38 → UI-Panel sheet (PIN_I2C_SCL=22)
GPIO23_BACK   ── U1 pin 39 → UI-Panel sheet (PIN_BTN_BACK=23)
GPIO1_TX0     ── U1 pin 37 → Comms sheet
GPIO3_RX0     ── U1 pin 36 → Comms sheet
```

---

## 3. PCB Layout Constraints (Annotations in Schematic)

| Constraint | Value | Requirement |
|-----------|-------|-------------|
| C3–C6 trace to U1 VCC pin | < 5 mm | 1.5 |
| C7 distance from U1 module edge | ≤ 10 mm | 1.6 |
| SW4, SW5 placement | ESP32 core zone, accessible | 2.2, 2.3 |
| User buttons (SW1–SW3, other sheet) | GPIO18/19/23 only — no strapping pins | 7.3 |
| 3V3 trace width | ≥ 0.5 mm | 11.1 |
| GND flood fill | Bottom layer full pour; top layer non-signal areas | 11.3 |

---

## 4. Schematic File Structure

```
hardware/aetherguard-gate/
├── aetherguard-gate.kicad_pro      # KiCad project file
├── aetherguard-gate.kicad_sch      # Root sheet (hierarchical)
├── bom-task-1.2.csv                # BOM for task 1.2 components
├── sym-lib-table                   # Symbol library table
├── fp-lib-table                    # Footprint library table
└── sheets/
    ├── esp32-core.kicad_sch        # ← TASK 1.2 PRIMARY DELIVERABLE
    │                               #   U1, C3-C7, SW4, SW5
    ├── power-usb.kicad_sch         # Task 1.1 (stub — populated by task 1.1)
    ├── ui-panel.kicad_sch          # Tasks 3.1-3.3 (stub)
    └── comms.kicad_sch             # Tasks 2.1-2.2 (stub)
```

---

## 5. Requirements Traceability

| Requirement | Description | Satisfied By |
|-------------|-------------|--------------|
| 1.5 | 100 nF MLCC at each ESP32 VCC pin, trace < 5 mm | C3, C4, C5, C6 with layout annotation |
| 1.6 | 10 µF MLCC within 10 mm of module for Wi-Fi transients | C7 with layout annotation |
| 2.1 | ESP32-WROOM-32E (4 MB) as main controller | U1 |
| 2.2 | BOOT button: GPIO0 → GND, active-low | SW4 |
| 2.3 | EN/RESET button: EN → GND, active-low | SW5 |
| 14.1–14.7 | config.h macros match schematic pin assignments | All GPIO net labels match config.h values |
