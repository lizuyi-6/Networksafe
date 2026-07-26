// Printable split front panel - right half.
// Oriented flat on the print bed: back face down, raised details up.

include <printable-common.scad>

$fn = 48;

module printable_front_panel_right() {
    translate([0, 0, PANEL_T])
        rotate([-90, 0, 0])
            split_part_x(PANEL_W / 2, PANEL_W / 2 + 1, -5, PANEL_H + 10)
                front_panel();
}

printable_front_panel_right();
