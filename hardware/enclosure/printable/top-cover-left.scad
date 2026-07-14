// Printable split top cover - left half.

include <printable-common.scad>

$fn = 48;

module printable_top_cover_left() {
    union() {
        split_part_x(0, PANEL_W / 2 + 1, -8, ROOF_T + 14)
            top_cover();

        // Underside lap strip to align the two lid halves.
        translate([PANEL_W / 2 - 9, 14, -2])
            cube([9, ENCLOSURE_D - 2 * WALL - 28, 2 + EPS]);
    }
}

printable_top_cover_left();
