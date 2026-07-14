// Common helpers for the 220x220 mm FDM printable split version.
// Generated parts are arranged as individual printable pieces.

include <../parameters.scad>
use <../chassis.scad>
use <../front-panel.scad>
use <../top-cover.scad>

SPLIT_X = ENCLOSURE_W / 2;
CUT_OVERLAP = 0.35;
PRINT_CLEARANCE = 0.25;

module chassis_no_integrated_clip() {
    difference() {
        chassis();

        // Remove the integrated rear DIN clip so the chassis halves fit
        // common 220x220 print beds. Print the screw-on clip separately.
        translate([-20, ENCLOSURE_D - EPS, -20])
            cube([ENCLOSURE_W + 40, DIN_RAIL_CLIP_DEPTH + 60, ENCLOSURE_H + 40]);
    }
}

module rear_clip_mount_holes() {
    for (x = [110, 190]) {
        for (z = [43, 75]) {
            translate([x, ENCLOSURE_D + 2, z])
                rotate([90, 0, 0])
                    cylinder(h = WALL + 6, d = 4.2);
        }
    }
}

module printable_chassis_core() {
    difference() {
        chassis_no_integrated_clip();
        rear_clip_mount_holes();
    }
}

module split_part_x(x0, width, z_min = -10, z_height = 160) {
    translate([-x0, 0, 0])
        intersection() {
            children();
            translate([x0 - CUT_OVERLAP, -20, z_min])
                cube([width + 2 * CUT_OVERLAP, ENCLOSURE_D + 40, z_height]);
        }
}

module seam_lip_left(length_y, height_z, y0 = WALL, z0 = FLOOR_T) {
    translate([SPLIT_X - 7, y0, z0])
        cube([7 + PRINT_CLEARANCE, length_y, height_z]);
}

module seam_lip_right_socket(length_y, height_z, y0 = WALL, z0 = FLOOR_T) {
    translate([SPLIT_X - 7 - PRINT_CLEARANCE, y0 - 0.1, z0 - 0.1])
        cube([7 + 2 * PRINT_CLEARANCE, length_y + 0.2, height_z + 0.2]);
}

module label_raised(label, pos, size_value = 5) {
    translate(pos)
        linear_extrude(height = 0.45)
            text(label, size = size_value, halign = "center", valign = "center");
}
