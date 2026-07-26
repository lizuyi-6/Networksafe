// Printable split chassis - left half.
// Fits a typical 220x220 mm FDM bed when printed as oriented.

include <printable-common.scad>

$fn = 48;

module printable_chassis_left() {
    union() {
        split_part_x(0, SPLIT_X + 1)
            printable_chassis_core();

        // Low and high anti-shear lips align the shell without recreating the
        // inaccessible mid-deck used by the previous enclosure architecture.
        seam_lip_left(ENCLOSURE_D - 2 * WALL - 20, 4, WALL + 10, FLOOR_T);
        seam_lip_left(
            ENCLOSURE_D - 2 * WALL - 36,
            5,
            WALL + 18,
            ENCLOSURE_H - ROOF_T - 11
        );
    }
}

printable_chassis_left();
