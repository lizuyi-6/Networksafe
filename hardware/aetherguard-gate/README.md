# AetherGuard ESP32 Physical Confirmation Gate — Hardware Design

KiCad 9.0 project for the AetherGuard Gate PCB.
Board dimensions: **80 mm × 55 mm**, 2-layer FR-4, 1.6 mm, 1 oz copper.

## Project Structure

```
hardware/aetherguard-gate/
├── aetherguard-gate.kicad_pro   — KiCad project file (DRC rules, net classes)
├── aetherguard-gate.kicad_sch   — Top-level schematic (sheet hierarchy)
├── aetherguard-gate.kicad_sym   — Project-local symbol library
├── aetherguard-gate.kicad_pcb   — PCB layout (created in Tasks 5–7)
├── sym-lib-table                — Symbol library table
├── fp-lib-table                 — Footprint library table
└── sheets/
    ├── power-ldo.kicad_sch      ✅ Task 1.1 — Power supply & auto-reset
    ├── esp32-core.kicad_sch     🔲 Task 1.2 — ESP32-WROOM-32E core
    ├── usb-serial.kicad_sch     🔲 Task 2.1 — CH340C USB-Serial bridge
    ├── uart2-link.kicad_sch     🔲 Task 2.2 — UART2 deployment link J1
    ├── ui-peripherals.kicad_sch 🔲 Tasks 3.1–3.3 — OLED, buttons, RGB, buzzer
    └── test-points.kicad_sch    🔲 Task 4.1 — Test points TP1–TP6
```

## Sheet 2 — Power Supply & Auto-Reset (`sheets/power-ldo.kicad_sch`)

**Task 1.1 deliverable.** Covers Requirements 1.1, 1.2, 1.3, 1.4, 1.8, 3.6.

### Components placed

| Ref  | Description                        | Value/Model      | Package              | LCSC    |
|------|------------------------------------|------------------|----------------------|---------|
| J2   | USB Type-C 16P receptacle          | HRO TYPE-C-31-M-12 | USB-C SMD 16P      | C165948 |
| U3   | AMS1117-3.3 LDO, 1A               | AMS1117-3.3      | SOT-223-3_TabPin2    | C6186   |
| C1   | 100 µF / 10 V electrolytic         | 100uF/10V        | CP_Radial_D5.0mm     | C59461  |
| C2   | 10 µF / 10 V electrolytic          | 10uF/10V         | CP_Radial_D5.0mm     | C19702  |
| C9   | 100 nF MLCC (3.3 V HF decoupling)  | 100nF            | C_0402_1005Metric    | C1525   |
| C10  | 100 nF MLCC (auto-reset RTS→EN)    | 100nF            | C_0402_1005Metric    | C1525   |
| C11  | 100 nF MLCC (auto-reset DTR→GPIO0) | 100nF            | C_0402_1005Metric    | C1525   |

### Net topology

```
USB-C J2
  VBUS (A4/A9/B4/B9) ──[+5V rail, >= 1.0mm trace]──┬── C1+ (100µF bulk)
                                                     └── U3 IN (pin 3)
  GND  (A1/A12/B1/B12/S1) ──────────────────────────── GND plane
  D+   (A6/B6) ──────────────────────────────────────── USB_D_P (to CH340C)
  D-   (A7/B7) ──────────────────────────────────────── USB_D_N (to CH340C)

U3 AMS1117-3.3
  IN  (pin 3) ── +5V rail
  GND (pin 1) ── GND
  OUT (pin 2) ──[+3V3 rail, >= 0.5mm trace]──┬── C2+ (10µF bulk)
  TAB (pin 4) ── OUT (tied)                   └── C9  (100nF MLCC)

Auto-reset circuit (Req 3.6):
  RTS_N (from CH340C) ──[C10, 100nF]── ESP_EN
  DTR_N (from CH340C) ──[C11, 100nF]── GPIO0
```

### PCB layout constraints (annotated on schematic)

- **5 V trace**: ≥ 1.0 mm width (net class `Power_5V`)
- **3.3 V trace**: ≥ 0.5 mm width (net class `Power_3V3`)
- **U3 placement**: within 5 mm of J2; thermal pad connected to bottom GND plane via thermal vias (Req 11.4)
- **USB D+/D−**: differential pair, equal length ±0.1 mm, 0.2 mm spacing, no right-angle bends (Req 3.3)
- **C1, C2**: radial electrolytic, polarity marked in silkscreen (Req 10.9)

### Auto-reset operation (Req 3.6)

When `esptool.py` (or Arduino IDE) initiates a flash sequence:
1. Asserts RTS low → capacitor C10 couples the edge → pulls ESP32 EN low momentarily → ESP32 resets
2. Simultaneously asserts DTR low → capacitor C11 couples the edge → pulls GPIO0 low → ESP32 enters download mode
3. Both signals float back to idle via the capacitors; no DC path between CH340C and ESP32 control pins

## Net Classes (defined in `.kicad_pro`)

| Class      | Track width | Via drill/pad | Nets              |
|------------|-------------|---------------|-------------------|
| Power_5V   | 1.0 mm      | 0.5 / 1.0 mm  | USB_VBUS, +5V     |
| Power_3V3  | 0.5 mm      | 0.5 / 1.0 mm  | +3V3, 3V3         |
| USB_Diff   | 0.2 mm      | 0.25 / 0.55 mm| USB_D*, HOST_D*   |
| Default    | 0.2 mm      | 0.3 / 0.6 mm  | all other signals |

## Design Rule Summary (JLC Standard Process)

| Parameter              | Value    |
|------------------------|----------|
| Min trace width        | 0.15 mm  |
| Min trace spacing      | 0.15 mm  |
| Signal via drill/pad   | 0.3 / 0.6 mm |
| Power via drill/pad    | 0.5 / 1.0 mm |
| Board edge clearance   | 0.25 mm  |
| Stackup                | 2-layer, FR-4 1.6 mm, 1 oz |
| Surface finish         | HASL (lead-free) or ENIG |
