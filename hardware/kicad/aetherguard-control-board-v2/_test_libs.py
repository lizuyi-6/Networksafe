"""
Build v2 PCB with footprints loaded via KiCad's global fp-lib-table.
Uses GetFootprintLibraries() + FootprintLoad() with proper library resolution.
"""
import pcbnew
import os

PROJECT_DIR = "X:/repos/Networksafe/hardware/kicad/aetherguard-control-board-v2"
PCB_OUT = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2.kicad_pcb")
DSN_OUT = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2.dsn")
LOCAL_FP_LIB = os.path.join(PROJECT_DIR, "aetherguard-control-board-v2.pretty")

print("Available footprint libraries:")
libs = pcbnew.GetFootprintLibraries()
print(f"  Total: {len(libs)} libraries")

# Find relevant libraries
target_libs = ["Package_SO", "Package_TO_SOT_SMD", "Connector_PinHeader_2.54mm",
               "Capacitor_SMD", "Resistor_SMD", "Button_Switch_SMD", "LED_SMD",
               "Buzzer_Beeper", "MountingHole", "Package_DFN_QFN"]
found = {}
for lib in libs:
    for t in target_libs:
        if t.lower() in lib.lower():
            found[t] = lib
            break

print(f"  Found matching: {list(found.keys())}")

# List footprints in Package_SO
if "Package_SO" in found:
    fps = pcbnew.FootprintEnumerate(found["Package_SO"])
    soic8 = [f for f in fps if "SOIC-8" in f and "3.9x4.9" in f]
    print(f"  SOIC-8 variants: {soic8[:3]}")

# Try loading a footprint
for lib_name, lib_path in found.items():
    try:
        if lib_name == "Resistor_SMD":
            fp = pcbnew.FootprintLoad(lib_path, "R_0603_1608Metric")
            print(f"  OK: {lib_name} -> R_0603_1608Metric ({len(fp.Pads())} pads)")
            break
    except Exception as e:
        print(f"  FAIL {lib_name}: {e}")
