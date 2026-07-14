$ErrorActionPreference = "Stop"

$parts = @(
  "chassis-left",
  "chassis-right",
  "front-panel-left",
  "front-panel-right",
  "top-cover-left",
  "top-cover-right",
  "rear-din-clip"
)

foreach ($part in $parts) {
  openscad -o "$part.stl" "$part.scad"
}

openscad --imgsize 1400,900 --camera 180,235,720,0,0,0,1050 --projection o -o print-plate.png print-plate.scad
