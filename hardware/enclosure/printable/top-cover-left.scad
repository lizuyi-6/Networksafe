// Printable split top cover - left half.

include <printable-common.scad>

$fn = 48;

module printable_top_cover_left() {
    // The cover includes a 3 mm underside skirt. Lift the complete rigid part
    // so its lowest point sits directly on the slicer's Z=0 build plane.
    translate([0, 0, 3])
        union() {
            split_part_x(0, PANEL_W / 2 + 1, -8, ROOF_T + 14)
                top_cover();

            // Underside lap strip to align the two lid halves.
            translate([PANEL_W / 2 - 9, 14, -2])
                cube([9, ENCLOSURE_D - 2 * WALL - 28, 2 + EPS]);
        }
}

printable_top_cover_left();
