/*
 * AetherGuard Enclosure - BRIDGE (Legacy Reference)
 * Print: Flat (as-is)
 * Supports: RECOMMENDED for alignment tabs
 *
 * Legacy helper from the retired unibody concept.
 * The current serial deployer shell uses chassis/top_plate/bottom_cover.
 */

// --- Parameters ---
pcb_z = 10.0; 
raceway_w = 14.0;
separator_w = 1.6;
wall = 1.8;
box_w = 63.0;
$fn = 60;

bridge_span = box_w - 2*wall - raceway_w - separator_w;
bridge_h = 13.5;

module component_bridge() {
    bridge_len = 30.0;
    
    union() {
        difference() {
            cube([bridge_len, bridge_span + 2*wall + 1, bridge_h]);
            translate([2, (bridge_span + 3 - 27.5)/2, 2.5]) cube([26, 27.5, 50]); 
            translate([3, (bridge_span + 3 - 23.5)/2, -1]) cube([24, 23.5, 100]); 
            translate([bridge_len - 6, 9, -1]) cylinder(d=3.5, h=10); 
            translate([-1, 5, 1]) cube([32, bridge_span - 6, 2]);
        }
        
        // Ribs
        for(y_pos = [2, 12, 22, 32]) translate([0, y_pos, 0]) cube([bridge_len, 1.8, bridge_h]);
        
        // Diagonal bracing
        intersection() {
             cube([bridge_len, bridge_span + 3, bridge_h]);
             union() {
                 translate([0,0,0]) rotate([0,0,45]) cube([55, 2, bridge_h]);
                 translate([22,0,0]) rotate([0,0,45]) cube([55, 2, bridge_h]);
                 translate([10,35,0]) rotate([0,0,-45]) cube([55, 2, bridge_h]);
             }
        }
        
        // Top pads
        translate([3, 3, bridge_h]) cylinder(r=1.2, h=0.3);
        translate([bridge_len-3, 3, bridge_h]) cylinder(r=1.2, h=0.3);
        translate([3, bridge_span+2*wall-2, bridge_h]) cylinder(r=1.2, h=0.3);
        translate([bridge_len-3, bridge_span+2*wall-2, bridge_h]) cylinder(r=1.2, h=0.3);
        
        // Alignment tabs
        translate([0, 0, 0]) cube([2, 2, bridge_h + 2]);
        translate([bridge_len - 2, 0, 0]) cube([2, 2, bridge_h + 2]);
    }
}

// === PRINT-READY: Flat (enable supports) ===
component_bridge();
