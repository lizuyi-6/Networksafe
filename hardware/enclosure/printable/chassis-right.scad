// Printable split chassis - right half.
// Includes clearance sockets for the left-half alignment lips.

include <printable-common.scad>

$fn = 48;

module printable_chassis_right() {
    translate([-SPLIT_X, 0, 0])
        difference() {
            intersection() {
                printable_chassis_core();
                translate([SPLIT_X - CUT_OVERLAP, -20, -10])
                    cube([SPLIT_X + CUT_OVERLAP + 20, ENCLOSURE_D + 40, 160]);
            }

            seam_lip_right_socket(ENCLOSURE_D - 2 * WALL - 12, 5, WALL + 8, FLOOR_T);
            seam_lip_right_socket(ENCLOSURE_D - 2 * WALL - 44, 4, WALL + 24, DECK_SPLIT_Z + DECK_T + 1);
        }
}

printable_chassis_right();
