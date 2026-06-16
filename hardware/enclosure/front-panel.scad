// AetherGuard Enclosure — Front Panel
//
// Removable front panel with E-stop + confirm button holes, status LED
// window, and ventilation. Attaches to chassis with 4 corner screws.
//
// Render: openscad -o front-panel.stl front-panel.scad

use <parameters.scad>

$fn = 60;

PANEL_T = 3;

module front_panel() {
    difference() {
        // Panel body (fits front opening of chassis)
        cube([ENCLOSURE_W - 2*WALL, WALL, ENCLOSURE_H - FLOOR_T + 1]);

        translate([0, -1, 0]) {
            // E-stop button hole (22mm)
            translate([ESTOP_X, WALL/2 + 1, ESTOP_Z])
                rotate([90, 0, 0])
                    cylinder(h = WALL + 4, d = BUTTON_DIAMETER);

            // Confirm button hole (22mm)
            translate([CONFIRM_X, WALL/2 + 1, CONFIRM_Z])
                rotate([90, 0, 0])
                    cylinder(h = WALL + 4, d = BUTTON_DIAMETER);

            // Status LED window
            translate([LED_WINDOW_X, -1, LED_WINDOW_Z])
                cube([LED_WINDOW_W, WALL + 2, LED_WINDOW_H]);

            // Corner screw holes (M3)
            for (sx = [8, ENCLOSURE_W - 2*WALL - 8]) {
                for (sz = [8, ENCLOSURE_H - FLOOR_T - 8]) {
                    translate([sx, WALL/2 + 1, sz])
                        rotate([90, 0, 0])
                            cylinder(h = WALL + 4, d = 3.2);
                }
            }
        }

        // Ventilation slots at top of panel
        for (i = [0 : 5]) {
            translate([10 + i * 30, -1, ENCLOSURE_H - FLOOR_T - 15])
                cube([20, WALL + 2, 3]);
        }
    }

    // E-stop label recess (cosmetic, optional)
    translate([ESTOP_X - 15, WALL + 0.5, ESTOP_Z + 18])
        linear_extrude(0.5)
            text("ESTOP", size = 5, halign = "center");

    translate([CONFIRM_X - 18, WALL + 0.5, CONFIRM_Z + 18])
        linear_extrude(0.5)
            text("CONFIRM", size = 5, halign = "center");
}

front_panel();
