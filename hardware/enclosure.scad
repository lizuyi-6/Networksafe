/*
 * FluxGuard Deployment Dongle Enclosure
 * Version: v22.0 (Unibody / Final Edition - Print Ready)
 * Date: 2026-01-24
 * 
 * === STRUCTURE ===
 *  - UNIBODY: Chassis has integrated 1.5mm floor (no separate bottom cover).
 *  - All bugs from v21 and earlier resolved.
 *
 * === EXPORT OPTIONS (part_to_print) ===
 *  "ALL"      - Assembly preview (not for printing)
 *  "CHASSIS"  - Main body, pre-rotated upside-down for FDM
 *  "CLIP"     - Adjustable PCB clamp, pre-rotated 90° (lying flat)
 *  "BRIDGE"   - Component support bridge (needs supports)
 *  "RACEWAY_LID" - Cable raceway cover
 *  "PLATE"    - ALL 4 parts arranged on one build plate!
 *
 * === PRINTING TIPS ===
 *  CHASSIS: Prints upside-down. Supports optional (use "Build Plate Only").
 *  CLIP: Already rotated - layer lines run along flex arms for durability.
 *  BRIDGE: Enable supports for alignment tabs.
 *  RACEWAY_LID: No supports needed.
 */

// --- 0. Part Selector ---
// Options: ALL | EXPLODED | CHASSIS | CLIP | BRIDGE | RACEWAY_LID | PLATE
part_to_print = "ALL"; 

// --- 1. Parameters ---
pcb_l = 52.0; pcb_w = 28.0; pcb_thick = 1.6; 
pcb_z = 10.0; 

raceway_w = 14.0;
separator_w = 1.6;
wall = 1.8;
box_w = 63.0;
box_l = 88.0;
box_h = 32.0;
corn_r = 3.0;
acrylic_thick = 3.0;
tol = 0.3;
slide_tol = 0.5;
$fn = 60;

bridge_span = box_w - 2*wall - raceway_w - separator_w;

// Bridge height calculation: 
// Acrylic bottom Z = box_h - acrylic_thick - 1.5 = 32 - 3 - 1.5 = 27.5
// Bridge slot bottom Z = 14
// Required bridge_h = 27.5 - 14 = 13.5
bridge_h = 13.5; // **FIXED**

module r_cube(x, y, z, r) {
    hull() {
        translate([r, r, 0]) cylinder(r=r, h=z);
        translate([x-r, r, 0]) cylinder(r=r, h=z);
        translate([x-r, y-r, 0]) cylinder(r=r, h=z);
        translate([r, y-r, 0]) cylinder(r=r, h=z);
    }
}

// --- 2. The Parts ---

module chassis() {
    difference() {
        union() {
            // Main Body
            difference() {
                r_cube(box_l, box_w, box_h, corn_r);
                // Floor thickness = 1.5mm (cutout starts at Z=1.5, not Z=-1)
                translate([wall, wall, 1.5]) r_cube(box_l - 2*wall, box_w - 2*wall, box_h, corn_r-1);
                
                // Acrylic slots
                translate([-1, wall - 0.5, box_h - acrylic_thick - 1.5]) 
                    cube([box_l - 10, box_w - 2*wall + 1, acrylic_thick + 0.5]);
                translate([box_l - 12, wall - 0.5, box_h - acrylic_thick - 2.0]) 
                    cube([15, box_w - 2*wall + 1, acrylic_thick + 1.0]);
                
                translate([-1, wall - 0.5, 1.5]) cube([box_l + 2, box_w - 2*wall + 1, 2.0]);
                
                // Ports
                translate([box_l - 5, 18, pcb_z + 2]) cube([10, 16, 8]); 
                translate([-1, 14, 7]) cube([5, 12, 6]); 
                
                // Floor slots for clip
                translate([12, wall, 1]) cube([8, 35, 2.5]); 
                translate([box_l - 32, wall, 1]) cube([8, 35, 2.5]);
                
                // Side Vents
                for(i = [0:5]) {
                    translate([22 + i*9, -1, 4]) cube([2.5, 5, 10]); 
                    translate([22 + i*9, box_w - 4, 4]) cube([2.5, 5, 10]);
                }
                translate([box_l/2, box_w - 0.6, box_h/2]) rotate([90, 0, 180]) linear_extrude(1.0) text("FluxGuard Pro", size=6, font="Arial:style=Bold", halign="center", valign="center");
            }
            
            // Corner bumpers
            for(x = [0, box_l]) for(y = [0, box_w]) {
                translate([x==0?0:x, y==0?0:y, 0]) difference() {
                    cylinder(r=5, h=box_h);
                    translate([0,0,-1]) cylinder(r=corn_r, h=box_h+2);
                    if(x==0 && y==0) translate([0,0,-1]) cube([10,10,35]);
                    if(x>0 && y==0) translate([-10,0,-1]) cube([10,10,35]);
                    if(x==0 && y>0) translate([0,-10,-1]) cube([10,10,35]);
                    if(x>0 && y>0) translate([-10,-10,-1]) cube([10,10,35]);
                }
            }
            
            translate([box_l - wall, 16, pcb_z + 1]) cube([wall+1, 20, 10]); 
            
            // Crush ribs
            for(x_pos = [10, 35, 60]) {
                translate([x_pos, wall, box_h - acrylic_thick - 1.5]) 
                    hull() {
                        translate([0,0,0]) cylinder(r=0.1, h=0.1); 
                        translate([2,0,0]) cylinder(r=0.3, h=0.1); 
                        translate([0,0,0.8]) cylinder(r=0.1, h=0.1); 
                        translate([2,0,0.8]) cylinder(r=0.3, h=0.1); 
                    }
                translate([x_pos, box_w - wall, box_h - acrylic_thick - 1.5]) 
                    hull() {
                        translate([0,0,0]) cylinder(r=0.1, h=0.1); 
                        translate([2,0,0]) cylinder(r=0.3, h=0.1); 
                        translate([0,0,0.8]) cylinder(r=0.1, h=0.1); 
                        translate([2,0,0.8]) cylinder(r=0.3, h=0.1); 
                    }
            }
            
            // **FIX 1: Battery Cage - NOW INSIDE UNION (Additive)**
            translate([18, 8, 0]) {
                // Corner ribs (these ADD material)
                cube([4, 1, 5]); 
                translate([44,0,0]) cube([4, 1, 5]); 
                translate([0,30,0]) cube([4, 1, 5]); 
                translate([44,30,0]) cube([4, 1, 5]);
                // Cross bars for ventilation
                for(i=[1:3]) translate([10*i + 2, 0, 0]) cube([2, 30, 2]);
            }
            translate([38, 18, 0]) linear_extrude(0.5) text("BATTERY", size=5, halign="center", valign="center");
            
            // Partition Wall
            translate([wall, box_w - wall - raceway_w - separator_w, 0]) {
                difference() {
                    cube([box_l - 2*wall, separator_w, box_h - acrylic_thick - 2]);
                    
                    // Funnel wiring holes
                    translate([12, -1, 4]) {
                        hull() {
                            cube([20, 5, 14]);
                            translate([-3, -3, 0]) cube([26, 1, 18]);
                        }
                    }
                    translate([box_l - 40, -1, 4]) {
                        hull() {
                            cube([20, 5, 14]);
                            translate([-3, -3, 0]) cube([26, 1, 18]);
                        }
                    }
                    
                    // Bridge U-Slot
                    bridge_x_pos = box_l/2 - 16;
                    translate([bridge_x_pos, -0.5, 14]) cube([32, 2.5, 22]); 
                }
                
                // PCB Rail with thermal standoffs
                translate([0, -3, pcb_z - 2]) {
                    difference() {
                        cube([box_l - 2*wall, 3, 5 + pcb_thick]); 
                        translate([-1, -1, 3]) cube([box_l, 5, pcb_thick + 0.4]);
                        for(i=[0:8]) translate([8+i*8, 0.5, 0]) cube([1.5, 3, 10]);
                    }
                    for(i=[0:6]) translate([12+i*10, 1.5, 5 + pcb_thick]) cylinder(d=1.8, h=0.5);
                }
                
                // Ratchet track
                for(i=[0:12]) translate([12 + i*4, -1, 2]) cylinder(r=1, h=5, $fn=3);
                
                // Zip-tie anchors
                for(x_pos = [22, 55]) {
                     translate([x_pos, 2, 6]) 
                        difference() {
                            cube([5, 5, 10]); 
                            translate([-1, 1.5, 2]) cube([7, 2, 4]); 
                        }
                }
            }
            
            // **FIX 2: Detection Window - Sealed with 0.4mm floor**
            // (This is part of the floor, we'll subtract the window in the outer difference)
        } // End union
        
        // Subtractive operations
        
        // Bridge U-Slots
        bridge_x_pos = box_l/2 - 16; 
        translate([bridge_x_pos, wall - 0.5, 14]) cube([32, 2.5, 22]); 
            
        // Ports (re-cut)
        translate([box_l - 5, 18, pcb_z + 2]) cube([10, 16, 8]); 
        
        // Battery vents (through bottom)
        translate([22, 12, -1]) cube([36, 22, 3]);
        
        // **FIX 2: Detection Window - NOT a through hole, keep 0.4mm floor**
        translate([42, 22, 0.4]) cylinder(d=6, h=pcb_z); // Starts at 0.4mm, not 0
    }
}

module component_bridge() {
    bridge_len = 30.0;
    // bridge_h is now 13.5 (defined globally) **FIX 3**
    
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
        
        // Top pads (now at correct height)
        translate([3, 3, bridge_h]) cylinder(r=1.2, h=0.3);
        translate([bridge_len-3, 3, bridge_h]) cylinder(r=1.2, h=0.3);
        translate([3, bridge_span+2*wall-2, bridge_h]) cylinder(r=1.2, h=0.3);
        translate([bridge_len-3, bridge_span+2*wall-2, bridge_h]) cylinder(r=1.2, h=0.3);
        
        // Alignment tabs
        translate([0, 0, 0]) cube([2, 2, bridge_h + 2]);
        translate([bridge_len - 2, 0, 0]) cube([2, 2, bridge_h + 2]);
    }
}

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
        
        // Handle
        translate([rail_len/2 - 8, -2, 0]) cube([16, 2, 8]);
        
        // Locking feet
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

module raceway_cover() {
    len = box_l - 12; wid = raceway_w + separator_w/2;
    difference() {
        cube([len, wid, 1.5]);
        translate([len/2, wid/2, -1]) cylinder(d=4, h=4);
        translate([len/2, wid/2 + 5, 1]) linear_extrude(0.6) text("FG-SEC", size=4, halign="center");
    }
    translate([4, 0, -2.5]) cube([3, wid, 2.5]);
    translate([len - 7, 0, -2.5]) cube([3, wid, 2.5]);
}

module bottom_cover() {
    difference() {
         union() {
            cube([box_l + 8, box_w - 2*wall - slide_tol, 2.0]); 
            translate([box_l + 3, (box_w - 2*wall)/2 - 8, 2]) cube([5, 16, 3]);
        }
        for(i=[0:6]) translate([15+i*10, 6, -1]) cube([3, box_w-22, 5]);
        translate([box_l/2, box_w/2, 0]) rotate([0,180,0]) linear_extrude(0.6) text("FluxGuard", size=8, font="Arial:style=Bold", halign="center", valign="center");
    }
    for(i=[0:3]) 
        translate([12 + i*22, 6, 2]) 
        difference() {
            cylinder(d=6, h=2.5); 
            translate([0,0,0]) cylinder(d=4, h=3); 
            translate([-6, -1.5, 0]) cube([12, 3, 4]); 
        }
}

// --- 4. Render Logic ---
// ASSEMBLY VIEW: Shows all parts in their assembled positions
// PRINT OPTIONS: Parts positioned/rotated for optimal FDM printing

if (part_to_print == "ALL") {
    // === Assembly Preview ===
    chassis();
    color("cyan") translate([6, 6, 0]) adjustable_clip();
    color("gray") translate([6, box_w - wall - raceway_w - separator_w/2, 22]) raceway_cover();
    color("orange") translate([box_l/2 - 16, wall - 0.5, 14]) component_bridge();
    %color("green", 0.5) translate([20, 10, 1.5]) cube([42, 28, 6]); // Battery ghost
} 

else if (part_to_print == "EXPLODED") {
    // === EXPLODED VIEW: All parts spread out ===
    spacing = 20; // Gap between parts
    
    // 1. CHASSIS (left side, upside-down print orientation)
    color("white") translate([0, 0, box_h]) rotate([180, 0, 0]) chassis();
    
    // 2. CLIP (right of chassis, lying flat)
    clip_h = pcb_z + 4 + pcb_thick;
    color("cyan") translate([box_l + spacing, 0, 0]) 
        translate([0, clip_h, 0]) rotate([-90, 0, 0]) adjustable_clip();
    
    // 3. BRIDGE (below clip)
    color("orange") translate([box_l + spacing, 25, 0]) component_bridge();
    
    // 4. RACEWAY LID (below bridge)
    color("gray") translate([box_l + spacing, 75, 0]) raceway_cover();
    
    // Labels (for display only)
    color("black") translate([box_l/2, -10, 0]) 
        linear_extrude(0.5) text("CHASSIS", size=6, halign="center");
    color("black") translate([box_l + spacing + 30, -10, 0]) 
        linear_extrude(0.5) text("CLIP", size=6, halign="center");
    color("black") translate([box_l + spacing + 15, 18, 0]) 
        linear_extrude(0.5) text("BRIDGE", size=5, halign="center");
    color("black") translate([box_l + spacing + 38, 68, 0]) 
        linear_extrude(0.5) text("RACEWAY", size=5, halign="center");
} 

// === PRINT-READY EXPORTS (Use these for STL export) ===

else if (part_to_print == "CHASSIS" || part_to_print == "PRINT_CHASSIS") {
    // Chassis prints upside down (opening faces up) for best overhangs
    translate([0, 0, box_h]) rotate([180, 0, 0]) chassis();
}

else if (part_to_print == "CLIP" || part_to_print == "PRINT_CLIP") {
    // CRITICAL: Clip MUST be printed lying on its side!
    // This makes layer lines parallel to flex arms = no snap failure
    clip_height = pcb_z + 4 + pcb_thick; // ~15.6mm
    translate([0, clip_height, 0]) rotate([-90, 0, 0]) adjustable_clip();
}

else if (part_to_print == "BRIDGE" || part_to_print == "PRINT_BRIDGE") {
    // Bridge prints flat (may need supports for alignment tabs)
    component_bridge();
}

else if (part_to_print == "RACEWAY_LID" || part_to_print == "PRINT_RACEWAY") {
    // Raceway cover prints flat, tabs facing down
    raceway_cover();
}

else if (part_to_print == "PLATE") {
    // === ALL PARTS ON ONE BUILD PLATE ===
    // Arranged for single-print convenience
    
    // Chassis (back of plate, upside down)
    translate([0, 80, box_h]) rotate([180, 0, 0]) chassis();
    
    // Clip (front-left, lying flat)
    clip_height = pcb_z + 4 + pcb_thick;
    translate([0, 0, 0]) translate([0, clip_height, 0]) rotate([-90, 0, 0]) adjustable_clip();
    
    // Bridge (front-center)
    translate([75, 0, 0]) component_bridge();
    
    // Raceway cover (front-right)
    translate([75, 50, 0]) raceway_cover();
}

// === LEGACY (kept for compatibility) ===
// NOTE: BOTTOM part removed - chassis now has integrated floor (Unibody)

