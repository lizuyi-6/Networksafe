// AetherGuard Enclosure — Main Chassis
//
// Box body with floor, 4 walls, DIN-rail clip on back, internal standoffs
// for NUCLEO-H563ZI, and side ventilation slots. Front/rear panels are
// separate modules (see front-panel.scad); this is the shell + mounts.
//
// Render: openscad -o chassis.stl chassis.scad

use <parameters.scad>

$fn = 60;  // Smooth curves

module chassis() {
    difference() {
        // Outer box
        outer_box();

        // Hollow interior (leave floor + walls)
        translate([WALL, WALL, FLOOR_T])
            cube([ENCLOSURE_W - 2*WALL, ENCLOSURE_D - 2*WALL, ENCLOSURE_H]);

        // Front opening (front panel attaches here)
        translate([WALL, -1, FLOOR_T])
            cube([ENCLOSURE_W - 2*WALL, WALL + 2, ENCLOSURE_H - FLOOR_T]);

        // Top opening (top cover attaches here)
        translate([WALL, WALL, ENCLOSURE_H - ROOF_T])
            cube([ENCLOSURE_W - 2*WALL, ENCLOSURE_D - 2*WALL, ROOF_T + 1]);

        // Side ventilation slots (both sides)
        vents_x();
        translate([0, ENCLOSURE_D, 0]) rotate([0, 0, 180]) vents_x();

        // Rear DIN-rail cable slot
        translate([ENCLOSURE_W/2 - 40, ENCLOSURE_D - 1, DECK_SPLIT_Z + 10])
            cube([80, WALL + 2, 30]);
    }

    // DIN-rail clip on back
    translate([ENCLOSURE_W/2, ENCLOSURE_D + DIN_RAIL_CLIP_DEPTH/2, ENCLOSURE_H/2])
        din_rail_clip();

    // Internal standoffs for NUCLEO (upper deck)
    nucleo_standoffs();
}

module outer_box() {
    cube([ENCLOSURE_W, ENCLOSURE_D, ENCLOSURE_H]);
}

module vents_x() {
    // Ventilation slots on the side (Y=0 face)
    for (i = [0 : VENT_QTY - 1]) {
        translate([-1, 0, 20 + i * (VENT_SLOT_SPACING)])
            rotate([0, 0, 0])
                cube([WALL + 2, VENT_SLOT_W, VENT_SLOT_H]);
    }
}

module din_rail_clip() {
    // Hook over 35mm top-hat DIN-rail
    difference() {
        union() {
            // Body block
            translate([-DIN_RAIL_WIDTH/2 - 8, -DIN_RAIL_CLIP_DEPTH/2, -DIN_RAIL_CLIP_HEIGHT/2])
                cube([DIN_RAIL_WIDTH + 16, DIN_RAIL_CLIP_DEPTH, DIN_RAIL_CLIP_HEIGHT]);
        }
        // Rail channel (35mm wide, top-hat profile)
        translate([-DIN_RAIL_WIDTH/2, -DIN_RAIL_CLIP_DEPTH/2 - 1, -DIN_RAIL_WIDTH/2 + 5])
            cube([DIN_RAIL_WIDTH, DIN_RAIL_CLIP_DEPTH + 2, DIN_RAIL_WIDTH - 10]);
        // Top flange overhang
        translate([-DIN_RAIL_WIDTH/2 + 3, -DIN_RAIL_CLIP_DEPTH/2 - 1, -DIN_RAIL_CLIP_HEIGHT/2 - 1])
            cube([DIN_RAIL_WIDTH - 6, DIN_RAIL_CLIP_DEPTH + 2, 6]);
    }
}

module nucleo_standoffs() {
    // 4 standoffs for NUCLEO-H563ZI in upper deck, centered
    ox = (ENCLOSURE_W - NUCLEO_W) / 2;
    oy = (ENCLOSURE_D - NUCLEO_D) / 2;
    oz = FLOOR_T + DECK_SPLIT_Z;
    positions = [
        [ox + 5,          oy + 5,          oz],
        [ox + NUCLEO_W - 5, oy + 5,          oz],
        [ox + 5,          oy + NUCLEO_D - 5, oz],
        [ox + NUCLEO_W - 5, oy + NUCLEO_D - 5, oz]
    ];
    for (p = positions) {
        translate(p)
            difference() {
                cylinder(h = STANDOFF_HEIGHT, d = 6);
                cylinder(h = STANDOFF_HEIGHT + 1, d = STANDOFF_HOLE_D);
            }
    }
}

chassis();

