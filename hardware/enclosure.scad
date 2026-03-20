/*
 * AetherGuard Deployment Dongle Enclosure
 * Version: v7.0 (Flat-Top Black Box Rebuild)
 * Date: 2026-03-13
 *
 * Public exports:
 * - LOWER_CHASSIS
 * - UPPER_BEZEL
 * - SERVICE_DOOR
 * - LENS
 * - BUTTON_CAPS
 * - ASSEMBLY
 * - PLATE
 *
 * Legacy aliases kept for compatibility:
 * - CHASSIS -> LOWER_CHASSIS
 * - TOP_PLATE -> UPPER_BEZEL
 * - BOTTOM_COVER -> SERVICE_DOOR
 */

part_to_render_default = "ASSEMBLY";
selected_part =
    !is_undef(part_to_render_override) ? part_to_render_override :
    !is_undef(part_to_render) ? part_to_render :
    part_to_render_default;
resolved_part =
    selected_part == "CHASSIS" ? "LOWER_CHASSIS" :
    selected_part == "TOP_PLATE" ? "UPPER_BEZEL" :
    selected_part == "BOTTOM_COVER" ? "SERVICE_DOOR" :
    selected_part;

$fn = 64;

body_len = 90;
body_wid = 58;
body_h = 16.8;
body_corner_r = 6.4;

top_len = 89.4;
top_wid = 57.4;
top_corner_r = 6.0;

shell_th = 1.8;
base_th = 2.0;
fit_clearance = 0.30;

tray_center_x = body_len / 2;
tray_center_y = body_wid / 2;

bottom_open_len = 74;
bottom_open_wid = 40;
bottom_open_r = 5.6;

tray_outer_len = 70;
tray_outer_wid = 36;
tray_outer_h = 9.2;
tray_wall = 1.8;
tray_base_th = 1.8;
tray_corner_r = 4.6;

mount_offset_x = tray_outer_len / 2 - 6.4;
mount_offset_y = tray_outer_wid / 2 - 5.2;
mount_positions = [
    [tray_center_x - mount_offset_x, tray_center_y - mount_offset_y],
    [tray_center_x - mount_offset_x, tray_center_y + mount_offset_y],
    [tray_center_x + mount_offset_x, tray_center_y - mount_offset_y],
    [tray_center_x + mount_offset_x, tray_center_y + mount_offset_y]
];
mount_hole_d = 2.4;
mount_tube_d = 6.0;
upper_boss_d = 6.8;
upper_insert_d = 4.2;
upper_insert_h = 4.2;
upper_boss_bottom_z = 1.8;
upper_boss_h = 6.2;
tray_mount_counterbore_d = 5.0;
tray_mount_counterbore_h = 1.6;

service_outer_len = 42;
service_outer_wid = 14;
service_inner_len = 36;
service_inner_wid = 8;
service_corner_r = 3.4;
service_plate_th = 1.5;
service_tongue_h = 1.4;
door_boss_positions = [
    [tray_center_x - 13, tray_center_y],
    [tray_center_x + 13, tray_center_y]
];
door_boss_d = 6.4;
door_boss_h = 4.4;
door_screw_d = 2.4;
door_counterbore_d = 5.0;

pcb_len = 52;
pcb_wid = 29;
pcb_origin_x = tray_center_x - pcb_len / 2;
pcb_origin_y = tray_center_y - pcb_wid / 2;
pcb_standoff_d = 4.0;
pcb_hole_d = 1.9;
pcb_standoff_h = 5.2;

lens_len = 81;
lens_wid = 47;
lens_corner_r = 4.9;
lens_th = 1.5;
lens_recess_depth = 1.15;
lens_center_x = body_len / 2;
lens_center_y = body_wid / 2;
lens_open_len = 75;
lens_open_wid = 41;
lens_open_corner_r = 3.8;

oled_window_len = 23.0;
oled_window_wid = 12.0;
oled_center_x = body_len / 2 - 10;
oled_center_y = body_wid / 2;
oled_support_len = 29;
oled_support_wid = 17;
oled_support_h = 1.6;

rgb_window_d = 3.0;
rgb_center_x = body_len / 2 + 18;
rgb_center_y = body_wid / 2;

display_mock_board_len = 72;
display_mock_board_wid = 38;
display_mock_z = body_h - 2.35;

button_x_positions = [
    body_len / 2 - 12,
    body_len / 2,
    body_len / 2 + 12
];
button_band_z = 5.1;
button_band_len = 30;
button_band_h = 4.8;
button_band_depth = 0.45;
button_hole_d = 2.8;
button_sleeve_d = 4.8;
button_sleeve_len = 4.8;
button_head_d = 4.4;
button_stem_d = 2.8;
button_stem_len = 1.9;
button_cap_depth = 0.38;

typec_w = 9.0;
typec_h = 4.0;
typec_center_x = body_len / 2;
typec_center_z = 7.2;
typec_recess_w = 14;
typec_recess_h = 6.6;
typec_recess_depth = 0.7;

cable_slot_w = 5.6;
cable_slot_h = 3.3;
cable_exit_y = body_wid - 8.4;
cable_exit_z = 3.1;
cable_notch_len = 6.6;

buzzer_hole_d = 1.4;
buzzer_hole_spacing = 3.8;
buzzer_center_x = body_len / 2;
buzzer_front_y = 6.4;

module rounded_rect_2d(len, wid, rad) {
    hull() {
        for (sx = [-1, 1]) {
            for (sy = [-1, 1]) {
                translate([sx * (len / 2 - rad), sy * (wid / 2 - rad)]) circle(r = rad);
            }
        }
    }
}

module rounded_rect_prism(len, wid, hgt, rad) {
    linear_extrude(height = hgt) rounded_rect_2d(len, wid, rad);
}

module shell_slice(z_pos, len, wid, rad) {
    translate([body_len / 2, body_wid / 2, z_pos]) rounded_rect_prism(len, wid, 0.2, rad);
}

module outer_body() {
    hull() {
        shell_slice(0, body_len, body_wid, body_corner_r);
        shell_slice(body_h - 0.1, top_len, top_wid, top_corner_r);
    }
}

module inner_cavity() {
    hull() {
        shell_slice(base_th, body_len - 2 * (shell_th + 0.9), body_wid - 2 * (shell_th + 0.9), body_corner_r - 2.0);
        shell_slice(body_h - shell_th - 0.2, top_len - 2 * (shell_th + 0.75), top_wid - 2 * (shell_th + 0.75), top_corner_r - 1.6);
    }
}

module bottom_opening_cut() {
    translate([tray_center_x, tray_center_y, -0.1])
        rounded_rect_prism(bottom_open_len, bottom_open_wid, body_h - 3.0, bottom_open_r);
}

module lens_blank() {
    rounded_rect_prism(lens_len, lens_wid, lens_th, lens_corner_r);
}

module lens_recess_cut() {
    translate([lens_center_x, lens_center_y, body_h - lens_recess_depth - 0.05])
        rounded_rect_prism(lens_len + fit_clearance, lens_wid + fit_clearance, lens_recess_depth + 0.1, lens_corner_r);
}

module lens_opening_cut() {
    translate([lens_center_x, lens_center_y, body_h - 4.6])
        rounded_rect_prism(lens_open_len, lens_open_wid, 5.2, lens_open_corner_r);
}

module oled_support_ring() {
    translate([oled_center_x, oled_center_y, body_h - shell_th - oled_support_h + 0.05])
        difference() {
            rounded_rect_prism(oled_support_len, oled_support_wid, oled_support_h, 2.0);
            translate([0, 0, -0.1])
                rounded_rect_prism(oled_window_len + 1.6, oled_window_wid + 1.6, oled_support_h + 0.2, 1.0);
        }
}

module rear_typec_recess_cut() {
    translate([typec_center_x, body_wid - typec_recess_depth + 0.02, typec_center_z])
        rotate([90, 0, 0]) rounded_rect_prism(typec_recess_w, typec_recess_h, typec_recess_depth, 2.6);
}

module rear_typec_cutout() {
    translate([typec_center_x, body_wid - 0.1, typec_center_z])
        rotate([90, 0, 0]) linear_extrude(height = shell_th + 0.6)
            hull() {
                translate([0, typec_w / 2 - typec_h / 2]) circle(d = typec_h);
                translate([0, -typec_w / 2 + typec_h / 2]) circle(d = typec_h);
            }
}

module right_cable_hole_cut() {
    translate([body_len - 0.1, cable_exit_y, cable_exit_z])
        rotate([0, 90, 0]) linear_extrude(height = shell_th + 0.7)
            hull() {
                translate([0, cable_slot_w / 2 - cable_slot_h / 2]) circle(d = cable_slot_h);
                translate([0, -cable_slot_w / 2 + cable_slot_h / 2]) circle(d = cable_slot_h);
            }
}

module right_cable_notch_cut() {
    hull() {
        translate([body_len - cable_notch_len, cable_exit_y - 4.8, -0.1]) cube([cable_notch_len, 9.6, 0.2]);
        translate([body_len - 2.2, cable_exit_y - 3.8, cable_exit_z + 1.6]) cube([2.3, 7.6, 0.2]);
    }
}

module front_button_band_cut() {
    translate([body_len / 2, -0.05, button_band_z])
        rotate([-90, 0, 0])
            rounded_rect_prism(button_band_len, button_band_h, button_band_depth + 0.1, 2.8);
}

module front_button_hole_cut(x_pos) {
    translate([x_pos, -0.05, button_band_z])
        rotate([-90, 0, 0]) cylinder(d = button_hole_d, h = shell_th + 1.2);
}

module front_button_sleeve(x_pos) {
    translate([x_pos, shell_th - 0.15, button_band_z])
        rotate([-90, 0, 0])
            difference() {
                cylinder(d = button_sleeve_d, h = button_sleeve_len);
                translate([0, 0, -0.1]) cylinder(d = button_hole_d + 0.3, h = button_sleeve_len + 0.2);
            }
}

module button_cap() {
    union() {
        cylinder(d = button_stem_d, h = button_stem_len);
        translate([0, 0, button_stem_len])
            intersection() {
                scale([1, 1, 0.10]) sphere(d = button_head_d);
                translate([-button_head_d, -button_head_d, 0]) cube([button_head_d * 2, button_head_d * 2, button_cap_depth]);
            }
    }
}

module tray_shell() {
    translate([tray_center_x, tray_center_y, 0])
        difference() {
            rounded_rect_prism(tray_outer_len, tray_outer_wid, tray_outer_h, tray_corner_r);
            translate([0, 0, tray_base_th - 0.01])
                rounded_rect_prism(
                    tray_outer_len - 2 * tray_wall,
                    tray_outer_wid - 2 * tray_wall,
                    tray_outer_h,
                    tray_corner_r - 1.5
                );
            translate([0, 0, -0.1])
                rounded_rect_prism(service_inner_len, service_inner_wid, tray_base_th + 0.5, service_corner_r - 0.8);
        }
}

module tray_mount_tube(pos) {
    translate([pos[0], pos[1], 0])
        difference() {
            cylinder(d = mount_tube_d, h = tray_outer_h - 0.4);
            translate([0, 0, -0.1]) cylinder(d = mount_hole_d, h = tray_outer_h + 0.2);
            translate([0, 0, -0.1]) cylinder(d = tray_mount_counterbore_d, h = tray_mount_counterbore_h + 0.1);
        }
}

module upper_mount_boss(pos) {
    translate([pos[0], pos[1], upper_boss_bottom_z])
        difference() {
            cylinder(d = upper_boss_d, h = upper_boss_h);
            translate([0, 0, -0.1]) cylinder(d = mount_hole_d + 0.25, h = upper_boss_h + 0.2);
            translate([0, 0, upper_boss_h - upper_insert_h])
                cylinder(d = upper_insert_d, h = upper_insert_h + 0.2);
        }
}

module door_boss(pos) {
    translate([pos[0], pos[1], tray_base_th])
        difference() {
            cylinder(d = door_boss_d, h = door_boss_h);
            translate([0, 0, -0.1]) cylinder(d = door_screw_d, h = door_boss_h + 0.2);
        }
}

module pcb_standoff(local_x, local_y) {
    translate([pcb_origin_x + local_x, pcb_origin_y + local_y, tray_base_th])
        difference() {
            cylinder(d = pcb_standoff_d, h = pcb_standoff_h);
            translate([0, 0, -0.1]) cylinder(d = pcb_hole_d, h = pcb_standoff_h + 0.2);
        }
}

module pcb_standoffs() {
    for (local_x = [4.5, pcb_len - 4.5]) {
        for (local_y = [4.5, pcb_wid - 4.5]) {
            pcb_standoff(local_x, local_y);
        }
    }
}

module cable_relief_posts() {
    translate([body_len - 17.0, body_wid - 13.0, tray_base_th]) cylinder(d = 4.0, h = 5.6);
    translate([body_len - 17.0, body_wid - 8.0, tray_base_th]) cylinder(d = 4.0, h = 5.6);
    translate([body_len - 22.8, body_wid - 13.0, tray_base_th + 4.0]) cube([5.8, 5.0, 1.4]);
}

module buzzer_vent_cut() {
    for (offset = [-1, 0, 1]) {
        translate([buzzer_center_x + offset * buzzer_hole_spacing, buzzer_front_y, -0.1])
            cylinder(d = buzzer_hole_d, h = base_th + 0.5);
    }
}

module service_door() {
    difference() {
        union() {
            rounded_rect_prism(service_outer_len, service_outer_wid, service_plate_th, service_corner_r);
            translate([0, 0, service_plate_th])
                rounded_rect_prism(service_inner_len - 0.4, service_inner_wid - 0.4, service_tongue_h, service_corner_r - 0.6);
        }
        for (pos = door_boss_positions) {
            translate([pos[0] - tray_center_x, pos[1] - tray_center_y, -0.1]) {
                cylinder(d = door_screw_d, h = service_plate_th + service_tongue_h + 0.2);
                cylinder(d = door_counterbore_d, h = service_plate_th + 0.1);
            }
        }
    }
}

module lower_chassis() {
    union() {
        tray_shell();
        pcb_standoffs();
        cable_relief_posts();
        for (pos = mount_positions) {
            tray_mount_tube(pos);
        }
        for (pos = door_boss_positions) {
            door_boss(pos);
        }
    }
}

module display_mockup() {
    color([0.08, 0.08, 0.09])
        translate([body_len / 2, body_wid / 2, display_mock_z - 0.45])
            rounded_rect_prism(display_mock_board_len, display_mock_board_wid, 0.6, 4.2);
    color([0.10, 0.42, 0.58])
        translate([oled_center_x, oled_center_y, display_mock_z])
            rounded_rect_prism(oled_window_len, oled_window_wid, 0.22, 1.2);
    color([0.98, 0.44, 0.26])
        translate([rgb_center_x, rgb_center_y, display_mock_z]) cylinder(d = 1.8, h = 0.26);
}

module cable_segment(a, b, dia) {
    hull() {
        translate(a) sphere(d = dia);
        translate(b) sphere(d = dia);
    }
}

module render_cable() {
    cable_d = 2.9;
    p0 = [body_len - 0.3, cable_exit_y, cable_exit_z];
    p1 = [body_len + 7.0, cable_exit_y + 0.8, cable_exit_z - 0.15];
    p2 = [body_len + 16.0, cable_exit_y + 3.4, cable_exit_z - 0.45];
    color([0.07, 0.07, 0.08]) {
        cable_segment(p0, p1, cable_d);
        cable_segment(p1, p2, cable_d);
    }
}

module upper_skin() {
    difference() {
        outer_body();
        inner_cavity();
        bottom_opening_cut();
        lens_recess_cut();
        lens_opening_cut();
        rear_typec_recess_cut();
        rear_typec_cutout();
        right_cable_hole_cut();
        right_cable_notch_cut();
        front_button_band_cut();
        for (x_pos = button_x_positions) {
            front_button_hole_cut(x_pos);
        }
        buzzer_vent_cut();
    }
}

module upper_bezel() {
    union() {
        upper_skin();
        oled_support_ring();
        for (x_pos = button_x_positions) {
            front_button_sleeve(x_pos);
        }
        for (pos = mount_positions) {
            upper_mount_boss(pos);
        }
    }
}

module beauty_shell() {
    difference() {
        outer_body();
        lens_recess_cut();
        lens_opening_cut();
        rear_typec_recess_cut();
        rear_typec_cutout();
        right_cable_hole_cut();
        right_cable_notch_cut();
        front_button_band_cut();
    }
}

module button_caps_plate() {
    for (idx = [0:2]) {
        translate([idx * 12, 0, 0]) button_cap();
    }
}

module assembly_view() {
    color([0.18, 0.18, 0.19]) upper_bezel();
    color([0.11, 0.11, 0.12]) lower_chassis();
    color([0.13, 0.13, 0.14])
        translate([tray_center_x, tray_center_y, 0.15]) service_door();
    display_mockup();
    color([0.03, 0.03, 0.04, 0.64])
        translate([lens_center_x, lens_center_y, body_h - lens_th]) lens_blank();
    color([0.14, 0.14, 0.15]) {
        for (x_pos = button_x_positions) {
            translate([x_pos, shell_th - 0.28, button_band_z])
                rotate([90, 0, 0]) button_cap();
        }
    }
    render_cable();
}

module visual_view() {
    color([0.24, 0.24, 0.25]) beauty_shell();
    display_mockup();
    color([0.01, 0.01, 0.02, 0.48])
        translate([lens_center_x, lens_center_y, body_h - lens_th]) lens_blank();
    color([0.11, 0.11, 0.12]) {
        for (x_pos = button_x_positions) {
            translate([x_pos, shell_th - 0.20, button_band_z])
                rotate([90, 0, 0]) button_cap();
        }
    }
    render_cable();
}

module plate_layout() {
    lower_chassis();
    translate([92, 0, 0]) upper_bezel();
    translate([22, 54, 0]) service_door();
    translate([78, 54, 0]) lens_blank();
    translate([120, 54, 0]) button_caps_plate();
}

if (resolved_part == "LOWER_CHASSIS") {
    lower_chassis();
} else if (resolved_part == "UPPER_BEZEL") {
    upper_bezel();
} else if (resolved_part == "SERVICE_DOOR") {
    translate([tray_center_x, tray_center_y, 0]) service_door();
} else if (resolved_part == "LENS") {
    lens_blank();
} else if (resolved_part == "BUTTON_CAPS") {
    button_caps_plate();
} else if (resolved_part == "PLATE") {
    plate_layout();
} else {
    assembly_view();
}
