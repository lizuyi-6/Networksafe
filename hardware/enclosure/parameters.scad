// AetherGuard Root-Resistant Gateway enclosure shared parameters.
// Units: millimeters. OpenSCAD 2021.01+.

// Low-profile structural chassis envelope. The 210 mm depth preserves
// compatibility with common 220 x 220 mm printers after the width is split.
// The raised lid armor reaches approximately 92 mm before the stack light.
ENCLOSURE_W = 320;
ENCLOSURE_D = 210;
ENCLOSURE_H = 88;
CORNER_R = 9;

// FDM prototype shell model.
WALL = 3.2;
FLOOR_T = 3.4;
ROOF_T = 3.2;
PANEL_T = 3.2;
EPS = 0.2;

PANEL_W = ENCLOSURE_W - 2 * WALL;
PANEL_H = ENCLOSURE_H - FLOOR_T - ROOF_T;
COVER_D = ENCLOSURE_D - 2 * WALL;

// Front-panel fasteners. Coordinates are relative to the removable panel.
FRONT_PANEL_SCREW_D = 3.4;
FRONT_PANEL_SCREW_POSITIONS = [
    [10, 10],
    [10, PANEL_H - 10],
    [PANEL_W / 2 - 12, PANEL_H - 9],
    [PANEL_W / 2 + 12, PANEL_H - 9],
    [PANEL_W - 10, 10],
    [PANEL_W - 10, PANEL_H - 10]
];

// Network and service cutouts. The fit allowance is intended for panel-mount
// couplers rather than direct alignment to a specific gateway motherboard.
RJ45_W = 18.2;
RJ45_H = 15.4;
RJ45_Z = 29;
SERVER_PORT_X = 32;
LANWAN_PORT_X = 76;
MGMT_PORT_X = 128;

USB_C_W = 12;
USB_C_H = 7;
SERVICE_USB_X = 168;
SERVICE_USB_Z = 29;

// Operator controls. The E-stop guard is deliberately larger than the confirm
// guard so the controls remain distinguishable by touch.
BUTTON_DIAMETER = 22.5;
ESTOP_X = 236;
ESTOP_Z = 27;
CONFIRM_X = 286;
CONFIRM_Z = 27;
ESTOP_GUARD_OD = 40;
CONFIRM_GUARD_OD = 32;

// Four-segment state window: isolated, armed, released, and fault.
STATUS_WINDOW_W = 120;
STATUS_WINDOW_H = 13;
STATUS_WINDOW_X = 246;
STATUS_WINDOW_Z = 59;
STATUS_SEGMENT_COUNT = 4;
LED_D = 6;

// Rear service interface. The rectangular opening accepts a replaceable power
// inlet sub-panel; round entries are for isolated control and light harnesses.
POWER_MODULE_W = 76;
POWER_MODULE_H = 32;
POWER_MODULE_X = 49;
POWER_MODULE_Z = 27;
CABLE_GLAND_QTY = 4;
CABLE_GLAND_DIAMETER = 12.5;
CABLE_GLAND_START_X = 112;
CABLE_GLAND_SPACING = 33;
CABLE_GLAND_Z = 27;
GROUND_LUG_DIAMETER = 5.2;
GROUND_LUG_X = 272;
GROUND_LUG_Z = 27;

// Top cover and optional 22 mm stack-light mounting pattern.
TOP_COVER_SCREW_D = 4.3;
TOP_COVER_SCREW_HEAD_D = 8.5;
TOP_COVER_SCREW_POSITIONS = [
    [12, 12],
    [PANEL_W / 2 - 20, 12],
    [PANEL_W / 2 + 20, 12],
    [PANEL_W - 12, 12],
    [12, COVER_D - 12],
    [PANEL_W / 2 - 20, COVER_D - 12],
    [PANEL_W / 2 + 20, COVER_D - 12],
    [PANEL_W - 12, COVER_D - 12]
];
STACK_LIGHT_SHAFT_D = 22.5;
STACK_LIGHT_COLLAR_OD = 48;
STACK_LIGHT_BOLT_CIRCLE_D = 36;
STACK_LIGHT_MOUNT_D = 3.4;
STACK_LIGHT_X = 286;
STACK_LIGHT_Y = 172;

// Single-level logic bay. M1 and M2 sit side-by-side to shorten service paths
// and remove the inaccessible lower electronics deck from the previous model.
LOGIC_BAY_END_Y = 143;
POWER_PARTITION_Y = 145;
POWER_PARTITION_T = 3;
POWER_PARTITION_TOP_Z = 76;
PARTITION_GROMMET_D = 14;

// M1 gateway fit envelope (Protectli VP2430 class).
M1_W = 145;
M1_D = 128;
M1_H = 40;
M1_X = 10;
M1_Y = 11;
M1_RETAINER_H = 7;
M1_RETAINER_T = 4;

// M2 controller fit envelope (NUCLEO-H563ZI class).
NUCLEO_W = 122;
NUCLEO_D = 108;
NUCLEO_X = 168;
NUCLEO_Y = 35;
STANDOFF_HEIGHT = 7;
STANDOFF_OD = 8;
STANDOFF_HOLE_D = 3.2;

// M3 secure-element fit envelope and guarded carrier location.
SE_W = 24;
SE_D = 24;
SE_H = 8;
SE_X = 266;
SE_Y = 8;
SE_VAULT_WALL = 2.4;

// Rear M4 interlock bay. The rail is transverse so relay, optocoupler, and
// distribution modules remain reachable after the lid is removed.
INTERNAL_DIN_X = 16;
INTERNAL_DIN_Y = 160;
INTERNAL_DIN_Z = FLOOR_T;
INTERNAL_DIN_LEN = 288;
DIN_RAIL_WIDTH = 35;
DIN_RAIL_HEIGHT = 8;

PSU_W = 92;
RELAY_W = 70;
OPTO_W = 68;
DIN_MODULE_D = 56;
DIN_MODULE_H = 42;
DIN_MODULE_GAP = 8;
DIN_MODULE_START_X = 22;
DIN_MODULE_START_Y = 148;

// Dual rear DIN-rail clips distribute the enclosure load across the rail.
INTEGRATED_DIN_CLIPS = false;
DIN_RAIL_CLIP_WIDTH = 62;
DIN_RAIL_CLIP_DEPTH = 16;
DIN_RAIL_CLIP_HEIGHT = 24;
DIN_RAIL_CLIP_CENTERS_X = [90, 230];
DIN_RAIL_CLIP_MOUNT_Z = 48;

// Ventilation and chassis detailing.
SIDE_VENT_ROWS = 2;
SIDE_VENT_QTY = 6;
SIDE_VENT_SPACING = 18;
SIDE_VENT_SLOT_LEN = 13;
SIDE_VENT_SLOT_H = 3.4;
TOP_VENT_SLOT_W = 5;
TOP_VENT_SLOT_LEN = 58;
CHASSIS_ARMOR_RAIL_DEPTH = 1.6;

// Bottom mounting points accept M4 rubber feet or a separate wall bracket.
BOTTOM_MOUNT_D = 4.3;
BOTTOM_MOUNT_POSITIONS = [
    [22, 24],
    [ENCLOSURE_W - 22, 24],
    [22, ENCLOSURE_D - 24],
    [ENCLOSURE_W - 22, ENCLOSURE_D - 24]
];
