// Printable split chassis - left half.
// Fits a typical 220x220 mm FDM bed when printed as oriented.

include <printable-common.scad>

$fn = 48;

module printable_chassis_left() {
    union() {
        split_part_x(0, SPLIT_X + 1)
            printable_chassis_core();

        // Low internal alignment lips for glue/screw assisted assembly.
        seam_lip_left(ENCLOSURE_D - 2 * WALL - 12, 5, WALL + 8, FLOOR_T);
        seam_lip_left(ENCLOSURE_D - 2 * WALL - 44, 4, WALL + 24, DECK_SPLIT_Z + DECK_T + 1);
    }
}

printable_chassis_left();
