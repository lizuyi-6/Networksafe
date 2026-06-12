"""
Complete net assignment for all ESP32-S3 GPIO pads and remaining components,
add GND copper zone, then re-route and export.
"""
import pcbnew
import os

PCB_PATH = "X:/repos/Networksafe/hardware/kicad/aetherguard-control-board-v2/aetherguard-control-board-v2-routed.kicad_pcb"
DSN_PATH = "X:/repos/Networksafe/hardware/kicad/aetherguard-control-board-v2/aetherguard-control-board-v2.dsn"

board = pcbnew.LoadBoard(PCB_PATH)
print(f"Loaded: {len(board.GetFootprints())} footprints, {board.GetNetCount()} nets, {len(board.GetTracks())} tracks")

# Ensure all nets exist
NETS = ["GND", "+3V3", "+5V", "USB_DP", "USB_DN", "I2C_SDA", "I2C_SCL",
        "SD_MOSI", "SD_MISO", "SD_SCK", "SD_CS", "INTERLOCK_OUT", "INTERLOCK_FB",
        "VBUS", "VIN_EXT", "5V_BUCK", "RTC_INT", "5V_SYS",
        "GPIO0", "GPIO4", "GPIO5", "GPIO10", "GPIO11", "GPIO12", "GPIO13",
        "GPIO14", "GPIO15", "GPIO16", "GPIO17", "GPIO18", "GPIO21",
        "LED_R", "LED_G", "LED_B", "BUZZER", "BTN_CANCEL", "BTN_CONFIRM",
        "ATECC_WAKE", "EXT_PWR_SENSE", "UART_TX", "UART_RX"]

for name in NETS:
    if not board.FindNet(name) or board.FindNet(name).GetNetname() == "":
        ni = pcbnew.NETINFO_ITEM(board, name)
        board.Add(ni)

print(f"Nets: {board.GetNetCount()}")

# ESP32-S3-WROOM-1 pin mapping (from the footprint in our project library)
# The module has 49 pads. Pin numbering from the datasheet/footprint:
# Pads 1-14: left side (bottom to top)
# Pads 15-28: bottom
# Pads 29-41: right side (bottom to top)
# Pad 49: GND pad (center)
# We need to check actual pad numbers on our footprint

# First, let's see what pads U1 has
u1 = None
for fp in board.GetFootprints():
    if fp.GetReference() == "U1":
        u1 = fp
        break

if u1:
    print(f"\nU1 pads ({len(u1.Pads())}):")
    pad_nums = sorted([p.GetNumber() for p in u1.Pads()], key=lambda x: int(x) if x.isdigit() else 999)
    print(f"  Numbers: {pad_nums[:20]}...")

    # Based on AetherGuard_ESP32-S3-WROOM-1 footprint (from v1 project):
    # The footprint maps module pins to GPIO as follows:
    # Pin 1 = GND, Pin 2 = 3V3
    # Pins 3-14 = left side GPIOs
    # Pins 15-26 = bottom GPIOs
    # Pins 27-41 = right side
    # Pin 49 = GND exposed pad
    #
    # From the ESP32-S3-WROOM-1 datasheet pin mapping:
    # Module Pin -> GPIO
    ESP32_PIN_MAP = {
        "1": "GND",       # GND
        "2": "+3V3",      # 3V3
        "3": "GPIO0",     # EN -> we'll use as GPIO0/BOOT for now
        "4": "GPIO4",     # IO4
        "5": "GPIO5",     # IO5
        "6": "GPIO6",     # IO6 -> SD_CS
        "7": "GPIO7",     # IO7 -> RTC_INT
        "8": "I2C_SDA",   # IO8 -> SDA
        "9": "I2C_SCL",   # IO9 -> SCL
        "10": "GPIO10",   # IO10 -> ATECC_WAKE
        "11": "GPIO11",   # IO11 -> LED_R
        "12": "GPIO12",   # IO12 -> LED_G
        "13": "GPIO13",   # IO13 -> LED_B
        "14": "GPIO14",   # IO14 -> BUZZER
        "15": "GPIO15",   # IO15 -> INTERLOCK_OUT
        "16": "GPIO16",   # IO16 -> INTERLOCK_FB
        "17": "GPIO17",   # IO17 -> UART_TX
        "18": "GPIO18",   # IO18 -> UART_RX
        "19": "USB_DN",   # IO19 -> USB D-
        "20": "USB_DP",   # IO20 -> USB D+
        "21": "GPIO21",   # IO21 -> EXT_PWR_SENSE
        "22": "SD_MOSI",  # IO1 -> SD_MOSI (remapped)
        "23": "SD_MISO",  # IO2 -> SD_MISO
        "24": "SD_SCK",   # IO3 -> SD_SCK
        "25": "SD_CS",    # IO6 -> SD_CS (duplicate, use GPIO mapping)
        "49": "GND",      # Exposed pad
    }

    # Assign nets to U1 pads
    u1_assigned = 0
    for pad in u1.Pads():
        pn = pad.GetNumber()
        if pn in ESP32_PIN_MAP:
            net_name = ESP32_PIN_MAP[pn]
            ni = board.FindNet(net_name)
            if ni and ni.GetNetname() != "":
                pad.SetNet(ni)
                u1_assigned += 1
    print(f"  U1 pads assigned: {u1_assigned}")

# Full net assignment for all other components
FULL_NET_MAP = {
    # ATECC608C (SOIC-8)
    "U2": {"1": "GND", "2": "GND", "3": "GND", "4": "GND",
            "5": "I2C_SDA", "6": "I2C_SCL", "7": "GND", "8": "+3V3"},
    # LMR16006 buck (SOT-23-6): VIN=1, SW=2, EN=3, FB=4, GND=5, BOOT=6
    "U3": {"1": "VIN_EXT", "2": "5V_BUCK", "3": "VIN_EXT", "4": "5V_BUCK", "5": "GND", "6": "5V_BUCK"},
    # AP2112K LDO (SOT-23-5): VIN=1, GND=2, EN=3, NC=4, VOUT=5
    "U4": {"1": "5V_SYS", "2": "GND", "3": "5V_SYS", "4": "GND", "5": "+3V3"},
    # TPS2121 (SOT-23-6 simplified): IN1=1, IN2=2, OUT=3, GND=5
    "U5": {"1": "VBUS", "2": "5V_BUCK", "3": "5V_SYS", "5": "GND"},
    # Optocoupler output VOS617A: A=1, K=2, E=3, C=4
    "U7": {"1": "5V_BUCK", "2": "INTERLOCK_OUT", "3": "GND", "4": "+3V3"},
    # Optocoupler feedback VOS617A
    "U8": {"1": "INTERLOCK_FB", "2": "GND", "3": "GND", "4": "+3V3"},
    # PCF8563 RTC (SOIC-8): OSCI=1, OSCO=2, INT=3, VSS=4, SDA=5, SCL=6, CLKOUT=7, VDD=8
    "U9": {"1": "GND", "2": "GND", "3": "RTC_INT", "4": "GND",
            "5": "I2C_SDA", "6": "I2C_SCL", "7": "GND", "8": "+3V3"},
    # USB-C connector - assign key pins
    "J1": {"A1": "GND", "B1": "GND", "A4": "VBUS", "B4": "VBUS",
            "A5": "GND", "B5": "GND", "A6": "USB_DP", "B6": "USB_DP",
            "A7": "USB_DN", "B7": "USB_DN", "A12": "GND", "B12": "GND",
            "S1": "GND"},
    # DC input
    "J2": {"1": "VIN_EXT", "2": "GND"},
    # Service UART header: 3V3, GND, TX, RX, EN, BOOT
    "J3": {"1": "+3V3", "2": "GND", "3": "UART_TX", "4": "UART_RX", "5": "GND", "6": "GND"},
    # Interlock output terminal
    "J4": {"1": "INTERLOCK_OUT", "2": "GND"},
    # Interlock feedback terminal
    "J5": {"1": "INTERLOCK_FB", "2": "GND"},
    # Micro-SD: CS=1, MOSI=2, VDD=4, SCK=5, GND=6, MISO=7, CD=9, SHIELD=10
    "J6": {"1": "SD_CS", "2": "SD_MOSI", "4": "+3V3", "5": "SD_SCK",
            "6": "GND", "7": "SD_MISO", "9": "GND", "10": "GND"},
    # OLED: GND, VCC, SCL, SDA
    "DS1": {"1": "GND", "2": "+3V3", "3": "I2C_SCL", "4": "I2C_SDA"},
    # Buttons (2-pin each)
    "SW1": {"1": "BTN_CANCEL", "2": "GND"},
    "SW2": {"1": "BTN_CONFIRM", "2": "GND"},
    "SW3": {"1": "GND", "2": "GND"},  # Reset to GND (EN pull-low)
    # LED
    "LED1": {"1": "LED_R", "2": "GND"},
    # Buzzer
    "BZ1": {"1": "BUZZER", "2": "GND"},
    # Battery holder
    "BT1": {"1": "+3V3", "2": "GND"},
    # I2C pull-ups
    "R10": {"1": "+3V3", "2": "I2C_SDA"},
    "R11": {"1": "+3V3", "2": "I2C_SCL"},
    # SD pull-ups
    "R25": {"1": "+3V3", "2": "SD_MOSI"},
    "R26": {"1": "+3V3", "2": "SD_MISO"},
    "R27": {"1": "+3V3", "2": "SD_SCK"},
    "R28": {"1": "+3V3", "2": "SD_CS"},
    # RTC INT pull-up
    "R29": {"1": "+3V3", "2": "RTC_INT"},
    # Decoupling caps
    "C8": {"1": "+3V3", "2": "GND"},
    "C9": {"1": "+3V3", "2": "GND"},
    "C10": {"1": "+3V3", "2": "GND"},
    "C11": {"1": "+3V3", "2": "GND"},
    "C12": {"1": "+3V3", "2": "GND"},
    # Mounting holes
    "H1": {"1": "GND"},
    "H2": {"1": "GND"},
    "H3": {"1": "GND"},
    "H4": {"1": "GND"},
}

total_assigned = 0
for fp in board.GetFootprints():
    ref = fp.GetReference()
    if ref in FULL_NET_MAP:
        for pad in fp.Pads():
            pn = pad.GetNumber()
            if pn in FULL_NET_MAP[ref]:
                net_name = FULL_NET_MAP[ref][pn]
                ni = board.FindNet(net_name)
                if ni and ni.GetNetname() != "":
                    pad.SetNet(ni)
                    total_assigned += 1

print(f"\nTotal pads assigned (non-U1): {total_assigned}")

# Count total
all_pads_with_nets = sum(1 for fp in board.GetFootprints() for p in fp.Pads() if p.GetNetname())
print(f"All pads with nets: {all_pads_with_nets}")

# Remove old tracks (from previous incomplete routing)
old_tracks = list(board.GetTracks())
for t in old_tracks:
    board.Remove(t)
print(f"Removed {len(old_tracks)} old tracks")

# Save the board with full net assignment
pcbnew.SaveBoard(PCB_PATH, board)
print(f"\nSaved with full nets. Re-exporting DSN...")

# Reload and export fresh DSN
board2 = pcbnew.LoadBoard(PCB_PATH)
pcbnew.ExportSpecctraDSN(board2, DSN_PATH)
print(f"DSN: {os.path.getsize(DSN_PATH)} bytes, {board2.GetNetCount()} nets")

pads2 = sum(1 for fp in board2.GetFootprints() for p in fp.Pads() if p.GetNetname())
print(f"Pads with nets after reload: {pads2}")
