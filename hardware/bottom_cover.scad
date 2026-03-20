/*
 * Compatibility entrypoint for legacy automation.
 * Maps the historical BOTTOM_COVER export to the new SERVICE_DOOR part.
 */

part_to_render_override = "BOTTOM_COVER";
include <enclosure.scad>;
