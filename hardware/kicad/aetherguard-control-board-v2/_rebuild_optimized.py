"""
Rebuild PCB with optimized placement for better routability.
Key changes:
- Spread components more evenly across 90x60mm
- Keep ESP32-S3 at top-center with clear antenna zone
- Group by function with routing channels between groups
- Ensure no courtyard overlaps
"""
import pcbnew
import os

PROJECT_DIR = "X:/repos/Networksafe/hardware/kicad/aetherguard-control-board-v2"
PCB_OUT = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2-routed.kicad_pcb")
DSN_OUT = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2.dsn")
SES_OUT = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2.ses")

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

    # Add nets
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

    # Optimized placement - spread out with routing channels
    # Layout zones:
    #   Top row (y=8-20): ESP32 center, OLED left, LED/buzzer right-of-OLED
    #   Middle row (y=24-40): ATECC left-center, RTC right-center, Optos far-right
    #   Bottom row (y=42-56): Power left, SD card center-right, Terminals far-right

    placements = [
        # (ref, lib_dir, fp_name, x, y, pad_nets)
        # --- MCU (top center) ---
        ("U1", LOCAL_FP, "AetherGuard_ESP32-S3-WROOM-1", 45, 16,
         {"1":"GND","2":"+3V3","4":"GND","5":"GND","6":"SD_CS","7":"RTC_INT",
          "8":"I2C_SDA","9":"I2C_SCL","10":"GND","11":"GND","12":"GND",
          "13":"GND","14":"GND","15":"INTERLOCK_OUT","16":"INTERLOCK_FB",
          "17":"GND","18":"GND","19":"USB_DN","20":"USB_DP","21":"GND",
          "49":"GND"}),

        # --- I2C devices (middle-left) ---
        ("U2", os.path.join(KICAD_FP,"Package_SO.pretty"), "SOIC-8_3.9x4.9mm_P1.27mm", 25, 30,
         {"4":"GND","5":"I2C_SDA","6":"I2C_SCL","8":"+3V3"}),
        ("U9", os.path.join(KICAD_FP,"Package_SO.pretty"), "SOIC-8_3.9x4.9mm_P1.27mm", 45, 30,
         {"3":"RTC_INT","4":"GND","5":"I2C_SDA","6":"I2C_SCL","8":"+3V3"}),

        # --- Power (bottom-left) ---
        ("U3", os.path.join(KICAD_FP,"Package_TO_SOT_SMD.pretty"), "SOT-23-6", 15, 48,
         {"1":"VIN_EXT","2":"5V_BUCK","5":"GND"}),
        ("U4", os.path.join(KICAD_FP,"Package_TO_SOT_SMD.pretty"), "SOT-23-5", 25, 48,
         {"1":"5V_SYS","2":"GND","5":"+3V3"}),
        ("U5", os.path.join(KICAD_FP,"Package_TO_SOT_SMD.pretty"), "SOT-23-6", 15, 42,
         {"1":"VBUS","2":"5V_BUCK","5":"GND"}),

        # --- Optocouplers (far right) ---
        ("U7", os.path.join(KICAD_FP,"Package_SO.pretty"), "SO-4_4.4x2.3mm_P1.27mm", 80, 28,
         {"1":"5V_BUCK","2":"INTERLOCK_OUT","3":"GND","4":"+3V3"}),
        ("U8", os.path.join(KICAD_FP,"Package_SO.pretty"), "SO-4_4.4x2.3mm_P1.27mm", 80, 36,
         {"1":"INTERLOCK_FB","2":"GND","3":"GND","4":"+3V3"}),

        # --- Connectors ---
        ("J1", LOCAL_FP, "AetherGuard_USB4110_GFA", 5, 35,
         {}),
        ("J2", os.path.join(KICAD_FP,"Connector_PinHeader_2.54mm.pretty"), "PinHeader_1x02_P2.54mm_Vertical", 8, 52,
         {"1":"VIN_EXT","2":"GND"}),
        ("J3", os.path.join(KICAD_FP,"Connector_PinHeader_2.54mm.pretty"), "PinHeader_1x06_P2.54mm_Vertical", 35, 55,
         {"1":"+3V3","2":"GND"}),
        ("J4", os.path.join(KICAD_FP,"Connector_PinHeader_2.54mm.pretty"), "PinHeader_1x02_P2.54mm_Vertical", 88, 22,
         {"1":"INTERLOCK_OUT","2":"GND"}),
        ("J5", os.path.join(KICAD_FP,"Connector_PinHeader_2.54mm.pretty"), "PinHeader_1x02_P2.54mm_Vertical", 88, 38,
         {"1":"INTERLOCK_FB","2":"GND"}),
        ("J6", LOCAL_FP, "AetherGuard_MicroSD_Push_Push", 60, 52,
         {"1":"SD_CS","2":"SD_MOSI","5":"SD_SCK","6":"GND","7":"SD_MISO"}),

        # --- UI (top-left) ---
        ("DS1", os.path.join(KICAD_FP,"Connector_PinHeader_2.54mm.pretty"), "PinHeader_1x04_P2.54mm_Vertical", 12, 15,
         {"1":"GND","2":"+3V3","3":"I2C_SCL","4":"I2C_SDA"}),
        ("SW1", os.path.join(KICAD_FP,"Button_Switch_SMD.pretty"), "SW_SPST_CK_RS282G05A3", 20, 22,
         {"1":"GND","2":"GND"}),
        ("SW2", os.path.join(KICAD_FP,"Button_Switch_SMD.pretty"), "SW_SPST_CK_RS282G05A3", 28, 22,
         {"1":"GND","2":"GND"}),
        ("SW3", os.path.join(KICAD_FP,"Button_Switch_SMD.pretty"), "SW_SPST_CK_RS282G05A3", 36, 22,
         {"1":"GND","2":"GND"}),
        ("LED1", os.path.join(KICAD_FP,"LED_SMD.pretty"), "LED_0603_1608Metric", 22, 15,
         {"2":"GND"}),
        ("BZ1", os.path.join(KICAD_FP,"Buzzer_Beeper.pretty"), "Buzzer_12x9.5RM7.6", 70, 15,
         {"2":"GND"}),
        ("BT1", LOCAL_FP, "AetherGuard_CR1220_Holder", 55, 42,
         {"1":"+3V3","2":"GND"}),

        # --- Passives ---
        ("R10", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 30, 27,
         {"1":"+3V3","2":"I2C_SDA"}),
        ("R11", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 33, 27,
         {"1":"+3V3","2":"I2C_SCL"}),
        ("R25", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 55, 48,
         {"1":"+3V3","2":"SD_MOSI"}),
        ("R26", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 58, 48,
         {"1":"+3V3","2":"SD_MISO"}),
        ("R27", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 61, 48,
         {"1":"+3V3","2":"SD_SCK"}),
        ("R28", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 64, 48,
         {"1":"+3V3","2":"SD_CS"}),
        ("R29", os.path.join(KICAD_FP,"Resistor_SMD.pretty"), "R_0603_1608Metric", 50, 33,
         {"1":"+3V3","2":"RTC_INT"}),
        ("C8", os.path.join(KICAD_FP,"Capacitor_SMD.pretty"), "C_0603_1608Metric", 48, 27,
         {"1":"+3V3","2":"GND"}),
        ("C9", os.path.join(KICAD_FP,"Capacitor_SMD.pretty"), "C_0603_1608Metric", 65, 48,
         {"1":"+3V3","2":"GND"}),
        ("C10", os.path.join(KICAD_FP,"Capacitor_SMD.pretty"), "C_0805_2012Metric", 68, 48,
         {"1":"+3V3","2":"GND"}),
        ("C11", os.path.join(KICAD_FP,"Capacitor_SMD.pretty"), "C_0805_2012Metric", 30, 48,
         {"1":"+3V3","2":"GND"}),
        ("C12", os.path.join(KICAD_FP,"Capacitor_SMD.pretty"), "C_0805_2012Metric", 34, 48,
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

    # Mounting holes
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

    print(f"Placed: {placed}")

    # Add GND zone on F.Cu covering entire board
    zone = pcbnew.ZONE(board)
    zone.SetIsRuleArea(False)
    zone.SetLayer(pcbnew.F_Cu)
    ni = board.FindNet("GND")
    if ni: zone.SetNet(ni)
    outline = zone.Outline()
    outline.NewOutline()
    outline.Append(mm(0), mm(0))
    outline.Append(mm(90), mm(0))
    outline.Append(mm(90), mm(60))
    outline.Append(mm(0), mm(60))
    zone.SetMinThickness(mm(0.2))
    zone.SetThermalReliefGap(mm(0.3))
    zone.SetThermalReliefSpokeWidth(mm(0.4))
    board.Add(zone)

    # Add GND zone on B.Cu
    zone2 = pcbnew.ZONE(board)
    zone2.SetIsRuleArea(False)
    zone2.SetLayer(pcbnew.B_Cu)
    if ni: zone2.SetNet(ni)
    outline2 = zone2.Outline()
    outline2.NewOutline()
    outline2.Append(mm(0), mm(0))
    outline2.Append(mm(90), mm(0))
    outline2.Append(mm(90), mm(60))
    outline2.Append(mm(0), mm(60))
    zone2.SetMinThickness(mm(0.2))
    zone2.SetThermalReliefGap(mm(0.3))
    zone2.SetThermalReliefSpokeWidth(mm(0.4))
    board.Add(zone2)

    print("Added GND zones on F.Cu and B.Cu")

    # Save
    pcbnew.SaveBoard(PCB_OUT, board)
    print(f"Saved: {PCB_OUT}")

    # Export DSN
    board2 = pcbnew.LoadBoard(PCB_OUT)
    pcbnew.ExportSpecctraDSN(board2, DSN_OUT)
    pads_with_nets = sum(1 for fp in board2.GetFootprints() for p in fp.Pads() if p.GetNetname())
    print(f"DSN: {os.path.getsize(DSN_OUT)} bytes")
    print(f"Footprints: {len(board2.GetFootprints())}, Nets: {board2.GetNetCount()}, Pads w/nets: {pads_with_nets}")

build()
