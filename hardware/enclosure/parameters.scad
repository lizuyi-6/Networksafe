// AetherGuard Gateway Appliance enclosure shared parameters.
// Units: millimeters.

// Overall industrial appliance envelope.
ENCLOSURE_W = 300;
ENCLOSURE_D = 210;
ENCLOSURE_H = 118;
CORNER_R = 8;

// FDM prototype wall model.
WALL = 3;
FLOOR_T = 3;
ROOF_T = 4;
DECK_T = 3;
DECK_SPLIT_Z = 52;
EPS = 0.2;

// Front-panel working area.
PANEL_W = ENCLOSURE_W - 2 * WALL;
PANEL_H = ENCLOSURE_H - FLOOR_T;
PANEL_T = 3;

// Network/service cutouts on the front panel.
RJ45_W = 17;
RJ45_H = 14;
RJ45_Z = 35;
SERVER_PORT_X = 32;
LANWAN_PORT_X = 74;
MGMT_PORT_X = 122;

USB_C_W = 11;
USB_C_H = 6;
SERVICE_USB_X = 156;
SERVICE_USB_Z = 34;

// Operator controls.
BUTTON_DIAMETER = 22.5;
ESTOP_X = 208;
ESTOP_Z = 36;
CONFIRM_X = 255;
CONFIRM_Z = 36;
BUTTON_GUARD_OD = 32;

// Status window and LEDs.
STATUS_WINDOW_W = 88;
STATUS_WINDOW_H = 13;
STATUS_WINDOW_X = 197;
STATUS_WINDOW_Z = 77;
LED_D = 5.2;

// Rear cable entries.
POWER_INLET_W = 28;
POWER_INLET_H = 16;
POWER_INLET_X = 46;
POWER_INLET_Z = 29;
CABLE_GLAND_QTY = 4;
CABLE_GLAND_DIAMETER = 12;
CABLE_GLAND_START_X = 98;
CABLE_GLAND_SPACING = 34;
CABLE_GLAND_Z = 28;

// Cover and top-mounted stack light.
TOP_COVER_SCREW_D = 4.3;
TOP_COVER_SCREW_HEAD_D = 8.5;
STACK_LIGHT_DIAMETER = 40;
STACK_LIGHT_X = 250;
STACK_LIGHT_Y = 158;

// Internal M1 gateway fit envelope (Protectli VP2430 class).
M1_W = 145;
M1_D = 128;
M1_H = 40;
M1_X = 13;
M1_Y = 54;
M1_RETAINER_H = 8;
M1_RETAINER_T = 4;

// Internal M2 controller fit envelope (NUCLEO-H563ZI class).
NUCLEO_W = 122;
NUCLEO_D = 108;
NUCLEO_X = 166;
NUCLEO_Y = 66;
STANDOFF_HEIGHT = 8;
STANDOFF_OD = 7;
STANDOFF_HOLE_D = 3.2;

// Internal M3 secure element envelope.
SE_W = 24;
SE_D = 24;
SE_H = 8;
SE_X = 264;
SE_Y = 64;

// Lower-bay DIN rail and module envelopes.
INTERNAL_DIN_X = 13;
INTERNAL_DIN_Y = 26;
INTERNAL_DIN_Z = 3;
INTERNAL_DIN_LEN = 274;
DIN_RAIL_WIDTH = 35;
DIN_RAIL_HEIGHT = 8;

PSU_W = 96;
RELAY_W = 74;
OPTO_W = 72;
DIN_MODULE_D = 58;
DIN_MODULE_H = 38;
DIN_MODULE_GAP = 8;

// External rear DIN-rail clip.
DIN_RAIL_CLIP_DEPTH = 16;
DIN_RAIL_CLIP_HEIGHT = 22;

// Ventilation.
VENT_SLOT_W = 4;
VENT_SLOT_LEN = 22;
VENT_SLOT_H = 14;
VENT_QTY = 7;
VENT_SPACING = 16;
