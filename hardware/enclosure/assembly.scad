// AetherGuard Root-Resistant Gateway enclosure - assembly preview.
//
// This file is a visual fit check, not a printable part. Set SERVICE_PREVIEW
// to true to lift the lid and expose the single-level internal layout.
//
// Hero render:
//   openscad --imgsize 1600,1100 --camera 175,145,110,68,0,42,940 --projection o -o assembly.png assembly.scad
// Service render:
//   openscad -D SERVICE_PREVIEW=true --imgsize 1600,1100 --camera 170,175,150,66,0,52,1050 --projection o -o assembly-service.png assembly.scad

include <parameters.scad>
use <geometry.scad>
use <chassis.scad>
use <front-panel.scad>
use <top-cover.scad>

$fn = 64;

SERVICE_PREVIEW = false;
show_internals = SERVICE_PREVIEW;
lid_lift = show_internals ? 74 : 0;
lid_shift_y = show_internals ? 75 : 0;

// Structural enclosure.
color("#171d22", show_internals ? 0.72 : 1)
    chassis();

color("#0d1317", show_internals ? 0.42 : 1)
    translate([WALL, 0, FLOOR_T])
        front_panel();

color("#27333b")
    translate([
        WALL,
        WALL + lid_shift_y,
        ENCLOSURE_H - ROOF_T + lid_lift
    ])
        top_cover();

front_visual_inlays();
front_connectors_and_controls();
status_light_pipe();
top_visual_inlays(lid_lift, lid_shift_y);
stack_light(lid_lift, lid_shift_y);

if (show_internals) {
    internal_components();
}

module internal_components() {
    component_box(
        "M1 GATEWAY",
        [
            M1_W - 2 * M1_RETAINER_T - 3,
            M1_D - 2 * M1_RETAINER_T - 3,
            M1_H
        ],
        [
            M1_X + M1_RETAINER_T + 1.5,
            M1_Y + M1_RETAINER_T + 1.5,
            FLOOR_T + 1
        ],
        "#44515a"
    );

    color("#1e8f63", 0.9)
        translate([NUCLEO_X, NUCLEO_Y, FLOOR_T + STANDOFF_HEIGHT])
            cube([NUCLEO_W, NUCLEO_D, 2.2]);
    label_on_top(
        "M2 STM32H563",
        NUCLEO_X + NUCLEO_W / 2,
        NUCLEO_Y + NUCLEO_D / 2,
        FLOOR_T + STANDOFF_HEIGHT + 2.3,
        5
    );

    component_box(
        "M3 SE",
        [SE_W, SE_D, SE_H],
        [SE_X, SE_Y, FLOOR_T + 5],
        "#d9aa34"
    );

    din_module(
        "24V DIST.",
        [PSU_W, DIN_MODULE_D, DIN_MODULE_H],
        [DIN_MODULE_START_X, DIN_MODULE_START_Y, FLOOR_T + DIN_RAIL_HEIGHT],
        "#b7c0c5"
    );
    din_module(
        "FAIL-CLOSED RELAY",
        [RELAY_W, DIN_MODULE_D, DIN_MODULE_H],
        [
            DIN_MODULE_START_X + PSU_W + DIN_MODULE_GAP,
            DIN_MODULE_START_Y,
            FLOOR_T + DIN_RAIL_HEIGHT
        ],
        "#d7802c"
    );
    din_module(
        "OPTO I/O",
        [OPTO_W, DIN_MODULE_D, DIN_MODULE_H],
        [
            DIN_MODULE_START_X + PSU_W + RELAY_W + 2 * DIN_MODULE_GAP,
            DIN_MODULE_START_Y,
            FLOOR_T + DIN_RAIL_HEIGHT
        ],
        "#d1b860"
    );
}

module front_connectors_and_controls() {
    front_rj45(SERVER_PORT_X, "#15191c");
    front_rj45(LANWAN_PORT_X, "#15191c");
    front_rj45(MGMT_PORT_X, "#043b40");

    color("#15191c")
        translate([
            WALL + SERVICE_USB_X - USB_C_W / 2,
            -5.8,
            FLOOR_T + SERVICE_USB_Z - USB_C_H / 2
        ])
            cube([USB_C_W, 6, USB_C_H]);

    color("#d8202f")
        translate([WALL + ESTOP_X, -13, FLOOR_T + ESTOP_Z])
            rotate([90, 0, 0])
                cylinder(h = 15, d = 31);
    color("#f2aa22")
        translate([WALL + ESTOP_X, -3.4, FLOOR_T + ESTOP_Z])
            rotate([90, 0, 0])
                cylinder(h = 4, d = 35);

    color("#35b86b")
        translate([WALL + CONFIRM_X, -10, FLOOR_T + CONFIRM_Z])
            rotate([90, 0, 0])
                cylinder(h = 12, d = 26);
}

module status_light_pipe() {
    window_left = WALL + STATUS_WINDOW_X - STATUS_WINDOW_W / 2;
    segment_width = STATUS_WINDOW_W / STATUS_SEGMENT_COUNT;
    state_colors = ["#e33b42", "#efb72d", "#35c878", "#e83b9a"];

    color("#050809", 0.92)
        translate([
            window_left,
            -2.1,
            FLOOR_T + STATUS_WINDOW_Z - STATUS_WINDOW_H / 2
        ])
            cube([STATUS_WINDOW_W, 2, STATUS_WINDOW_H]);

    for (segment_index = [0 : STATUS_SEGMENT_COUNT - 1]) {
        color(state_colors[segment_index], 0.9)
            translate([
                window_left + segment_index * segment_width + 4,
                -2.5,
                FLOOR_T + STATUS_WINDOW_Z - 2.4
            ])
                cube([segment_width - 8, 1.1, 4.8]);
    }
}

module front_visual_inlays() {
    accent_y = -1.85;

    color("#29d3c2") {
        translate([WALL + 18, accent_y, FLOOR_T + 48])
            cube([164, 0.35, 1.1]);
        translate([WALL + 128 - RJ45_W / 2 - 2.4, accent_y, FLOOR_T + RJ45_Z + RJ45_H / 2])
            cube([RJ45_W + 4.8, 0.35, 2.4]);
        visual_panel_text("AETHERGUARD", WALL + 93, FLOOR_T + 66, 9.2, accent_y);
        visual_panel_text("AG", WALL + 29, FLOOR_T + 64, 6.5, accent_y);
    }

    color("#cbd5d9") {
        visual_panel_text(
            "ROOT-RESISTANT GATEWAY",
            WALL + 97,
            FLOOR_T + 55.5,
            4.1,
            accent_y
        );
    }
}

module top_visual_inlays(current_lid_lift, current_lid_shift_y) {
    accent_z = ENCLOSURE_H + current_lid_lift + 3.2;

    color("#29d3c2") {
        translate([
            ENCLOSURE_W / 2,
            102 + current_lid_shift_y,
            accent_z
        ])
            hex_ring(22, 2.4, 0.35);
        translate([
            ENCLOSURE_W / 2,
            102 + current_lid_shift_y,
            accent_z
        ])
            linear_extrude(height = 0.35)
                text("AG", size = 7.5, halign = "center", valign = "center");
    }
}

module front_rj45(center_x, shade) {
    color(shade)
        translate([
            WALL + center_x - RJ45_W / 2,
            -7,
            FLOOR_T + RJ45_Z - RJ45_H / 2
        ])
            cube([RJ45_W, 8, RJ45_H]);
}

module stack_light(current_lid_lift, current_lid_shift_y) {
    stack_base_z = ENCLOSURE_H + current_lid_lift + 3.5;

    translate([
        STACK_LIGHT_X,
        STACK_LIGHT_Y + current_lid_shift_y,
        stack_base_z
    ]) {
        color("#111619")
            cylinder(h = 7, d = 43);
        color("#cf3037", 0.9)
            translate([0, 0, 7])
                cylinder(h = 11, d = 29);
        color("#e1a92c", 0.9)
            translate([0, 0, 18])
                cylinder(h = 11, d = 29);
        color("#38bf69", 0.9)
            translate([0, 0, 29])
                cylinder(h = 11, d = 29);
        color("#101518")
            translate([0, 0, 40])
                cylinder(h = 3, d = 30);
    }
}

module din_module(label, size, position, shade) {
    color(shade, 0.86)
        translate(position)
            cube(size);
    label_on_top(
        label,
        position[0] + size[0] / 2,
        position[1] + size[1] / 2,
        position[2] + size[2] + 0.6,
        4.1
    );
}

module component_box(label, size, position, shade) {
    color(shade, 0.84)
        translate(position)
            cube(size);
    label_on_top(
        label,
        position[0] + size[0] / 2,
        position[1] + size[1] / 2,
        position[2] + size[2] + 0.6,
        5
    );
}

module label_on_top(label, center_x, center_y, center_z, size_value) {
    color("#111619")
        translate([center_x, center_y, center_z])
            linear_extrude(height = 0.35)
                text(label, size = size_value, halign = "center", valign = "center");
}

module visual_panel_text(label, center_x, center_z, size_value, front_y) {
    translate([center_x, front_y, center_z])
        rotate([90, 0, 0])
            linear_extrude(height = 0.25)
                text(label, size = size_value, halign = "center", valign = "center");
}
