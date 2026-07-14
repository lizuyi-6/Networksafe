// AetherGuard Gateway Appliance enclosure - main chassis.
//
// Two-level industrial prototype shell:
// - lower bay: 24V PSU, relay, optocouplers on an internal DIN rail
// - upper deck: M1 multi-port gateway + M2 STM32 controller + M3 SE
//
// Render/export:
//   openscad -o chassis.stl chassis.scad

include <parameters.scad>

$fn = 64;

module rounded_box(size, r) {
    rr = min(r, min(size[0], size[1]) / 2 - 0.01);
    linear_extrude(height = size[2])
        offset(r = rr)
            translate([rr, rr])
                square([size[0] - 2 * rr, size[1] - 2 * rr]);
}

module chassis() {
    difference() {
        rounded_box([ENCLOSURE_W, ENCLOSURE_D, ENCLOSURE_H], CORNER_R);

        // Hollow interior.
        translate([WALL, WALL, FLOOR_T])
            rounded_box(
                [ENCLOSURE_W - 2 * WALL, ENCLOSURE_D - 2 * WALL, ENCLOSURE_H],
                max(CORNER_R - WALL, 1)
            );

        // Removable front-panel opening.
        translate([WALL, -1, FLOOR_T])
            cube([ENCLOSURE_W - 2 * WALL, WALL + 2, ENCLOSURE_H - FLOOR_T - ROOF_T + 1]);

        // Removable top-cover opening.
        translate([WALL, WALL, ENCLOSURE_H - ROOF_T])
            cube([ENCLOSURE_W - 2 * WALL, ENCLOSURE_D - 2 * WALL, ROOF_T + 1]);

        side_vents(-1);
        side_vents(ENCLOSURE_W - WALL + 1);
        rear_service_cutouts();
    }

    electronics_deck();
    gateway_retainers();
    nucleo_standoffs();
    secure_element_standoffs();
    internal_din_rail();
    front_panel_bosses();
    top_cover_bosses();

    translate([ENCLOSURE_W / 2, ENCLOSURE_D + DIN_RAIL_CLIP_DEPTH / 2 - EPS, ENCLOSURE_H / 2])
        rear_din_clip();
}

module side_vents(x0) {
    for (i = [0 : VENT_QTY - 1]) {
        translate([x0, 42 + i * VENT_SPACING, 18])
            cube([WALL + 2, VENT_SLOT_LEN, VENT_SLOT_H]);
        translate([x0, 42 + i * VENT_SPACING, 78])
            cube([WALL + 2, VENT_SLOT_LEN, VENT_SLOT_H]);
    }
}

module rear_service_cutouts() {
    // 24V inlet.
    translate([POWER_INLET_X - POWER_INLET_W / 2, ENCLOSURE_D - WALL - 1, POWER_INLET_Z - POWER_INLET_H / 2])
        cube([POWER_INLET_W, WALL + 2, POWER_INLET_H]);

    // Cable glands for relay loop, tower light, RS485/USB fallback, and spare I/O.
    for (i = [0 : CABLE_GLAND_QTY - 1]) {
        translate([CABLE_GLAND_START_X + i * CABLE_GLAND_SPACING, ENCLOSURE_D + 1, CABLE_GLAND_Z])
            rotate([90, 0, 0])
                cylinder(h = WALL + 3, d = CABLE_GLAND_DIAMETER);
    }
}

module electronics_deck() {
    difference() {
        translate([WALL - EPS, WALL + 18, DECK_SPLIT_Z])
            cube([ENCLOSURE_W - 2 * WALL + 2 * EPS, ENCLOSURE_D - 2 * WALL - 30, DECK_T]);

        // Cable pass-through from lower interlock bay to controller.
        translate([154, 54, DECK_SPLIT_Z - 1])
            cube([18, 60, DECK_T + 2]);
        translate([142, ENCLOSURE_D - 56, DECK_SPLIT_Z - 1])
            cube([42, 34, DECK_T + 2]);
    }
}

module gateway_retainers() {
    z0 = DECK_SPLIT_Z + DECK_T - EPS;

    // Low rails capture a Protectli-class metal gateway without assuming
    // its screw pattern.
    translate([M1_X, M1_Y, z0])
        cube([M1_W, M1_RETAINER_T, M1_RETAINER_H]);
    translate([M1_X, M1_Y + M1_D - M1_RETAINER_T, z0])
        cube([M1_W, M1_RETAINER_T, M1_RETAINER_H]);
    translate([M1_X, M1_Y, z0])
        cube([M1_RETAINER_T, M1_D, M1_RETAINER_H]);
    translate([M1_X + M1_W - M1_RETAINER_T, M1_Y, z0])
        cube([M1_RETAINER_T, M1_D, M1_RETAINER_H]);
}

module nucleo_standoffs() {
    z0 = DECK_SPLIT_Z + DECK_T - EPS;
    positions = [
        [NUCLEO_X + 6, NUCLEO_Y + 6, z0],
        [NUCLEO_X + NUCLEO_W - 6, NUCLEO_Y + 6, z0],
        [NUCLEO_X + 6, NUCLEO_Y + NUCLEO_D - 6, z0],
        [NUCLEO_X + NUCLEO_W - 6, NUCLEO_Y + NUCLEO_D - 6, z0]
    ];

    for (p = positions) {
        translate(p)
            difference() {
                cylinder(h = STANDOFF_HEIGHT + EPS, d = STANDOFF_OD);
                translate([0, 0, -1])
                    cylinder(h = STANDOFF_HEIGHT + 2 + EPS, d = STANDOFF_HOLE_D);
            }
    }
}

module secure_element_standoffs() {
    z0 = DECK_SPLIT_Z + DECK_T - EPS;
    for (p = [[SE_X + 4, SE_Y + 4, z0], [SE_X + SE_W - 4, SE_Y + SE_D - 4, z0]]) {
        translate(p)
            difference() {
                cylinder(h = 5 + EPS, d = 5);
                translate([0, 0, -1])
                    cylinder(h = 7, d = 2.2);
            }
    }
}

module internal_din_rail() {
    translate([INTERNAL_DIN_X, INTERNAL_DIN_Y, FLOOR_T - EPS]) {
        cube([INTERNAL_DIN_LEN, DIN_RAIL_WIDTH, 2]);
        translate([0, 7, 2])
            cube([INTERNAL_DIN_LEN, DIN_RAIL_WIDTH - 14, 4]);
        translate([0, 0, 5])
            cube([INTERNAL_DIN_LEN, 5, DIN_RAIL_HEIGHT - 5]);
        translate([0, DIN_RAIL_WIDTH - 5, 5])
            cube([INTERNAL_DIN_LEN, 5, DIN_RAIL_HEIGHT - 5]);
    }
}

module front_panel_bosses() {
    for (x = [WALL + 10, ENCLOSURE_W - WALL - 10]) {
        for (z = [FLOOR_T + 10, ENCLOSURE_H - ROOF_T - 10]) {
            if (x < ENCLOSURE_W / 2) {
                translate([WALL - EPS, WALL, z - 6])
                    cube([22, 10, 12]);
            } else {
                translate([ENCLOSURE_W - WALL - 22 + EPS, WALL, z - 6])
                    cube([22, 10, 12]);
            }

            translate([x, WALL + 8, z])
                rotate([90, 0, 0])
                    difference() {
                        cylinder(h = 12, d = 10);
                        translate([0, 0, -1])
                            cylinder(h = 14, d = 3.2);
                    }
        }
    }
}

module top_cover_bosses() {
    for (x = [WALL + 12, ENCLOSURE_W - WALL - 12]) {
        for (y = [WALL + 12, ENCLOSURE_D - WALL - 12]) {
            translate([x, y, FLOOR_T - EPS])
                difference() {
                    cylinder(h = ENCLOSURE_H - FLOOR_T - ROOF_T + EPS, d = 10);
                    translate([0, 0, -1])
                        cylinder(h = ENCLOSURE_H, d = 3.2);
                }
        }
    }
}

module rear_din_clip() {
    difference() {
        translate([-48, -DIN_RAIL_CLIP_DEPTH / 2, -DIN_RAIL_CLIP_HEIGHT / 2])
            cube([96, DIN_RAIL_CLIP_DEPTH, DIN_RAIL_CLIP_HEIGHT]);

        // 35mm top-hat rail channel.
        translate([-DIN_RAIL_WIDTH / 2, -DIN_RAIL_CLIP_DEPTH / 2 - 1, -DIN_RAIL_WIDTH / 2 + 5])
            cube([DIN_RAIL_WIDTH, DIN_RAIL_CLIP_DEPTH + 2, DIN_RAIL_WIDTH - 10]);
        translate([-DIN_RAIL_WIDTH / 2 + 3, -DIN_RAIL_CLIP_DEPTH / 2 - 1, -DIN_RAIL_CLIP_HEIGHT / 2 - 1])
            cube([DIN_RAIL_WIDTH - 6, DIN_RAIL_CLIP_DEPTH + 2, 6]);
    }
}

chassis();
