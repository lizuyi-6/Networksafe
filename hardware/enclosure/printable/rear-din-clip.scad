// Screw-on dual rear DIN-rail carrier for the printable split chassis.
// The wide backing plate distributes the appliance load across two hooks.

include <printable-common.scad>

$fn = 48;

module screw_on_rear_din_clip() {
    difference() {
        union() {
            // Backing plate against the chassis rear wall.
            translate([-102.5, -2, -32])
                cube([205, 4, 64]);

            for (clip_x = [-70, 70]) {
                translate([clip_x, 0, 0])
                    rear_din_clip();
            }
        }

        for (x = [-70, 70]) {
            for (z = [-20, 20]) {
                translate([x, 4, z])
                    rotate([90, 0, 0])
                        cylinder(h = 10, d = 4.2);
            }
        }
    }
}

// Lay the 205 x 64 mm backing plate on the bed. The rigid transform moves the
// complete carrier to a non-negative 205 x 64 x 16 mm bounding box.
translate([102.5, 32, 8])
    rotate([90, 0, 0])
        screw_on_rear_din_clip();
