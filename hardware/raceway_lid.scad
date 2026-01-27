/*
 * FluxGuard Enclosure - RACEWAY LID (Cable Cover)
 * Print: Flat (as-is)
 * Supports: None needed
 */

// --- Parameters ---
raceway_w = 14.0;
separator_w = 1.6;
box_l = 88.0;
$fn = 60;

module raceway_cover() {
    len = box_l - 12; 
    wid = raceway_w + separator_w/2;
    
    difference() {
        cube([len, wid, 1.5]);
        translate([len/2, wid/2, -1]) cylinder(d=4, h=4); // Finger hole
        translate([len/2, wid/2 + 5, 1]) linear_extrude(0.6) text("FG-SEC", size=4, halign="center");
    }
    
    // Mounting tabs
    translate([4, 0, -2.5]) cube([3, wid, 2.5]);
    translate([len - 7, 0, -2.5]) cube([3, wid, 2.5]);
}

// === PRINT-READY: Flat ===
raceway_cover();
