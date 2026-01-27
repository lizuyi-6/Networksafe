/*
 * FluxGuard Enclosure - CHASSIS (Main Body)
 * Print: Upside-down (opening faces up)
 * Supports: Optional ("Build Plate Only" if bridging is weak)
 * Dimensions: 88 x 63 x 32 mm
 */

// --- Parameters ---
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
bridge_h = 13.5;

module r_cube(x, y, z, r) {
    hull() {
        translate([r, r, 0]) cylinder(r=r, h=z);
        translate([x-r, r, 0]) cylinder(r=r, h=z);
        translate([x-r, y-r, 0]) cylinder(r=r, h=z);
        translate([r, y-r, 0]) cylinder(r=r, h=z);
    }
}

module chassis() {
    difference() {
        union() {
            difference() {
                r_cube(box_l, box_w, box_h, corn_r);
                translate([wall, wall, 1.5]) r_cube(box_l - 2*wall, box_w - 2*wall, box_h, corn_r-1);
                
                translate([-1, wall - 0.5, box_h - acrylic_thick - 1.5]) 
                    cube([box_l - 10, box_w - 2*wall + 1, acrylic_thick + 0.5]);
                translate([box_l - 12, wall - 0.5, box_h - acrylic_thick - 2.0]) 
                    cube([15, box_w - 2*wall + 1, acrylic_thick + 1.0]);
                
                translate([-1, wall - 0.5, 1.5]) cube([box_l + 2, box_w - 2*wall + 1, 2.0]);
                
                translate([box_l - 5, 18, pcb_z + 2]) cube([10, 16, 8]); 
                translate([-1, 14, 7]) cube([5, 12, 6]); 
                
                translate([12, wall, 1]) cube([8, 35, 2.5]); 
                translate([box_l - 32, wall, 1]) cube([8, 35, 2.5]);
                
                for(i = [0:5]) {
                    translate([22 + i*9, -1, 4]) cube([2.5, 5, 10]); 
                    translate([22 + i*9, box_w - 4, 4]) cube([2.5, 5, 10]);
                }
                translate([box_l/2, box_w - 0.6, box_h/2]) rotate([90, 0, 180]) 
                    linear_extrude(1.0) text("FluxGuard Pro", size=6, font="Arial:style=Bold", halign="center", valign="center");
            }
            
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
            
            for(x_pos = [10, 35, 60]) {
                translate([x_pos, wall, box_h - acrylic_thick - 1.5]) 
                    hull() {
                        cylinder(r=0.1, h=0.1); 
                        translate([2,0,0]) cylinder(r=0.3, h=0.1); 
                        translate([0,0,0.8]) cylinder(r=0.1, h=0.1); 
                        translate([2,0,0.8]) cylinder(r=0.3, h=0.1); 
                    }
                translate([x_pos, box_w - wall, box_h - acrylic_thick - 1.5]) 
                    hull() {
                        cylinder(r=0.1, h=0.1); 
                        translate([2,0,0]) cylinder(r=0.3, h=0.1); 
                        translate([0,0,0.8]) cylinder(r=0.1, h=0.1); 
                        translate([2,0,0.8]) cylinder(r=0.3, h=0.1); 
                    }
            }
            
            translate([18, 8, 0]) {
                cube([4, 1, 5]); 
                translate([44,0,0]) cube([4, 1, 5]); 
                translate([0,30,0]) cube([4, 1, 5]); 
                translate([44,30,0]) cube([4, 1, 5]);
                for(i=[1:3]) translate([10*i + 2, 0, 0]) cube([2, 30, 2]);
            }
            translate([38, 18, 0]) linear_extrude(0.5) text("BATTERY", size=5, halign="center", valign="center");
            
            translate([wall, box_w - wall - raceway_w - separator_w, 0]) {
                difference() {
                    cube([box_l - 2*wall, separator_w, box_h - acrylic_thick - 2]);
                    translate([12, -1, 4]) hull() { cube([20, 5, 14]); translate([-3, -3, 0]) cube([26, 1, 18]); }
                    translate([box_l - 40, -1, 4]) hull() { cube([20, 5, 14]); translate([-3, -3, 0]) cube([26, 1, 18]); }
                    bridge_x_pos = box_l/2 - 16;
                    translate([bridge_x_pos, -0.5, 14]) cube([32, 2.5, 22]); 
                }
                
                translate([0, -3, pcb_z - 2]) {
                    difference() {
                        cube([box_l - 2*wall, 3, 5 + pcb_thick]); 
                        translate([-1, -1, 3]) cube([box_l, 5, pcb_thick + 0.4]);
                        for(i=[0:8]) translate([8+i*8, 0.5, 0]) cube([1.5, 3, 10]);
                    }
                    for(i=[0:6]) translate([12+i*10, 1.5, 5 + pcb_thick]) cylinder(d=1.8, h=0.5);
                }
                
                for(i=[0:12]) translate([12 + i*4, -1, 2]) cylinder(r=1, h=5, $fn=3);
                
                for(x_pos = [22, 55]) {
                     translate([x_pos, 2, 6]) difference() { cube([5, 5, 10]); translate([-1, 1.5, 2]) cube([7, 2, 4]); }
                }
            }
        }
        
        bridge_x_pos = box_l/2 - 16; 
        translate([bridge_x_pos, wall - 0.5, 14]) cube([32, 2.5, 22]); 
        translate([box_l - 5, 18, pcb_z + 2]) cube([10, 16, 8]); 
        translate([22, 12, -1]) cube([36, 22, 3]);
        translate([42, 22, 0.4]) cylinder(d=6, h=pcb_z);
    }
}

// === PRINT-READY: Upside-down ===
translate([0, 0, box_h]) rotate([180, 0, 0]) chassis();
