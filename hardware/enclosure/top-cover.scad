// AetherGuard Gateway Appliance enclosure - top cover.
//
// Removable service lid with stack-light mount, ventilation, countersunk
// screws, and tamper-seal points.
//
// Render/export:
//   openscad -o top-cover.stl top-cover.scad

include <parameters.scad>

$fn = 64;

module rounded_plate(size, r) {
    rr = min(r, min(size[0], size[1]) / 2 - 0.01);
    linear_extrude(height = size[2])
        offset(r = rr)
            translate([rr, rr])
                square([size[0] - 2 * rr, size[1] - 2 * rr]);
}

module top_cover() {
    cover_d = ENCLOSURE_D - 2 * WALL;

    difference() {
        rounded_plate([PANEL_W, cover_d, ROOF_T], max(CORNER_R - WALL, 1));

        // Optional tower/stack-light mount.
        translate([STACK_LIGHT_X - WALL, STACK_LIGHT_Y - WALL, -1])
            cylinder(h = ROOF_T + 2, d = STACK_LIGHT_DIAMETER);

        // Countersunk lid screws.
        for (sx = [12, PANEL_W - 12]) {
            for (sy = [12, cover_d - 12]) {
                translate([sx, sy, -1])
                    cylinder(h = ROOF_T + 2, d = TOP_COVER_SCREW_D);
                translate([sx, sy, ROOF_T - 1.4])
                    cylinder(h = 2, d1 = TOP_COVER_SCREW_D, d2 = TOP_COVER_SCREW_HEAD_D);
            }
        }

        // Gateway/control-board ventilation banks.
        for (i = [0 : 8]) {
            translate([34 + i * 13, 52, -1])
                cube([6, 74, ROOF_T + 2]);
        }
        for (i = [0 : 7]) {
            translate([180 + i * 11, 46, -1])
                cube([5, 86, ROOF_T + 2]);
        }

        // Two small tamper-seal wire holes.
        translate([PANEL_W - 42, 24, -1])
            cylinder(h = ROOF_T + 2, d = 2.4);
        translate([PANEL_W - 30, 24, -1])
            cylinder(h = ROOF_T + 2, d = 2.4);
    }

    // Low underside ribs. These protrude into the enclosure when assembled.
    translate([22, 36, -3])
        cube([PANEL_W - 44, 3, 3 + EPS]);
    translate([22, cover_d - 39, -3])
        cube([PANEL_W - 44, 3, 3 + EPS]);
    translate([136, 34, -3])
        cube([3, cover_d - 68, 3 + EPS]);

    top_label("STACK LIGHT", STACK_LIGHT_X - WALL, STACK_LIGHT_Y - WALL + 31, 5);
    top_label("TAMPER SEAL", PANEL_W - 36, 42, 4);
}

module top_label(label, cx, cy, size_value) {
    translate([cx, cy, ROOF_T - EPS])
        linear_extrude(height = 0.45)
            text(label, size = size_value, halign = "center", valign = "center");
}

top_cover();
