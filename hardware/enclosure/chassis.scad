// AetherGuard Root-Resistant Gateway enclosure - structural chassis.
//
// The enclosure uses a single service plane:
// - front logic bay: M1 gateway, M2 controller, and guarded M3 carrier
// - rear interlock bay: transverse DIN rail behind a solid partition
//
// Render/export:
//   openscad -o chassis.stl chassis.scad

include <parameters.scad>
use <geometry.scad>

$fn = 64;

module chassis() {
    difference() {
        rounded_prism([ENCLOSURE_W, ENCLOSURE_D, ENCLOSURE_H], CORNER_R);

        // Hollow interior. The cut continues above the enclosure so the lid is
        // a true removable component rather than a cosmetic overlay.
        translate([WALL, WALL, FLOOR_T])
            rounded_prism(
                [ENCLOSURE_W - 2 * WALL, ENCLOSURE_D - 2 * WALL, ENCLOSURE_H],
                max(CORNER_R - WALL, 1)
            );

        front_panel_opening();
        side_armor_recesses();
        side_vent_cutouts();
        rear_service_cutouts();
        bottom_mounting_holes();
    }

    top_cover_ledges();
    power_partition();
    gateway_retainers();
    gateway_strap_anchors();
    nucleo_standoffs();
    secure_element_vault();
    internal_din_rail();
    cable_tie_anchors();
    front_panel_bosses();
    top_cover_bosses();

    if (INTEGRATED_DIN_CLIPS) {
        for (clip_center_x = DIN_RAIL_CLIP_CENTERS_X) {
            translate([
                clip_center_x,
                ENCLOSURE_D + DIN_RAIL_CLIP_DEPTH / 2 - EPS,
                DIN_RAIL_CLIP_MOUNT_Z
            ])
                rear_din_clip();
        }
    }
}

module side_armor_recesses() {
    translate([-1, 20, 18])
        cube([
            CHASSIS_ARMOR_RAIL_DEPTH + 1,
            ENCLOSURE_D - 40,
            ENCLOSURE_H - 36
        ]);
    translate([ENCLOSURE_W - CHASSIS_ARMOR_RAIL_DEPTH, 20, 18])
        cube([
            CHASSIS_ARMOR_RAIL_DEPTH + 1,
            ENCLOSURE_D - 40,
            ENCLOSURE_H - 36
        ]);
}

module front_panel_opening() {
    translate([WALL, -1, FLOOR_T])
        cube([PANEL_W, WALL + 2, PANEL_H + EPS]);
}

module side_vent_cutouts() {
    vent_cut_width = WALL + 2 * CHASSIS_ARMOR_RAIL_DEPTH + 3;

    for (side_x = [-CHASSIS_ARMOR_RAIL_DEPTH - 1, ENCLOSURE_W - WALL - 1]) {
        for (row_index = [0 : SIDE_VENT_ROWS - 1]) {
            for (vent_index = [0 : SIDE_VENT_QTY - 1]) {
                translate([
                    side_x,
                    31 + vent_index * SIDE_VENT_SPACING,
                    25 + row_index * 22
                ])
                    rotate([14, 0, 0])
                        cube([
                            vent_cut_width,
                            SIDE_VENT_SLOT_LEN,
                            SIDE_VENT_SLOT_H
                        ]);
            }
        }
    }
}

module rear_service_cutouts() {
    // Replaceable inlet sub-panel for prototype-specific power connectors.
    translate([
        POWER_MODULE_X - POWER_MODULE_W / 2,
        ENCLOSURE_D - WALL - 1,
        POWER_MODULE_Z - POWER_MODULE_H / 2
    ])
        cube([POWER_MODULE_W, WALL + 2, POWER_MODULE_H]);

    // Isolated relay loop, tower light, serial fallback, and spare control I/O.
    for (gland_index = [0 : CABLE_GLAND_QTY - 1]) {
        translate([
            CABLE_GLAND_START_X + gland_index * CABLE_GLAND_SPACING,
            ENCLOSURE_D + 1,
            CABLE_GLAND_Z
        ])
            rotate([90, 0, 0])
                cylinder(h = WALL + 3, d = CABLE_GLAND_DIAMETER);
    }

    translate([GROUND_LUG_X, ENCLOSURE_D + 1, GROUND_LUG_Z])
        rotate([90, 0, 0])
            cylinder(h = WALL + 3, d = GROUND_LUG_DIAMETER);
}

module bottom_mounting_holes() {
    for (mount_position = BOTTOM_MOUNT_POSITIONS) {
        translate([mount_position[0], mount_position[1], -1])
            cylinder(h = FLOOR_T + 2, d = BOTTOM_MOUNT_D);
        translate([mount_position[0], mount_position[1], -0.1])
            cylinder(h = 1.7, d1 = 8.5, d2 = BOTTOM_MOUNT_D);
    }
}

module top_cover_ledges() {
    ledge_z = ENCLOSURE_H - ROOF_T - 2;
    ledge_width = 5;

    translate([WALL, WALL, ledge_z])
        cube([PANEL_W, ledge_width, 2 + EPS]);
    translate([WALL, ENCLOSURE_D - WALL - ledge_width, ledge_z])
        cube([PANEL_W, ledge_width, 2 + EPS]);
    translate([WALL, WALL + ledge_width, ledge_z])
        cube([ledge_width, COVER_D - 2 * ledge_width, 2 + EPS]);
    translate([ENCLOSURE_W - WALL - ledge_width, WALL + ledge_width, ledge_z])
        cube([ledge_width, COVER_D - 2 * ledge_width, 2 + EPS]);
}

module power_partition() {
    difference() {
        translate([WALL, POWER_PARTITION_Y, FLOOR_T - EPS])
            cube([
                ENCLOSURE_W - 2 * WALL,
                POWER_PARTITION_T,
                POWER_PARTITION_TOP_Z - FLOOR_T
            ]);

        // Only two protected harness passages cross the trust/power boundary.
        for (grommet_x = [158, 300]) {
            translate([
                grommet_x,
                POWER_PARTITION_Y + POWER_PARTITION_T + 1,
                28
            ])
                rotate([90, 0, 0])
                    cylinder(h = POWER_PARTITION_T + 2, d = PARTITION_GROMMET_D);
        }
    }

    // Gussets prevent the long partition from flexing during cable service.
    for (gusset_x = [WALL + 14, ENCLOSURE_W / 2, ENCLOSURE_W - WALL - 14]) {
        translate([gusset_x - 4, POWER_PARTITION_Y - 6, FLOOR_T - EPS])
            cube([8, 6 + POWER_PARTITION_T, 9]);
    }
}

module gateway_retainers() {
    retainer_z = FLOOR_T - EPS;

    translate([M1_X, M1_Y, retainer_z])
        difference() {
            cube([M1_W, M1_D, M1_RETAINER_H]);
            translate([M1_RETAINER_T, M1_RETAINER_T, -1])
                cube([
                    M1_W - 2 * M1_RETAINER_T,
                    M1_D - 2 * M1_RETAINER_T,
                    M1_RETAINER_H + 2
                ]);
        }
}

module gateway_strap_anchors() {
    for (anchor_position = [
        [M1_X + 18, M1_Y - 1],
        [M1_X + M1_W - 30, M1_Y - 1],
        [M1_X + 18, M1_Y + M1_D - 7],
        [M1_X + M1_W - 30, M1_Y + M1_D - 7]
    ]) {
        translate([anchor_position[0], anchor_position[1], FLOOR_T - EPS])
            difference() {
                cube([12, 8, 7]);
                translate([3, -1, 2.6])
                    cube([6, 10, 2.8]);
            }
    }
}

module nucleo_standoffs() {
    standoff_positions = [
        [NUCLEO_X + 7, NUCLEO_Y + 7],
        [NUCLEO_X + NUCLEO_W - 7, NUCLEO_Y + 7],
        [NUCLEO_X + 7, NUCLEO_Y + NUCLEO_D - 7],
        [NUCLEO_X + NUCLEO_W - 7, NUCLEO_Y + NUCLEO_D - 7]
    ];

    for (standoff_position = standoff_positions) {
        translate([standoff_position[0], standoff_position[1], FLOOR_T - EPS])
            difference() {
                cylinder(h = STANDOFF_HEIGHT + EPS, d = STANDOFF_OD);
                translate([0, 0, -1])
                    cylinder(h = STANDOFF_HEIGHT + 2, d = STANDOFF_HOLE_D);
            }
    }
}

module secure_element_vault() {
    vault_margin = 3;
    vault_height = 6;
    vault_outer_w = SE_W + 2 * vault_margin;
    vault_outer_d = SE_D + 2 * vault_margin;

    translate([SE_X - vault_margin, SE_Y - vault_margin, FLOOR_T - EPS])
        difference() {
            cube([vault_outer_w, vault_outer_d, vault_height]);
            translate([SE_VAULT_WALL, SE_VAULT_WALL, 1.4])
                cube([
                    vault_outer_w - 2 * SE_VAULT_WALL,
                    vault_outer_d - 2 * SE_VAULT_WALL,
                    vault_height
                ]);
        }

    for (standoff_position = [
        [SE_X + 4, SE_Y + 4],
        [SE_X + SE_W - 4, SE_Y + SE_D - 4]
    ]) {
        translate([standoff_position[0], standoff_position[1], FLOOR_T - EPS])
            difference() {
                cylinder(h = 5, d = 5.5);
                translate([0, 0, -1])
                    cylinder(h = 7, d = 2.2);
            }
    }
}

module internal_din_rail() {
    translate([INTERNAL_DIN_X, INTERNAL_DIN_Y, INTERNAL_DIN_Z - EPS]) {
        cube([INTERNAL_DIN_LEN, DIN_RAIL_WIDTH, 2]);
        translate([0, 7, 2])
            cube([INTERNAL_DIN_LEN, DIN_RAIL_WIDTH - 14, 4]);
        translate([0, 0, 5])
            cube([INTERNAL_DIN_LEN, 9, DIN_RAIL_HEIGHT - 5]);
        translate([0, DIN_RAIL_WIDTH - 9, 5])
            cube([INTERNAL_DIN_LEN, 9, DIN_RAIL_HEIGHT - 5]);
    }
}

module cable_tie_anchors() {
    for (anchor_position = [[158, 24], [158, 112], [302, 44], [302, 118]]) {
        translate([anchor_position[0], anchor_position[1], FLOOR_T - EPS])
            difference() {
                cube([9, 12, 6]);
                translate([2.5, -1, 2.2])
                    cube([4, 14, 2.5]);
            }
    }
}

module front_panel_bosses() {
    rail_depth = 11;
    rail_height = 15;
    bottom_end_rail_width = 23;

    difference() {
        union() {
            // Bottom end rails support the two lower screws without occupying
            // the M3 carrier and front connector service volume.
            translate([WALL - EPS, WALL - EPS, FLOOR_T - EPS])
                cube([
                    bottom_end_rail_width,
                    rail_depth,
                    rail_height
                ]);
            translate([
                ENCLOSURE_W - WALL - bottom_end_rail_width + EPS,
                WALL - EPS,
                FLOOR_T - EPS
            ])
                cube([
                    bottom_end_rail_width,
                    rail_depth,
                    rail_height
                ]);

            // The top rail carries four screws and ties both sidewalls
            // together above the status light-pipe envelope.
            translate([
                WALL - EPS,
                WALL - EPS,
                ENCLOSURE_H - ROOF_T - rail_height
            ])
                cube([
                    ENCLOSURE_W - 2 * WALL + 2 * EPS,
                    rail_depth,
                    rail_height + EPS
                ]);
        }

        for (screw_position = FRONT_PANEL_SCREW_POSITIONS) {
            translate([
                WALL + screw_position[0],
                WALL + rail_depth + 1,
                FLOOR_T + screw_position[1]
            ])
                rotate([90, 0, 0])
                    cylinder(
                        h = rail_depth + 3,
                        d = FRONT_PANEL_SCREW_D
                    );
        }
    }
}

module top_cover_bosses() {
    boss_height = ENCLOSURE_H - FLOOR_T - ROOF_T + EPS;

    for (screw_position = TOP_COVER_SCREW_POSITIONS) {
        translate([
            WALL + screw_position[0],
            WALL + screw_position[1],
            FLOOR_T - EPS
        ])
            difference() {
                cylinder(h = boss_height, d = 10);
                translate([0, 0, -1])
                    cylinder(h = boss_height + 2, d = 3.2);
            }
    }
}

module rear_din_clip(clip_width = DIN_RAIL_CLIP_WIDTH) {
    difference() {
        translate([
            -clip_width / 2,
            -DIN_RAIL_CLIP_DEPTH / 2,
            -DIN_RAIL_CLIP_HEIGHT / 2
        ])
            cube([clip_width, DIN_RAIL_CLIP_DEPTH, DIN_RAIL_CLIP_HEIGHT]);

        // 35 mm top-hat rail channel. Two clips are used because a single
        // central printed hook is not appropriate for this enclosure width.
        translate([
            -DIN_RAIL_WIDTH / 2,
            -DIN_RAIL_CLIP_DEPTH / 2 - 1,
            -DIN_RAIL_WIDTH / 2 + 6
        ])
            cube([
                DIN_RAIL_WIDTH,
                DIN_RAIL_CLIP_DEPTH + 2,
                DIN_RAIL_WIDTH - 12
            ]);
        translate([
            -DIN_RAIL_WIDTH / 2 + 3,
            -DIN_RAIL_CLIP_DEPTH / 2 - 1,
            -DIN_RAIL_CLIP_HEIGHT / 2 - 1
        ])
            cube([DIN_RAIL_WIDTH - 6, DIN_RAIL_CLIP_DEPTH + 2, 6]);
    }
}

chassis();
