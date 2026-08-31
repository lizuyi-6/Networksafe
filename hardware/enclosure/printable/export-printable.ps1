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

$stlPaths = $parts | ForEach-Object { "$_.stl" }
py -3 "..\validate-mesh.py" @stlPaths
py -3 ".\validate-print-bed.py"

openscad --imgsize 1400,900 --camera 170,290,850,0,0,0,1500 --projection o -o print-plate.png print-plate.scad
