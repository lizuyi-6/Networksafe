"""
Build AetherGuard Control Board v2 PCB using direct footprint file paths.
Bypasses fp-lib-table by loading .kicad_mod files directly from disk.
"""
import pcbnew
import os

PROJECT_DIR = "X:/repos/Networksafe/hardware/kicad/aetherguard-control-board-v2"
PCB_OUT = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2.kicad_pcb")
DSN_OUT = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2.dsn")

KICAD_FP = "C:/Program Files/KiCad/9.0/share/kicad/footprints"
LOCAL_FP = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2.pretty")

BOARD_W = 90.0
BOARD_H = 60.0

NETS = {
    1: "GND", 2: "+3V3", 3: "+5V", 4: "USB_DP", 5: "USB_DN",
    6: "I2C_SDA", 7: "I2C_SCL", 8: "SD_MOSI", 9: "SD_MISO",
    10: "SD_SCK", 11: "SD_CS", 12: "INTERLOCK_OUT", 13: "INTERLOCK_FB",
    14: "VBUS", 15: "VIN_EXT", 16: "5V_BUCK", 17: "RTC_INT", 18: "5V_SYS",
}

def fp_path(lib_dir, name):
    return os.path.join(lib_dir, name + ".pretty")

def mm(val):
    return pcbnew.FromMM(val)

def load_fp(board, lib_pretty_dir, fp_name, ref, x, y, rot=0, pad_nets=None):
    """Load footprint from a .pretty directory."""
    try:
        fp = pcbnew.FootprintLoad(lib_pretty_dir, fp_name)
    except Exception as e:
        print(f"  SKIP {ref}: {fp_name} from {os.path.basename(lib_pretty_dir)} - {e}")
        return None

    fp.SetReference(ref)
    fp.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
    if rot:
        fp.SetOrientationDegrees(rot)

    if pad_nets:
        for pad in fp.Pads():
            pn = pad.GetNumber()
            if pn in pad_nets:
                net_name = NETS.get(pad_nets[pn], "")
                ni = board.FindNet(net_name)
                if ni:
                    pad.SetNet(ni)

    board.Add(fp)
    print(f"  OK {ref}: {fp_name} at ({x},{y}) - {len(fp.Pads())} pads")
    return fp


def main():
    print("=== Building AetherGuard Control Board v2 PCB ===")

    board = pcbnew.BOARD()

    # Setup 4-layer stackup
    ds = board.GetDesignSettings()
    ds.SetCopperLayerCount(4)

    # Add nets
    for net_id, net_name in NETS.items():
        net = pcbnew.NETINFO_ITEM(board, net_name, net_id)
        board.Add(net)

    # Board outline
    pts = [(0,0), (BOARD_W,0), (BOARD_W,BOARD_H), (0,BOARD_H)]
    for i in range(4):
        seg = pcbnew.PCB_SHAPE(board)
        seg.SetShape(pcbnew.SHAPE_T_SEGMENT)
        seg.SetStart(pcbnew.VECTOR2I(mm(pts[i][0]), mm(pts[i][1])))
        seg.SetEnd(pcbnew.VECTOR2I(mm(pts[(i+1)%4][0]), mm(pts[(i+1)%4][1])))
        seg.SetLayer(pcbnew.Edge_Cuts)
        seg.SetWidth(mm(0.15))
        board.Add(seg)

    # Library paths
    SO = os.path.join(KICAD_FP, "Package_SO.pretty")
    SOT = os.path.join(KICAD_FP, "Package_TO_SOT_SMD.pretty")
    QFN = os.path.join(KICAD_FP, "Package_DFN_QFN.pretty")
    PH = os.path.join(KICAD_FP, "Connector_PinHeader_2.54mm.pretty")
    CAP = os.path.join(KICAD_FP, "Capacitor_SMD.pretty")
    RES = os.path.join(KICAD_FP, "Resistor_SMD.pretty")
    BTN = os.path.join(KICAD_FP, "Button_Switch_SMD.pretty")
    LED = os.path.join(KICAD_FP, "LED_SMD.pretty")
    BUZ = os.path.join(KICAD_FP, "Buzzer_Beeper.pretty")
    MH = os.path.join(KICAD_FP, "MountingHole.pretty")
    DIODE = os.path.join(KICAD_FP, "Diode_SMD.pretty")
    FUSE = os.path.join(KICAD_FP, "Fuse.pretty")
    IND = os.path.join(KICAD_FP, "Inductor_SMD.pretty")

    print("\n--- Main ICs ---")
    load_fp(board, LOCAL_FP, "AetherGuard_ESP32-S3-WROOM-1", "U1", 44, 18)
    load_fp(board, SO, "SOIC-8_3.9x4.9mm_P1.27mm", "U2", 38, 35, 0, {"4":"1","5":"6","6":"7","8":"2"})
    load_fp(board, SOT, "SOT-23-6", "U3", 25, 45, 0, {"2":"16","5":"1"})
    load_fp(board, SOT, "SOT-23-5", "U4", 38, 45, 0, {"2":"1","5":"2"})
    load_fp(board, SOT, "SOT-23-6", "U5", 15, 48, 0, {"2":"18","5":"1"})
    load_fp(board, SO, "SO-4_4.4x2.3mm_P1.27mm", "U7", 78, 25, 0, {"3":"1"})
    load_fp(board, SO, "SO-4_4.4x2.3mm_P1.27mm", "U8", 78, 35, 0, {"3":"1"})
    load_fp(board, SO, "SOIC-8_3.9x4.9mm_P1.27mm", "U9", 60, 35, 0, {"4":"1","5":"6","6":"7","8":"2"})

    print("\n--- Connectors ---")
    load_fp(board, LOCAL_FP, "AetherGuard_USB4110_GFA", "J1", 5, 40)
    load_fp(board, PH, "PinHeader_1x02_P2.54mm_Vertical", "J2", 15, 55, 0, {"1":"15","2":"1"})
    load_fp(board, PH, "PinHeader_1x06_P2.54mm_Vertical", "J3", 30, 55)
    load_fp(board, PH, "PinHeader_1x02_P2.54mm_Vertical", "J4", 85, 20)
    load_fp(board, PH, "PinHeader_1x02_P2.54mm_Vertical", "J5", 85, 35)
    load_fp(board, LOCAL_FP, "AetherGuard_MicroSD_Push_Push", "J6", 70, 50)

    print("\n--- UI ---")
    load_fp(board, PH, "PinHeader_1x04_P2.54mm_Vertical", "DS1", 15, 20, 0, {"1":"1","2":"2","3":"7","4":"6"})
    load_fp(board, BTN, "SW_SPST_CK_RS282G05A3", "SW1", 10, 32)
    load_fp(board, BTN, "SW_SPST_CK_RS282G05A3", "SW2", 22, 32)
    load_fp(board, BTN, "SW_SPST_CK_RS282G05A3", "SW3", 34, 32)
    load_fp(board, LED, "LED_0603_1608Metric", "LED1", 30, 20)
    load_fp(board, BUZ, "Buzzer_12x9.5RM7.6", "BZ1", 30, 27)
    load_fp(board, LOCAL_FP, "AetherGuard_CR1220_Holder", "BT1", 60, 47, 0, {"1":"2","2":"1"})

    print("\n--- Passives ---")
    # I2C pull-ups
    load_fp(board, RES, "R_0603_1608Metric", "R10", 42, 32, 0, {"1":"2","2":"6"})
    load_fp(board, RES, "R_0603_1608Metric", "R11", 44, 32, 0, {"1":"2","2":"7"})
    # SD pull-ups
    load_fp(board, RES, "R_0603_1608Metric", "R25", 62, 44, 0, {"1":"2","2":"8"})
    load_fp(board, RES, "R_0603_1608Metric", "R26", 64, 44, 0, {"1":"2","2":"9"})
    load_fp(board, RES, "R_0603_1608Metric", "R27", 66, 44, 0, {"1":"2","2":"10"})
    load_fp(board, RES, "R_0603_1608Metric", "R28", 68, 44, 0, {"1":"2","2":"11"})
    # RTC INT pull-up
    load_fp(board, RES, "R_0603_1608Metric", "R29", 55, 40, 0, {"1":"2","2":"17"})
    # Decoupling
    load_fp(board, CAP, "C_0603_1608Metric", "C8", 55, 38, 0, {"1":"2","2":"1"})
    load_fp(board, CAP, "C_0603_1608Metric", "C9", 65, 53, 0, {"1":"2","2":"1"})
    load_fp(board, CAP, "C_0805_2012Metric", "C10", 68, 53, 0, {"1":"2","2":"1"})
    load_fp(board, CAP, "C_0805_2012Metric", "C11", 42, 48, 0, {"1":"2","2":"1"})
    load_fp(board, CAP, "C_0805_2012Metric", "C12", 45, 48, 0, {"1":"2","2":"1"})

    print("\n--- Mounting Holes ---")
    for ref, x, y in [("H1",4,4),("H2",86,4),("H3",4,56),("H4",86,56)]:
        load_fp(board, MH, "MountingHole_3.2mm_M3_Pad", ref, x, y, 0, {"1":"1"})

    # Save
    print(f"\nSaving PCB...")
    pcbnew.SaveBoard(PCB_OUT, board)
    print(f"  Saved: {PCB_OUT}")

    # Reload and export DSN
    print(f"Exporting DSN...")
    board2 = pcbnew.LoadBoard(PCB_OUT)
    pcbnew.ExportSpecctraDSN(board2, DSN_OUT)
    sz = os.path.getsize(DSN_OUT)
    print(f"  DSN: {DSN_OUT} ({sz} bytes)")
    print(f"  Footprints: {len(board2.GetFootprints())}")
    print(f"  Nets: {board2.GetNetCount()}")

    # Count pads with nets
    pads_with_nets = sum(1 for fp in board2.GetFootprints() for p in fp.Pads() if p.GetNetname())
    print(f"  Pads with nets: {pads_with_nets}")
    print("\nDone!")


if __name__ == "__main__":
    main()
