// AetherGuard Gateway Appliance enclosure - front panel.
//
// Front I/O and human-safety interface:
// SERVER, LAN/WAN, MGMT, service USB-C, status window, E-stop, confirm.
//
// Render/export:
//   openscad -o front-panel.stl front-panel.scad

include <parameters.scad>

$fn = 64;

module front_panel() {
    difference() {
        cube([PANEL_W, PANEL_T, PANEL_H]);

        // Network ports. MGMT is physically grouped but separated by spacing.
        panel_rect_cutout(SERVER_PORT_X, RJ45_Z, RJ45_W, RJ45_H);
        panel_rect_cutout(LANWAN_PORT_X, RJ45_Z, RJ45_W, RJ45_H);
        panel_rect_cutout(MGMT_PORT_X, RJ45_Z, RJ45_W, RJ45_H);

        // Service/diagnostic USB-C passthrough.
        panel_rect_cutout(SERVICE_USB_X, SERVICE_USB_Z, USB_C_W, USB_C_H);

        // Operator controls.
        panel_round_cutout(ESTOP_X, ESTOP_Z, BUTTON_DIAMETER);
        panel_round_cutout(CONFIRM_X, CONFIRM_Z, BUTTON_DIAMETER);

        // Root-resistant status light pipe/window.
        panel_rect_cutout(STATUS_WINDOW_X, STATUS_WINDOW_Z, STATUS_WINDOW_W, STATUS_WINDOW_H);

        // Front mounting screws.
        for (sx = [10, PANEL_W - 10]) {
            for (sz = [10, PANEL_H - 10]) {
                panel_round_cutout(sx, sz, 3.2);
            }
        }

        // Upper intake slots.
        for (i = [0 : 7]) {
            translate([20 + i * 24, -1, PANEL_H - 18])
                cube([15, PANEL_T + 2, 3.2]);
        }
    }

    // Raised port frames and operator guards.
    rect_frame(SERVER_PORT_X, RJ45_Z, RJ45_W, RJ45_H, 2, 1.2);
    rect_frame(LANWAN_PORT_X, RJ45_Z, RJ45_W, RJ45_H, 2, 1.2);
    rect_frame(MGMT_PORT_X, RJ45_Z, RJ45_W, RJ45_H, 2, 1.2);
    rect_frame(SERVICE_USB_X, SERVICE_USB_Z, USB_C_W, USB_C_H, 1.5, 1.0);
    rect_frame(STATUS_WINDOW_X, STATUS_WINDOW_Z, STATUS_WINDOW_W, STATUS_WINDOW_H, 2, 1.2);

    button_guard(ESTOP_X, ESTOP_Z, BUTTON_DIAMETER + 2, BUTTON_GUARD_OD);
    button_guard(CONFIRM_X, CONFIRM_Z, BUTTON_DIAMETER + 2, BUTTON_GUARD_OD);

    // Embossed labels.
    panel_text("SERVER", SERVER_PORT_X, RJ45_Z - 17, 4.2);
    panel_text("LAN/WAN", LANWAN_PORT_X, RJ45_Z - 17, 4.2);
    panel_text("MGMT", MGMT_PORT_X, RJ45_Z - 17, 4.2);
    panel_text("USB-C", SERVICE_USB_X, SERVICE_USB_Z - 15, 4.5);
    panel_text("ROOT-RESISTANT STATUS", STATUS_WINDOW_X, STATUS_WINDOW_Z + 14, 5);
    panel_text("E-STOP", ESTOP_X, ESTOP_Z - 22, 5);
    panel_text("CONFIRM", CONFIRM_X, CONFIRM_Z - 22, 5);
    panel_text("AETHERGUARD", 78, PANEL_H - 34, 8);
}

module panel_rect_cutout(cx, cz, w, h) {
    translate([cx - w / 2, -1, cz - h / 2])
        cube([w, PANEL_T + 2, h]);
}

module panel_round_cutout(cx, cz, d) {
    translate([cx, PANEL_T + 1, cz])
        rotate([90, 0, 0])
            cylinder(h = PANEL_T + 2, d = d);
}

module rect_frame(cx, cz, w, h, t, depth) {
    translate([cx - w / 2 - t, -depth, cz - h / 2 - t])
        cube([w + 2 * t, depth + EPS, t]);
    translate([cx - w / 2 - t, -depth, cz + h / 2])
        cube([w + 2 * t, depth + EPS, t]);
    translate([cx - w / 2 - t, -depth, cz - h / 2])
        cube([t, depth + EPS, h]);
    translate([cx + w / 2, -depth, cz - h / 2])
        cube([t, depth + EPS, h]);
}

module button_guard(cx, cz, inner_d, outer_d) {
    translate([cx, EPS, cz])
        rotate([90, 0, 0])
            difference() {
                cylinder(h = 2 + EPS, d = outer_d);
                translate([0, 0, -0.1])
                    cylinder(h = 2.4 + EPS, d = inner_d);
            }
}

module panel_text(label, cx, cz, size_value) {
    translate([cx, EPS, cz])
        rotate([90, 0, 0])
            linear_extrude(height = 0.55)
                text(label, size = size_value, halign = "center", valign = "center");
}

front_panel();
