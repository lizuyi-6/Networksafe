
import pcbnew
from pathlib import Path

board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\scratch\best_vbus_1drc\esp32-serial-deployer-pcb.kicad_pcb")

def mm(x):
    return pcbnew.FromMM(x)

def remove_matching_tracks(predicate):
    doomed = []
    for item in iter_tracks():
        if predicate(item):
            doomed.append(item)
    for item in doomed:
        board.Remove(item)

def iter_tracks():
    try:
        return list(board.GetTracks())
    except Exception:
        return list(board.Tracks())

def approx(a, b, tol=0.02):
    return abs(a - b) <= tol

def is_seg(item, sx, sy, ex, ey, layer_name):
    if item.GetClass() != "PCB_TRACK":
        return False
    s = item.GetStart()
    e = item.GetEnd()
    ax, ay = pcbnew.ToMM(s.x), pcbnew.ToMM(s.y)
    bx, by = pcbnew.ToMM(e.x), pcbnew.ToMM(e.y)
    fwd = approx(ax, sx) and approx(ay, sy) and approx(bx, ex) and approx(by, ey)
    rev = approx(ax, ex) and approx(ay, ey) and approx(bx, sx) and approx(by, sy)
    return (fwd or rev) and item.GetLayerName() == layer_name

def is_via(item, x, y):
    return item.GetClass() == "PCB_VIA" and approx(pcbnew.ToMM(item.GetPosition().x), x) and approx(pcbnew.ToMM(item.GetPosition().y), y)

remove_matching_tracks(lambda item: item.GetNetname() == "HOST_CP2102_RST_N")
remove_matching_tracks(
    lambda item:
        is_seg(item, 67.975, 42.8, 67.975, 42.2229, "B.Cu")
        or is_seg(item, 67.975, 42.2229, 66.4265, 42.2229, "B.Cu")
)

u3 = board.FindFootprintByReference("U3")
r18 = board.FindFootprintByReference("R18")

r18.SetPosition(pcbnew.VECTOR2I(mm(75.2), mm(34.8)))
r18.SetOrientationDegrees(180)
r18.SetLayer(pcbnew.B_Cu)

pad_u3_9 = u3.FindPadByNumber("9")
pad_r18_1 = r18.FindPadByNumber("1")
pad_r18_2 = r18.FindPadByNumber("2")

net_rst = board.FindNet("HOST_CP2102_RST_N")
net_3v3 = board.FindNet("3V3")

def add_track(net_item, layer, sx, sy, ex, ey, width):
    track = pcbnew.PCB_TRACK(board)
    track.SetNetCode(net_item.GetNet())
    track.SetLayer(layer)
    track.SetStart(pcbnew.VECTOR2I(mm(sx), mm(sy)))
    track.SetEnd(pcbnew.VECTOR2I(mm(ex), mm(ey)))
    track.SetWidth(mm(width))
    board.Add(track)

def add_via(net_item, x, y, start_layer=pcbnew.F_Cu, end_layer=pcbnew.B_Cu):
    via = pcbnew.PCB_VIA(board)
    via.SetNetCode(net_item.GetNet())
    via.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
    via.SetDrill(mm(0.3))
    via.SetWidth(mm(0.5))
    via.SetLayerPair(start_layer, end_layer)
    board.Add(via)

u3_9_x = pcbnew.ToMM(pad_u3_9.GetPosition().x)
u3_9_y = pcbnew.ToMM(pad_u3_9.GetPosition().y)
r18_1_x = pcbnew.ToMM(pad_r18_1.GetPosition().x)
r18_1_y = pcbnew.ToMM(pad_r18_1.GetPosition().y)
r18_2_x = pcbnew.ToMM(pad_r18_2.GetPosition().x)
r18_2_y = pcbnew.ToMM(pad_r18_2.GetPosition().y)

add_track(net_rst, pcbnew.F_Cu, u3_9_x, u3_9_y, 71.75, 36.08, 0.1)
add_track(net_rst, pcbnew.F_Cu, 71.75, 36.08, 74.2, 36.2, 0.1)
add_via(net_rst, 74.2, 36.2)
add_track(net_rst, pcbnew.B_Cu, 74.2, 36.2, 74.2, r18_2_y, 0.2)
add_track(net_rst, pcbnew.B_Cu, 74.2, r18_2_y, r18_2_x, r18_2_y, 0.2)

add_track(net_3v3, pcbnew.B_Cu, r18_1_x, r18_1_y, r18_1_x, 41.4, 0.2)
add_track(net_3v3, pcbnew.B_Cu, r18_1_x, 41.4, 66.4265, 41.4, 0.2)
add_track(net_3v3, pcbnew.B_Cu, 66.4265, 41.4, 66.4265, 42.2229, 0.2)

pcbnew.SaveBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\scratch\r18-cluster-search\esp32-serial-deployer-pcb.kicad_pcb", board)
