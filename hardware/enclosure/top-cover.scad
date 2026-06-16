// AetherGuard Enclosure — Top Cover
//
// Removable lid with stack-light mount hole and corner screws.
//
// Render: openscad -o top-cover.stl top-cover.scad

use <parameters.scad>

$fn = 60;

module top_cover() {
    difference() {
        // Cover body
        cube([ENCLOSURE_W - 2*WALL, ENCLOSURE_D - 2*WALL, ROOF_T]);

        // Stack light mount hole (centered, optional)
        translate([(ENCLOSURE_W - 2*WALL)/2, (ENCLOSURE_D - 2*WALL)/2, -1])
            cylinder(h = ROOF_T + 2, d = STACK_LIGHT_DIAMETER);

        // Corner screw holes (M4)
        for (sx = [8, ENCLOSURE_W - 2*WALL - 8]) {
            for (sy = [8, ENCLOSURE_D - 2*WALL - 8]) {
                translate([sx, sy, -1])
                    cylinder(h = ROOF_T + 2, d = TOP_COVER_SCREW_D + 0.5);
                // Countersink
                translate([sx, sy, ROOF_T - 1.5])
                    cylinder(h = 2, d1 = TOP_COVER_SCREW_D + 0.5, d2 = 8);
            }
        }
    }
}

top_cover();
