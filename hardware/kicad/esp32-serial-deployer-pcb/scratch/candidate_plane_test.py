import pcbnew
from pathlib import Path

src = Path(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
out = Path(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\scratch\candidate_plane_test.kicad_pcb")
board = pcbnew.LoadBoard(str(src))

def mm(v):
    return pcbnew.FromMM(v)

def pt(x,y):
    return pcbnew.VECTOR2I(mm(x), mm(y))

def net(name):
    n = board.FindNet(name)
    if n is None:
        raise RuntimeError(name)
    return n

def add_track(net_item, layer, pts, width=0.2):
    for a,b in zip(pts, pts[1:]):
        t = pcbnew.PCB_TRACK(board)
        t.SetNet(net_item)
        t.SetLayer(layer)
        t.SetStart(pt(*a))
        t.SetEnd(pt(*b))
        t.SetWidth(mm(width))
        board.Add(t)

def add_via(net_item, x, y, drill=0.3, dia=0.6):
    v = pcbnew.PCB_VIA(board)
    v.SetNet(net_item)
    v.SetPosition(pt(x,y))
    v.SetDrill(mm(drill))
    v.SetWidth(mm(dia))
    v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
    board.Add(v)

zone = board.GetArea(0).Duplicate()
zone.SetLayer(pcbnew.In1_Cu)
board.Add(zone)

gnd = net('GND')
p3v3 = net('3V3')

add_via(gnd, 41.2393, 26.0000)
add_via(gnd, 63.0000, 13.3000)
add_via(gnd, 72.0000, 34.0000)
add_track(p3v3, pcbnew.F_Cu, [
    (70.7500, 35.9625),
    (70.7500, 37.2500),
    (71.7500, 37.2500),
    (71.7500, 35.9625),
], 0.2)

pcbnew.ZONE_FILLER(board).Fill(board.Zones())
pcbnew.SaveBoard(str(out), board)
print(out)
