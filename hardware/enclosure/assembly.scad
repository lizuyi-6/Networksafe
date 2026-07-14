// AetherGuard Gateway Appliance enclosure - assembly/fit preview.
//
// This file is for visual verification only. Do not print as one part.
//
// Render:
//   openscad --imgsize 1400,1000 --camera 170,125,105,70,18,46,840 --projection o -o assembly.png assembly.scad

include <parameters.scad>
use <chassis.scad>
use <front-panel.scad>
use <top-cover.scad>

$fn = 64;

// Chassis and service panels.
color("gainsboro", 0.72)
    chassis();

color("dimgray", 0.92)
    translate([WALL, 0, FLOOR_T])
        front_panel();

color("lightsteelblue", 0.38)
    translate([WALL, WALL, ENCLOSURE_H - ROOF_T])
        top_cover();

// Lower interlock bay modules on the internal DIN rail.
din_module("24V PSU", [PSU_W, DIN_MODULE_D, DIN_MODULE_H], [18, INTERNAL_DIN_Y - 10, INTERNAL_DIN_Z + DIN_RAIL_HEIGHT], "silver");
din_module("RELAY", [RELAY_W, DIN_MODULE_D, DIN_MODULE_H], [18 + PSU_W + DIN_MODULE_GAP, INTERNAL_DIN_Y - 10, INTERNAL_DIN_Z + DIN_RAIL_HEIGHT], "orange");
din_module("OPTO I/O", [OPTO_W, DIN_MODULE_D, DIN_MODULE_H], [18 + PSU_W + RELAY_W + 2 * DIN_MODULE_GAP, INTERNAL_DIN_Y - 10, INTERNAL_DIN_Z + DIN_RAIL_HEIGHT], "khaki");

// Upper electronics deck.
z_upper = DECK_SPLIT_Z + DECK_T;

component_box(
    "M1 GATEWAY",
    [M1_W - 2 * M1_RETAINER_T - 4, M1_D - 2 * M1_RETAINER_T - 4, M1_H],
    [M1_X + M1_RETAINER_T + 2, M1_Y + M1_RETAINER_T + 2, z_upper + 1],
    "slategray"
);

color("seagreen", 0.84)
    translate([NUCLEO_X, NUCLEO_Y, z_upper + STANDOFF_HEIGHT])
        cube([NUCLEO_W, NUCLEO_D, 2.2]);
label_on_top("M2 NUCLEO-H563ZI", NUCLEO_X + NUCLEO_W / 2, NUCLEO_Y + NUCLEO_D / 2, z_upper + STANDOFF_HEIGHT + 2.3, 5);

component_box(
    "M3 SE",
    [SE_W, SE_D, SE_H],
    [SE_X, SE_Y, z_upper + 5],
    "gold"
);

// Front mounted operator controls and passthrough connectors.
front_rj45(SERVER_PORT_X, "SERVER");
front_rj45(LANWAN_PORT_X, "LAN/WAN");
front_rj45(MGMT_PORT_X, "MGMT");

color("red")
    translate([WALL + ESTOP_X, -13, FLOOR_T + ESTOP_Z])
        rotate([90, 0, 0])
            cylinder(h = 16, d = 31);

color("forestgreen")
    translate([WALL + CONFIRM_X, -10, FLOOR_T + CONFIRM_Z])
        rotate([90, 0, 0])
            cylinder(h = 12, d = 27);

// Status light pipe.
color("black", 0.65)
    translate([WALL + STATUS_WINDOW_X - STATUS_WINDOW_W / 2, -2.2, FLOOR_T + STATUS_WINDOW_Z - STATUS_WINDOW_H / 2])
        cube([STATUS_WINDOW_W, 2, STATUS_WINDOW_H]);

// Top stack light.
stack_light();

module din_module(label, size, pos, shade) {
    color(shade, 0.78)
        translate(pos)
            cube(size);
    label_on_top(label, pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2] + 0.6, 4.8);
}

module component_box(label, size, pos, shade) {
    color(shade, 0.72)
        translate(pos)
            cube(size);
    label_on_top(label, pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2] + 0.6, 5);
}

module front_rj45(cx, label) {
    color("black")
        translate([WALL + cx - RJ45_W / 2, -7, FLOOR_T + RJ45_Z - RJ45_H / 2])
            cube([RJ45_W, 8, RJ45_H]);
}

module stack_light() {
    translate([STACK_LIGHT_X, STACK_LIGHT_Y, ENCLOSURE_H]) {
        color("black")
            cylinder(h = 6, d = STACK_LIGHT_DIAMETER);
        color("red", 0.85)
            translate([0, 0, 6])
                cylinder(h = 14, d = 30);
        color("gold", 0.85)
            translate([0, 0, 20])
                cylinder(h = 14, d = 30);
        color("limegreen", 0.85)
            translate([0, 0, 34])
                cylinder(h = 14, d = 30);
    }
}

module label_on_top(label, cx, cy, cz, size_value) {
    color("black")
        translate([cx, cy, cz])
            linear_extrude(height = 0.35)
                text(label, size = size_value, halign = "center", valign = "center");
}
