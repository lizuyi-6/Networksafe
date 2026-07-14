// Screw-on rear DIN-rail clip for the printable split chassis.
// The four holes align with the printable chassis rear-wall holes.

include <printable-common.scad>

$fn = 48;

module screw_on_rear_din_clip() {
    difference() {
        union() {
            // Backing plate against the chassis rear wall.
            translate([-60, -2, -38])
                cube([120, 4, 76]);

            // DIN capture hook, same profile as the integrated prototype clip.
            rear_din_clip();
        }

        for (x = [-40, 40]) {
            for (z = [-16, 16]) {
                translate([x, 4, z])
                    rotate([90, 0, 0])
                        cylinder(h = 10, d = 4.2);
            }
        }
    }
}

rotate([0, 0, 0])
    screw_on_rear_din_clip();
