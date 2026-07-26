// Printable split top cover - right half.

include <printable-common.scad>

$fn = 48;

module printable_top_cover_right() {
    translate([-PANEL_W / 2, 0, 0])
        difference() {
            intersection() {
                top_cover();
                translate([PANEL_W / 2 - CUT_OVERLAP, -10, -8])
                    cube([PANEL_W / 2 + 10, ENCLOSURE_D, ROOF_T + 14]);
            }

            // Clearance pocket for the left lid's underside lap strip.
            translate([PANEL_W / 2 - 9 - PRINT_CLEARANCE, 13.75, -2.1])
                cube([9 + 2 * PRINT_CLEARANCE, ENCLOSURE_D - 2 * WALL - 27.5, 2.35]);
        }
}

printable_top_cover_right();
