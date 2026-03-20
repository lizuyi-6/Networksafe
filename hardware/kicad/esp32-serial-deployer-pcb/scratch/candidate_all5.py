import pcbnew
from pathlib import Path

src = Path(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
out = Path(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\scratch\candidate_all5.kicad_pcb")
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
p3v3 = net('3V3')

# Item 1: route CP2102N host 3V3 pad9 under the VBUS pin instead of over it.
add_track(p3v3, pcbnew.F_Cu, [
    (70.0375, 35.25),
    (71.75, 35.25),
    (71.75, 35.9625),
], 0.2)

# Item 2: connect the left GND island to the right via on a B.Cu dogleg below ESP_IO0.
add_track(gnd, pcbnew.B_Cu, [
    (38.8682, 29.3475),
    (32.8, 29.3475),
    (32.8, 26.4),
    (44.2, 26.4),
    (44.2, 27.8396),
    (43.8760, 27.8396),
], 0.2)

# Item 3: route around the OLED_SDA and 5V_SYS back-layer trunks on the far right.
add_track(gnd, pcbnew.B_Cu, [
    (60.3156, 19.0262),
    (79.3, 19.0262),
    (79.3, 23.9031),
    (60.2144, 23.9031),
], 0.2)

# Item 4: drop U5 GND through a safe via and reach the existing top-right GND via on B.Cu.
add_via(gnd, 62.8, 14.0)
add_track(gnd, pcbnew.F_Cu, [
    (61.95, 13.9375),
    (62.8, 14.0),
], 0.2)
add_track(gnd, pcbnew.B_Cu, [
    (62.8, 14.0),
    (62.8, 9.2),
    (65.9119, 9.2),
    (65.9119, 9.6690),
], 0.2)

# Item 5: tie the host-bridge GND island into the existing LED/button GND spine on F.Cu.
add_track(gnd, pcbnew.F_Cu, [
    (72.0, 34.0),
    (72.0, 34.7),
    (63.55, 34.7),
], 0.2)

pcbnew.ZONE_FILLER(board).Fill(board.Zones())
pcbnew.SaveBoard(str(out), board)
print(out)
