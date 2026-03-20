import pcbnew
from pathlib import Path

src = Path(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
out = Path(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\scratch\candidate_245.kicad_pcb")
board = pcbnew.LoadBoard(str(src))

def mm(v): return pcbnew.FromMM(v)
def pt(x,y): return pcbnew.VECTOR2I(mm(x), mm(y))
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

gnd = net('GND')

# Item 2
add_via(gnd, 40.2, 25.3)
add_track(gnd, pcbnew.B_Cu, [
    (40.2, 25.3),
    (44.5, 25.3),
    (44.5, 27.8396),
    (43.8760, 27.8396),
], 0.2)

# Item 3
add_track(gnd, pcbnew.B_Cu, [
    (60.3156, 19.0262),
    (80.0, 19.0262),
    (80.0, 23.4),
    (60.2144, 23.4),
    (60.2144, 23.9031),
], 0.2)

# Item 4
add_via(gnd, 62.9, 14.3)
add_track(gnd, pcbnew.F_Cu, [
    (61.95, 13.9375),
    (62.9, 14.3),
], 0.2)
add_track(gnd, pcbnew.B_Cu, [
    (62.9, 14.3),
    (62.9, 9.2),
    (65.9119, 9.2),
    (65.9119, 9.6690),
], 0.2)

# Item 5
add_track(gnd, pcbnew.F_Cu, [
    (72.0, 34.0),
    (74.4, 34.0),
    (74.4, 39.0),
    (65.9394, 39.0),
    (65.9394, 38.1090),
], 0.2)

pcbnew.ZONE_FILLER(board).Fill(board.Zones())
pcbnew.SaveBoard(str(out), board)
print(out)
