"""
Fix net assignment: add nets to board properly, then assign to pads.
"""
import pcbnew
import os

PCB_PATH = "X:/repos/Networksafe/hardware/kicad/aetherguard-control-board-v2/aetherguard-control-board-v2.kicad_pcb"
DSN_PATH = "X:/repos/Networksafe/hardware/kicad/aetherguard-control-board-v2/aetherguard-control-board-v2.dsn"

board = pcbnew.LoadBoard(PCB_PATH)
print(f"Loaded: {len(board.GetFootprints())} footprints")

# First, add all nets to the board's netinfo list
NETS = ["GND", "+3V3", "+5V", "USB_DP", "USB_DN", "I2C_SDA", "I2C_SCL",
        "SD_MOSI", "SD_MISO", "SD_SCK", "SD_CS", "INTERLOCK_OUT", "INTERLOCK_FB",
        "VBUS", "VIN_EXT", "5V_BUCK", "RTC_INT", "5V_SYS"]

netinfo = board.GetNetInfo()
for i, name in enumerate(NETS, start=1):
    existing = board.FindNet(name)
    if not existing or existing.GetNetname() == "":
        ni = pcbnew.NETINFO_ITEM(board, name)
        board.Add(ni)
        print(f"  Added net: {name}")

# Verify nets
print(f"\nNets after adding: {board.GetNetCount()}")
for name in NETS:
    ni = board.FindNet(name)
    if ni:
        print(f"  {name}: netcode={ni.GetNetCode()}")
    else:
        print(f"  {name}: NOT FOUND")

# Now assign pads
NET_MAP = {
    "U2": {"4": "GND", "5": "I2C_SDA", "6": "I2C_SCL", "8": "+3V3"},
    "U3": {"5": "GND", "2": "5V_BUCK"},
    "U4": {"2": "GND", "5": "+3V3", "1": "5V_SYS"},
    "U5": {"5": "GND", "2": "5V_SYS"},
    "U7": {"3": "GND"},
    "U8": {"3": "GND"},
    "U9": {"4": "GND", "5": "I2C_SDA", "6": "I2C_SCL", "8": "+3V3"},
    "J2": {"1": "VIN_EXT", "2": "GND"},
    "DS1": {"1": "GND", "2": "+3V3", "3": "I2C_SCL", "4": "I2C_SDA"},
    "BT1": {"1": "+3V3", "2": "GND"},
    "R10": {"1": "+3V3", "2": "I2C_SDA"},
    "R11": {"1": "+3V3", "2": "I2C_SCL"},
    "R25": {"1": "+3V3", "2": "SD_MOSI"},
    "R26": {"1": "+3V3", "2": "SD_MISO"},
    "R27": {"1": "+3V3", "2": "SD_SCK"},
    "R28": {"1": "+3V3", "2": "SD_CS"},
    "R29": {"1": "+3V3", "2": "RTC_INT"},
    "C8": {"1": "+3V3", "2": "GND"},
    "C9": {"1": "+3V3", "2": "GND"},
    "C10": {"1": "+3V3", "2": "GND"},
    "C11": {"1": "+3V3", "2": "GND"},
    "C12": {"1": "+3V3", "2": "GND"},
    "H1": {"1": "GND"},
    "H2": {"1": "GND"},
    "H3": {"1": "GND"},
    "H4": {"1": "GND"},
}

assigned = 0
for fp in board.GetFootprints():
    ref = fp.GetReference()
    if ref in NET_MAP:
        for pad in fp.Pads():
            pn = pad.GetNumber()
            if pn in NET_MAP[ref]:
                net_name = NET_MAP[ref][pn]
                ni = board.FindNet(net_name)
                if ni and ni.GetNetname() != "":
                    pad.SetNet(ni)
                    assigned += 1

print(f"\nAssigned {assigned} pad-net connections")
pads_with_nets = sum(1 for fp in board.GetFootprints() for p in fp.Pads() if p.GetNetname())
print(f"Total pads with nets: {pads_with_nets}")

pcbnew.SaveBoard(PCB_PATH, board)
board2 = pcbnew.LoadBoard(PCB_PATH)
print(f"\nAfter reload: {board2.GetNetCount()} nets")
pcbnew.ExportSpecctraDSN(board2, DSN_PATH)
print(f"DSN: {os.path.getsize(DSN_PATH)} bytes")
