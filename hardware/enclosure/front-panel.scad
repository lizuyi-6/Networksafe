// AetherGuard Root-Resistant Gateway enclosure - operator front panel.
//
// The face is deliberately divided into data, management/service, and hardware
// authorization zones so a field operator can understand the trust boundary at
// a glance and by touch.
//
// Render/export:
//   openscad -o front-panel.stl front-panel.scad

include <parameters.scad>
use <geometry.scad>

$fn = 64;

module front_panel() {
    difference() {
        rounded_front_plate(PANEL_W, PANEL_H, PANEL_T, 4.5);

        panel_rect_cutout(SERVER_PORT_X, RJ45_Z, RJ45_W, RJ45_H);
        panel_rect_cutout(LANWAN_PORT_X, RJ45_Z, RJ45_W, RJ45_H);
        panel_rect_cutout(MGMT_PORT_X, RJ45_Z, RJ45_W, RJ45_H);
        panel_rect_cutout(SERVICE_USB_X, SERVICE_USB_Z, USB_C_W, USB_C_H);

        panel_round_cutout(ESTOP_X, ESTOP_Z, BUTTON_DIAMETER);
        panel_round_cutout(CONFIRM_X, CONFIRM_Z, BUTTON_DIAMETER);
        panel_rect_cutout(
            STATUS_WINDOW_X,
            STATUS_WINDOW_Z,
            STATUS_WINDOW_W,
            STATUS_WINDOW_H
        );

        for (screw_position = FRONT_PANEL_SCREW_POSITIONS) {
            panel_round_cutout(
                screw_position[0],
                screw_position[1],
                FRONT_PANEL_SCREW_D
            );
        }

        front_style_recesses();
        front_engraving();
    }

    data_plane_bezel();
    rect_frame(SERVER_PORT_X, RJ45_Z, RJ45_W, RJ45_H, 2, 1.4);
    rect_frame(LANWAN_PORT_X, RJ45_Z, RJ45_W, RJ45_H, 2, 1.4);
    rect_frame(MGMT_PORT_X, RJ45_Z, RJ45_W, RJ45_H, 2.4, 1.7);
    rect_frame(SERVICE_USB_X, SERVICE_USB_Z, USB_C_W, USB_C_H, 1.6, 1.2);
    rect_frame(
        STATUS_WINDOW_X,
        STATUS_WINDOW_Z,
        STATUS_WINDOW_W,
        STATUS_WINDOW_H,
        2,
        1.5
    );
    status_window_dividers();

    button_guard(
        ESTOP_X,
        ESTOP_Z,
        BUTTON_DIAMETER + 2,
        ESTOP_GUARD_OD,
        3
    );
    button_guard(
        CONFIRM_X,
        CONFIRM_Z,
        BUTTON_DIAMETER + 2,
        CONFIRM_GUARD_OD,
        2.2
    );
    control_zone_separator();
}

module panel_rect_cutout(center_x, center_z, width, height) {
    translate([center_x - width / 2, -1, center_z - height / 2])
        cube([width, PANEL_T + 2, height]);
}

module panel_round_cutout(center_x, center_z, diameter) {
    translate([center_x, PANEL_T + 1, center_z])
        rotate([90, 0, 0])
            cylinder(h = PANEL_T + 2, d = diameter);
}

module front_style_recesses() {
    // Paint-fill channels create the visual line that separates data-plane I/O
    // from the physical authorization controls.
    translate([18, -0.4, 48])
        cube([164, 1.2, 1.2]);
    translate([202, -0.4, 47])
        rotate([0, 0, -12])
            cube([105, 1.2, 1.2]);

    for (groove_offset = [0, 7, 14]) {
        translate([151 + groove_offset, -0.4, 58])
            rotate([0, 0, -20])
                cube([23, 1.2, 1.2]);
    }
}

module data_plane_bezel() {
    bezel_x = 16;
    bezel_z = 18;
    bezel_w = 170;
    bezel_h = 29;
    bezel_t = 1.2;
    bezel_depth = 0.9;

    translate([bezel_x, -bezel_depth, bezel_z])
        cube([bezel_w, bezel_depth + EPS, bezel_t]);
    translate([bezel_x, -bezel_depth, bezel_z + bezel_h - bezel_t])
        cube([bezel_w, bezel_depth + EPS, bezel_t]);
    translate([bezel_x, -bezel_depth, bezel_z])
        cube([bezel_t, bezel_depth + EPS, bezel_h]);
    translate([bezel_x + bezel_w - bezel_t, -bezel_depth, bezel_z])
        cube([bezel_t, bezel_depth + EPS, bezel_h]);
}

module rect_frame(center_x, center_z, width, height, thickness, depth) {
    translate([
        center_x - width / 2 - thickness,
        -depth,
        center_z - height / 2 - thickness
    ])
        cube([width + 2 * thickness, depth + EPS, thickness]);
    translate([
        center_x - width / 2 - thickness,
        -depth,
        center_z + height / 2
    ])
        cube([width + 2 * thickness, depth + EPS, thickness]);
    translate([
        center_x - width / 2 - thickness,
        -depth,
        center_z - height / 2
    ])
        cube([thickness, depth + EPS, height]);
    translate([
        center_x + width / 2,
        -depth,
        center_z - height / 2
    ])
        cube([thickness, depth + EPS, height]);
}

module status_window_dividers() {
    segment_width = STATUS_WINDOW_W / STATUS_SEGMENT_COUNT;
    window_left = STATUS_WINDOW_X - STATUS_WINDOW_W / 2;

    for (divider_index = [1 : STATUS_SEGMENT_COUNT - 1]) {
        translate([
            window_left + divider_index * segment_width - 0.65,
            -1.7,
            STATUS_WINDOW_Z - STATUS_WINDOW_H / 2
        ])
            cube([1.3, 1.9, STATUS_WINDOW_H]);
    }
}

module button_guard(center_x, center_z, inner_diameter, outer_diameter, depth) {
    translate([center_x, EPS, center_z])
        rotate([90, 0, 0])
            difference() {
                cylinder(h = depth + EPS, d = outer_diameter);
                translate([0, 0, -0.1])
                    cylinder(h = depth + 0.4, d = inner_diameter);
            }
}

module control_zone_separator() {
    translate([195, -1.4, 11])
        cube([2.4, 1.6, 35]);
    translate([195, -1.4, 43])
        rotate([0, -35, 0])
            cube([10, 1.6, 2.4]);
}

module front_engraving() {
    translate([29, 0.6, 64])
        rotate([90, 0, 0])
            hex_ring(21, 2.4, 0.8);
    engraved_panel_text("AG", 29, 64, 6.5, 0.75);
    engraved_panel_text("AETHERGUARD", 93, 66, 9.2, 0.75);
    engraved_panel_text("ROOT-RESISTANT GATEWAY", 97, 55.5, 4.1, 0.6);

    engraved_panel_text("DATA PLANE", 76, 43, 4.2, 0.6);
    engraved_panel_text("TRUST", MGMT_PORT_X, 43, 4.2, 0.6);
    engraved_panel_text("SERVICE", SERVICE_USB_X, 43, 4.2, 0.6);

    engraved_panel_text("SERVER", SERVER_PORT_X, 13.5, 4.1, 0.6);
    engraved_panel_text("LAN/WAN", LANWAN_PORT_X, 13.5, 4.1, 0.6);
    engraved_panel_text("MGMT", MGMT_PORT_X, 13.5, 4.1, 0.6);
    engraved_panel_text("USB-C", SERVICE_USB_X, 13.5, 4.1, 0.6);

    segment_labels = ["ISOLATED", "ARMED", "RELEASED", "FAULT"];
    segment_width = STATUS_WINDOW_W / STATUS_SEGMENT_COUNT;
    window_left = STATUS_WINDOW_X - STATUS_WINDOW_W / 2;

    for (segment_index = [0 : STATUS_SEGMENT_COUNT - 1]) {
        engraved_panel_text(
            segment_labels[segment_index],
            window_left + segment_width * (segment_index + 0.5),
            STATUS_WINDOW_Z + 11.5,
            3,
            0.5
        );
    }

    engraved_panel_text("E-STOP", ESTOP_X, 49.2, 3.7, 0.6);
    engraved_panel_text("CONFIRM", CONFIRM_X, 49.2, 3.7, 0.6);
}

module engraved_panel_text(label, center_x, center_z, size_value, engraving_depth = 0.55) {
    translate([center_x, engraving_depth, center_z])
        rotate([90, 0, 0])
            linear_extrude(height = engraving_depth + EPS)
                text(
                    label,
                    size = size_value,
                    halign = "center",
                    valign = "center"
                );
}

front_panel();
