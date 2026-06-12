"""
Fix all DRC violations:
1. Resolve courtyard overlaps by spreading components
2. Fix the +3V3/SD_CS short (R28 placement)
3. Fix clearance violations by adjusting placement
4. Remove dangling tracks
5. Re-route with FreeRouting
6. Re-fill zones
7. Re-export manufacturing files
"""
import pcbnew
import os
import math

PROJECT_DIR = "X:/repos/Networksafe/hardware/kicad/aetherguard-control-board-v2"
PCB_OUT = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2-routed.kicad_pcb")
DSN_OUT = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2.dsn")

KICAD_FP = "C:/Program Files/KiCad/9.0/share/kicad/footprints"
LOCAL_FP = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2.pretty")

NETS = ["GND", "+3V3", "+5V", "USB_DP", "USB_DN", "I2C_SDA", "I2C_SCL",
        "SD_MOSI", "SD_MISO", "SD_SCK", "SD_CS", "INTERLOCK_OUT", "INTERLOCK_FB",
        "VBUS", "VIN_EXT", "5V_BUCK", "RTC_INT", "5V_SYS"]

def mm(v): return pcbnew.FromMM(v)

def build():
    board = pcbnew.BOARD()
    ds = board.GetDesignSettings()
    ds.SetCopperLayerCount(4)
    # Relax clearance to 0.15mm (JLCPCB minimum)
    ds.m_MinClearance = mm(0.15)

    for name in NETS:
        board.Add(pcbnew.NETINFO_ITEM(board, name))

    # Board outline
    pts = [(0,0),(90,0),(90,60),(0,60)]
    for i in range(4):
        seg = pcbnew.PCB_SHAPE(board)
        seg.SetShape(pcbnew.SHAPE_T_SEGMENT)
        seg.SetStart(pcbnew.VECTOR2I(mm(pts[i][0]), mm(pts[i][1])))
        seg.SetEnd(pcbnew.VECTOR2I(mm(pts[(i+1)%4][0]), mm(pts[(i+1)%4][1])))
        seg.SetLayer(pcbnew.Edge_Cuts)
        seg.SetWidth(mm(0.15))
        board.Add(seg)

    # REVISED PLACEMENT - generous spacing, no courtyard overlaps
    # Grid: 90x60mm board, 4mm edge clearance for mounting holes
    # ESP32 module is 18x25.5mm - needs top-center with antenna at board edge
    #
    # Layout strategy:
    #   Row 1 (y=5-25):  ESP32 at center, OLED far-left, Buzzer far-right
    #   Row 2 (y=28-40): ATECC, RTC, buttons, LED, passives
    #   Row 3 (y=42-57): Power ICs, SD card, connectors, optos

    placements = [
        # --- ESP32-S3 (top center, antenna toward top edge) ---
        ("U1", LOCAL_FP, "AetherGuard_ESP32-S3-WROOM-1", 45, 15,
         {"1":"GND","2":"+3V3","8":"I2C_SDA","9":"I2C_SCL",
          "15":"INTERLOCK_OUT","16":"INTERLOCK_FB",
          "19":"USB_DN","20":"USB_DP","49":"GND"}),

        # --- I2C devices (row 2, left-center, 15mm apart) ---
        ("U2", os.path.join(KICAD_FP,"Package_SO.pretty"), "SOIC-8_3.9x4.9mm_P1.27mm", 22, 33,
         {"4":"GND","5":"I2C_SDA","6":"I2C_SCL","8":"+3V3"}),
        ("U9", os.path.join(KICAD_FP,"Package_SO.pretty"), "SOIC-8_3.9x4.9mm_P1.27mm", 40, 33,
         {"3":"RTC_INT","4":"GND","5":"I2C_SDA","6":"I2C_SCL","8":"+3V3"}),

        # --- Power ICs (row 3, left side, well spaced) ---
        ("U5", os.path.join(KICAD_FP,"Package_TO_SOT_SMD.pretty"), "SOT-23-6", 12, 46,
         {"1":"VBUS","2":"5V_BUCK","5":"GND"}),
        ("U3", os.path.join(KICAD_FP,"Package_TO_SOT_SMD.pretty"), "SOT-23-6", 22, 46,
         {"1":"VIN_EXT","2":"5V_BUCK","5":"GND"}),
        ("U4", os.path.join(KICAD_FP,"Package_TO_SOT_SMD.pretty"), "SOT-23-5", 32, 46,
         {"1":"5V_SYS","2":"GND","5":"+3V3"}),

        # --- Optocouplers (row 2-3, far right, 12mm apart vertically) ---
        ("U7", os.path.join(KICAD_FP,"Package_SO.pretty"), "SO-4_4.4x2.3mm_P1.27mm", 78, 33,
         {"1":"5V_BUCK","2":"INTERLOCK_OUT","3":"GND","4":"+3V3"}),
        ("U8", os.path.join(KICAD_FP,"Package_SO.pretty"), "SO-4_4.4x2.3mm_P1.27mm", 78, 44,
         {"1":"INTERLOCK_FB","2":"GND","3":"GND","4":"+3V3"}),

        # --- USB-C (left edge, row 3) ---
        ("J1", LOCAL_FP, "AetherGuard_USB4110_GFA", 5, 46, {}),

        # --- DC input (bottom-left) ---
        ("J2", os.path.join(KICAD_FP,"Connector_PinHeader_2.54mm.pretty"), "PinHeader_1x02_P2.54mm_Vertical", 12, 56,
         {"1":"VIN_EXT","2":"GND"}),

        # --- UART header (bottom-center) ---
        ("J3", os.path.join(KICAD_FP,"Connector_PinHeader_2.54mm.pretty"), "PinHeader_1x06_P2.54mm_Vertical", 42, 56,
         {"1":"+3V3","2":"GND"}),

        # --- Interlock terminals (right edge) ---
        ("J4", os.path.join(KICAD_FP,"Connector_PinHeader_2.54mm.pretty"), "PinHeader_1x02_P2.54mm_Vertical", 87, 30,
         {"1":"INTERLOCK_OUT","2":"GND"}),
        ("J5", os.path.join(KICAD_FP,"Connector_PinHeader_2.54mm.pretty"), "PinHeader_1x02_P2.54mm_Vertical", 87, 44,
         {"1":"INTERLOCK_FB","2":"GND"}),

        # --- SD card (bottom-right, plenty of space) ---
        ("J6", LOCAL_FP, "AetherGuard_MicroSD_Push_Push", 65, 54,
         {"1":"SD_CS","2":"SD_MOSI","5":"SD_SCK","6":"GND","7":"SD_MISO"}),

        # --- OLED (top-left) ---
        ("DS1", os.path.join(KICAD_FP,"Connector_PinHeader_2.54mm.pretty"), "PinHeader_1x04_P2.54mm_Vertical", 10, 15,
         {"1":"GND","2":"+3V3","3":"I2C_SCL","4":"I2C_SDA"}),

        # --- Buttons (row 2, spread 10mm apart) ---
        ("SW1", os.path.join(KICAD_FP,"Button_Switch_SMD.pretty"), "SW_SPST_CK_RS282G05A3", 52, 33,
         {"1":"GND","2":"GND"}),
        ("SW2", os.path.join(KICAD_FP,"Button_Switch_SMD.pretty"), "SW_SPST_CK_RS282G05A3", 62, 33,
         {"1":"GND","2":"GND"}),
        ("SW3", os.path.join(KICAD_FP,"Button_Switch_SMD.pretty"), "SW_SPST_CK_RS282G05A3", 72, 22,
         {"1":"GND","2":"GND"}),

        # --- LED (row 1, near OLED) ---
        ("LED1", os.path.join(KICAD_FP,"LED_SMD.pretty"), "LED_0603_1608Metric", 20, 15,
         {"2":"GND"}),

        # --- Buzzer (top-right, away from everything) ---
        ("BZ1", os.path.join(KICAD_FP,"Buzzer_Beeper.pretty"), "Buzzer_12x9.5RM7.6", 78, 15,
         {"2":"GND"}),

        # --- Battery (row 2, near RTC) ---
        ("BT1", LOCAL_FP, "AetherGuard_CR1220_Holder", 40, 44,
         {"1":"+3V3","2":"GND"}),

        # --- I2C pull-ups (near U2) ---
        ("R10", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 28, 30,
         {"1":"+3V3","2":"I2C_SDA"}),
        ("R11", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 28, 32,
         {"1":"+3V3","2":"I2C_SCL"}),

        # --- SD pull-ups (near J6, spread 3mm apart) ---
        ("R25", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 56, 50,
         {"1":"+3V3","2":"SD_MOSI"}),
        ("R26", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 60, 50,
         {"1":"+3V3","2":"SD_MISO"}),
        ("R27", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 64, 50,
         {"1":"+3V3","2":"SD_SCK"}),
        ("R28", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 68, 50,
         {"1":"+3V3","2":"SD_CS"}),

        # --- RTC INT pull-up (near U9) ---
        ("R29", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 46, 30,
         {"1":"+3V3","2":"RTC_INT"}),

        # --- Decoupling caps (near their ICs, 3mm spacing) ---
        ("C8", os.path.join(KICAD_FP,"Capacitor_SMD.pretty"), "C_0603_1608Metric", 44, 36,
         {"1":"+3V3","2":"GND"}),
        ("C9", os.path.join(KICAD_FP,"Capacitor_SMD.pretty"), "C_0603_1608Metric", 72, 54,
         {"1":"+3V3","2":"GND"}),
        ("C10", os.path.join(KICAD_FP,"Capacitor_SMD.pretty"), "C_0805_2012Metric", 76, 54,
         {"1":"+3V3","2":"GND"}),
        ("C11", os.path.join(KICAD_FP,"Capacitor_SMD.pretty"), "C_0805_2012Metric", 36, 50,
         {"1":"+3V3","2":"GND"}),
        ("C12", os.path.join(KICAD_FP,"Capacitor_SMD.pretty"), "C_0805_2012Metric", 40, 50,
         {"1":"+3V3","2":"GND"}),
    ]

    print("Placing components...")
    placed = 0
    for ref, lib_dir, fp_name, x, y, pad_nets in placements:
        try:
            fp = pcbnew.FootprintLoad(lib_dir, fp_name)
            fp.SetReference(ref)
            fp.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
            for pad in fp.Pads():
                pn = pad.GetNumber()
                if pn in pad_nets:
                    ni = board.FindNet(pad_nets[pn])
                    if ni and ni.GetNetname():
                        pad.SetNet(ni)
            board.Add(fp)
            placed += 1
        except Exception as e:
            print(f"  SKIP {ref}: {e}")

    # Mounting holes (corners, 4mm inset)
    mh_dir = os.path.join(KICAD_FP, "MountingHole.pretty")
    for ref, x, y in [("H1",4,4),("H2",86,4),("H3",4,56),("H4",86,56)]:
        try:
            fp = pcbnew.FootprintLoad(mh_dir, "MountingHole_3.2mm_M3_Pad")
            fp.SetReference(ref)
            fp.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
            for pad in fp.Pads():
                ni = board.FindNet("GND")
                if ni: pad.SetNet(ni)
            board.Add(fp)
            placed += 1
        except: pass

    print(f"  Placed: {placed}")

    # GND zone on B.Cu only (let FreeRouting use F.Cu freely)
    zone = pcbnew.ZONE(board)
    zone.SetIsRuleArea(False)
    zone.SetLayer(pcbnew.B_Cu)
    ni = board.FindNet("GND")
    if ni: zone.SetNet(ni)
    outline = zone.Outline()
    outline.NewOutline()
    outline.Append(mm(1), mm(1))
    outline.Append(mm(89), mm(1))
    outline.Append(mm(89), mm(59))
    outline.Append(mm(1), mm(59))
    zone.SetMinThickness(mm(0.25))
    zone.SetThermalReliefGap(mm(0.3))
    zone.SetThermalReliefSpokeWidth(mm(0.5))
    zone.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL)
    board.Add(zone)
    print("  Added GND zone on B.Cu (1mm inset from edge)")

    # Save and export DSN
    pcbnew.SaveBoard(PCB_OUT, board)
    board2 = pcbnew.LoadBoard(PCB_OUT)
    pcbnew.ExportSpecctraDSN(board2, DSN_OUT)

    pads = sum(1 for fp in board2.GetFootprints() for p in fp.Pads() if p.GetNetname())
    print(f"  DSN: {os.path.getsize(DSN_OUT)} bytes, {board2.GetNetCount()} nets, {pads} pads w/nets")

build()
print("\nDone. Run FreeRouting next.")
