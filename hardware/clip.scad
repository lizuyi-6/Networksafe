/*
 * FluxGuard Enclosure - CLIP (Adjustable PCB Clamp)
 * Print: Lying flat on side (pre-rotated 90°)
 * Supports: None needed
 * CRITICAL: Layer lines parallel to flex arms = long life!
 */

// --- Parameters ---
pcb_l = 52.0; pcb_w = 28.0; pcb_thick = 1.6; 
pcb_z = 10.0; 
box_l = 88.0;
$fn = 60;

module adjustable_clip() {
    rail_len = box_l - 22;
    union() {
        difference() {
            cube([rail_len, 5, pcb_z + 4 + pcb_thick]);
            translate([-1, 2.5, pcb_z + 1])
                cube([rail_len + 5, 3, pcb_thick + 0.4]);
             for(i=[0:7]) translate([6+i*9, -1, 4]) cube([2.5, 6, 2]); 
             for(i=[0:7]) translate([10+i*9, -1, pcb_z + pcb_thick + 1]) cube([2.5, 6, 4]); 
        }
        
        // Handle for finger grip
        translate([rail_len/2 - 8, -2, 0]) cube([16, 2, 8]);
        
        // Locking feet with chamfer
        hull() {
             translate([8, -5, 0]) cube([7, 7, 2.5]);
             translate([8, -1, 2.5]) cube([7, 1, 0.1]); 
        }
        hull() {
             translate([rail_len - 25, -5, 0]) cube([7, 7, 2.5]);
             translate([rail_len - 25, -1, 2.5]) cube([7, 1, 0.1]); 
        }
        
        // Ratchet tooth
        translate([rail_len/2, 5, 3]) rotate([0,0,-90]) cylinder(r=1, h=5, $fn=3);
            
        // Thermal standoffs
        for(i=[0:5]) translate([12+i*10, 2.5, pcb_z + 1 + pcb_thick]) cylinder(d=1.8, h=0.5);
    }
}

// === PRINT-READY: Rotated 90° to lie flat ===
clip_height = pcb_z + 4 + pcb_thick;
translate([0, clip_height, 0]) rotate([-90, 0, 0]) adjustable_clip();
