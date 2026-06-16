// AetherGuard Gateway Appliance Enclosure — Shared Parameters
//
// Edit these to resize the enclosure for different module sizes.
// All other .scad files `use <parameters.scad>` and derive from these.

// === External dimensions (mm) ===
ENCLOSURE_W = 200;    // Width  (X) — fits DIN-rail section + NUCLEO above
ENCLOSURE_D = 130;    // Depth  (Y) — fits NUCLEO (122mm) + wiring clearance
ENCLOSURE_H = 110;    // Height (Z) — upper deck (NUCLEO) + lower (DIN modules)

// === Wall thickness ===
WALL = 3;             // 3mm for 3D print strength
FLOOR_T = 3;
ROOF_T = 3;

// === Internal layout ===
// Upper deck: NUCLEO + SE (above mid-plane)
// Lower deck: DIN-rail modules (relay, opto, PSU)
DECK_SPLIT_Z = 55;    // Height of internal shelf separating decks

// === DIN-rail clip (35mm top-hat) ===
DIN_RAIL_WIDTH = 35;
DIN_RAIL_CLIP_DEPTH = 15;   // How far clip extends from back
DIN_RAIL_CLIP_HEIGHT = 18;  // Top-hat flange capture height

// === Front panel cutouts ===
BUTTON_DIAMETER = 22;       // Standard industrial button (E-stop + confirm)
ESTOP_X = 35;               // E-stop center X position
ESTOP_Z = 35;               // E-stop center Z position
CONFIRM_X = 70;             // Confirm button center X
CONFIRM_Z = 35;
LED_WINDOW_W = 40;          // Status LED viewing window
LED_WINDOW_H = 15;
LED_WINDOW_X = 110;
LED_WINDOW_Z = 28;

// === Rear panel cutouts ===
USB_C_DIAMETER = 12;        // USB-C passthrough gland
USB_C_X = 30;
USB_C_Z = 40;
CABLE_GLAND_QTY = 4;        // Relay/opto/PSU wiring glands
CABLE_GLAND_DIAMETER = 10;
CABLE_GLAND_START_X = 60;
CABLE_GLAND_SPACING = 25;

// === Top cover ===
TOP_COVER_SCREW_D = 4;      // M4 screws (4x corners)
STACK_LIGHT_DIAMETER = 40;  // Optional top-mounted stack light

// === Internal standoffs (NUCLEO-H563ZI) ===
NUCLEO_W = 122;
NUCLEO_D = 108;
STANDOFF_HEIGHT = 8;
STANDOFF_HOLE_D = 3.2;      // M3 screw clearance

// === Ventilation ===
VENT_SLOT_W = 3;
VENT_SLOT_H = 40;
VENT_SLOT_SPACING = 8;
VENT_QTY = 8;               // per side
