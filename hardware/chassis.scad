/*
 * Compatibility entrypoint for legacy automation.
 * Maps the historical CHASSIS export to the new LOWER_CHASSIS part.
 */

part_to_render_override = "CHASSIS";
include <enclosure.scad>;
