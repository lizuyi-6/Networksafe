// AetherGuard Root-Resistant Gateway enclosure - armored top cover.
//
// The low-profile lid combines passive airflow, a stiff center spine, a
// standardized 22 mm stack-light pattern, and paint-fill branding grooves.
//
// Render/export:
//   openscad -o top-cover.stl top-cover.scad

include <parameters.scad>
use <geometry.scad>

$fn = 64;

module top_cover() {
    stack_light_local_x = STACK_LIGHT_X - WALL;
    stack_light_local_y = STACK_LIGHT_Y - WALL;

    difference() {
        union() {
            rounded_prism(
                [PANEL_W, COVER_D, ROOF_T],
                max(CORNER_R - WALL, 1)
            );

            // Shallow armor skin and center spine add stiffness without making
            // the full lid thick or heavy.
            translate([16, 16, ROOF_T - EPS])
                rounded_prism([PANEL_W - 32, COVER_D - 32, 1.8], 6);
            translate([PANEL_W / 2 - 14, 29, ROOF_T + 1.5])
                rounded_prism([28, COVER_D - 58, 1.4], 4);

            stack_light_collar(stack_light_local_x, stack_light_local_y);
        }

        cover_fastener_holes();
        stack_light_mount_holes(stack_light_local_x, stack_light_local_y);
        logic_vent_banks();
        interlock_exhaust_bank();
        top_style_grooves();
        tamper_seal_holes();
        top_branding_engraving();
    }

    underside_registration_skirt();
    underside_stiffening_ribs();
}

module cover_fastener_holes() {
    for (screw_position = TOP_COVER_SCREW_POSITIONS) {
        translate([screw_position[0], screw_position[1], 0])
            countersunk_hole(
                TOP_COVER_SCREW_D,
                TOP_COVER_SCREW_HEAD_D,
                ROOF_T + 3.2,
                1.8
            );
    }
}

module stack_light_collar(center_x, center_y) {
    translate([center_x, center_y, ROOF_T + 1.4])
        difference() {
            cylinder(h = 2.4, d = STACK_LIGHT_COLLAR_OD);
            translate([0, 0, -0.1])
                cylinder(h = 2.6, d = STACK_LIGHT_SHAFT_D + 5);
        }
}

module stack_light_mount_holes(center_x, center_y) {
    translate([center_x, center_y, -1])
        cylinder(h = ROOF_T + 6, d = STACK_LIGHT_SHAFT_D);

    for (mount_angle = [0, 120, 240]) {
        translate([
            center_x + cos(mount_angle) * STACK_LIGHT_BOLT_CIRCLE_D / 2,
            center_y + sin(mount_angle) * STACK_LIGHT_BOLT_CIRCLE_D / 2,
            -1
        ])
            cylinder(h = ROOF_T + 6, d = STACK_LIGHT_MOUNT_D);
    }
}

module logic_vent_banks() {
    vent_height = ROOF_T + 5;

    // Left bank follows the M1 heat-sink direction.
    for (vent_index = [0 : 8]) {
        translate([28 + vent_index * 12, 50, -1])
            rounded_slot_prism(TOP_VENT_SLOT_LEN, TOP_VENT_SLOT_W, vent_height);
    }

    // Right bank is shorter to preserve material around the M3 vault and the
    // stack-light wiring path.
    for (vent_index = [0 : 7]) {
        translate([177 + vent_index * 11, 52, -1])
            rounded_slot_prism(TOP_VENT_SLOT_LEN - 5, TOP_VENT_SLOT_W, vent_height);
    }
}

module interlock_exhaust_bank() {
    vent_height = ROOF_T + 5;

    for (vent_index = [0 : 8]) {
        translate([24 + vent_index * 27, COVER_D - 30, -1])
            rounded_slot_prism(18, 4, vent_height);
    }
}

module top_style_grooves() {
    // Shallow diagonal grooves can be paint-filled in AetherGuard cyan.
    for (groove_offset = [0, 10, 20]) {
        translate([34 + groove_offset, 25, ROOF_T + 0.9])
            rotate([0, 0, -18])
                cube([38, 1.6, 4]);
        translate([PANEL_W - 72 + groove_offset, 25, ROOF_T + 0.9])
            rotate([0, 0, -18])
                cube([38, 1.6, 4]);
    }
}

module tamper_seal_holes() {
    for (tamper_x = [PANEL_W - 60, PANEL_W - 48]) {
        translate([tamper_x, 24, -1])
            cylinder(h = ROOF_T + 6, d = 2.5);
    }
}

module underside_registration_skirt() {
    skirt_height = 2.4;
    skirt_thickness = 2;

    translate([7, 12, -skirt_height])
        cube([skirt_thickness, COVER_D - 24, skirt_height + EPS]);
    translate([PANEL_W - 9, 12, -skirt_height])
        cube([skirt_thickness, COVER_D - 24, skirt_height + EPS]);
    translate([12, 7, -skirt_height])
        cube([PANEL_W - 24, skirt_thickness, skirt_height + EPS]);
    translate([12, COVER_D - 9, -skirt_height])
        cube([PANEL_W - 24, skirt_thickness, skirt_height + EPS]);
}

module underside_stiffening_ribs() {
    translate([22, 37, -3])
        cube([PANEL_W - 44, 3, 3 + EPS]);
    translate([22, COVER_D - 40, -3])
        cube([PANEL_W - 44, 3, 3 + EPS]);
    translate([PANEL_W / 2 - 1.5, 34, -3])
        cube([3, COVER_D - 68, 3 + EPS]);
}

module top_branding_engraving() {
    spine_engraving_z = ROOF_T + 2.35;
    skin_engraving_z = ROOF_T + 1.15;

    translate([PANEL_W / 2, 99, spine_engraving_z])
        hex_ring(22, 2.4, 1.1);
    translate([PANEL_W / 2, 99, spine_engraving_z])
        linear_extrude(height = 1.1)
            text("AG", size = 7.5, halign = "center", valign = "center");

    translate([PANEL_W / 2, 69, spine_engraving_z])
        rotate([0, 0, 90])
            linear_extrude(height = 1.1)
                text(
                    "AETHERGUARD",
                    size = 7.4,
                    halign = "center",
                    valign = "center",
                    spacing = 1.05
                );

    translate([
        STACK_LIGHT_X - WALL,
        STACK_LIGHT_Y - WALL - 32,
        skin_engraving_z
    ])
        linear_extrude(height = 1.1)
            text("STATE BEACON", size = 4, halign = "center", valign = "center");

    translate([PANEL_W - 54, 36, skin_engraving_z])
        linear_extrude(height = 1.1)
            text("TAMPER", size = 3.6, halign = "center", valign = "center");
}

top_cover();
