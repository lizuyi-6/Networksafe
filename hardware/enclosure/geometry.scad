// Shared geometric helpers for the AetherGuard enclosure.

module rounded_rect_2d(size, radius) {
    safe_radius = min(radius, min(size[0], size[1]) / 2 - 0.01);

    offset(r = safe_radius)
        translate([safe_radius, safe_radius])
            square([size[0] - 2 * safe_radius, size[1] - 2 * safe_radius]);
}

module rounded_prism(size, radius) {
    linear_extrude(height = size[2])
        rounded_rect_2d([size[0], size[1]], radius);
}

module rounded_front_plate(width, height, depth, radius) {
    translate([0, depth, 0])
        rotate([90, 0, 0])
            linear_extrude(height = depth)
                rounded_rect_2d([width, height], radius);
}

module rounded_slot_2d(length, width) {
    hull() {
        translate([width / 2, width / 2])
            circle(d = width);
        translate([length - width / 2, width / 2])
            circle(d = width);
    }
}

module rounded_slot_prism(length, width, height) {
    linear_extrude(height = height)
        rounded_slot_2d(length, width);
}

module hex_ring(outer_diameter, band_width, height) {
    difference() {
        cylinder(h = height, d = outer_diameter, $fn = 6);
        translate([0, 0, -0.1])
            cylinder(h = height + 0.2, d = outer_diameter - 2 * band_width, $fn = 6);
    }
}

module countersunk_hole(through_diameter, head_diameter, total_height, countersink_height) {
    translate([0, 0, -0.1])
        cylinder(h = total_height + 0.2, d = through_diameter);
    translate([0, 0, total_height - countersink_height])
        cylinder(
            h = countersink_height + 0.1,
            d1 = through_diameter,
            d2 = head_diameter
        );
}
