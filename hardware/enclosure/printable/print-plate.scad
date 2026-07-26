// Non-manufacturing layout preview for the printable split enclosure.
// Use individual STL exports for actual slicing.

include <printable-common.scad>
use <chassis-left.scad>
use <chassis-right.scad>
use <front-panel-left.scad>
use <front-panel-right.scad>
use <top-cover-left.scad>
use <top-cover-right.scad>

$fn = 48;

translate([0, 0, 0])
    color("lightgray") printable_chassis_left();

translate([175, 0, 0])
    color("lightgray") printable_chassis_right();

translate([0, 245, 0])
    color("lightsteelblue") printable_top_cover_left();

translate([175, 245, 0])
    color("lightsteelblue") printable_top_cover_right();

translate([0, 480, 0])
    color("slategray") printable_front_panel_left();

translate([175, 480, 0])
    color("slategray") printable_front_panel_right();
