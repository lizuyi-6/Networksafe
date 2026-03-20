/*
 * Compatibility entrypoint for legacy automation.
 * Maps the historical TOP_PLATE export to the new UPPER_BEZEL part.
 */

part_to_render_override = "TOP_PLATE";
include <enclosure.scad>;
