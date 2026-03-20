import pcbnew
import subprocess
import re
from pathlib import Path

root = Path(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb")
board_path = root / 'esp32-serial-deployer-pcb.kicad_pcb'
search_dir = root / 'scratch' / 'item4-search'
search_dir.mkdir(parents=True, exist_ok=True)
kicad = r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe"

BASE_DRILL = 12
BASE_LIB = 2
BASE_UNCONNECTED = 5


def mm(v):
    return pcbnew.FromMM(v)


def pt(x, y):
    return pcbnew.VECTOR2I(mm(x), mm(y))


def add_track(board, net_item, layer, pts, width=0.2):
    for a, b in zip(pts, pts[1:]):
        t = pcbnew.PCB_TRACK(board)
        t.SetNet(net_item)
        t.SetLayer(layer)
        t.SetStart(pt(*a))
        t.SetEnd(pt(*b))
        t.SetWidth(mm(width))
        board.Add(t)


def add_via(board, net_item, x, y, drill=0.3, dia=0.6):
    v = pcbnew.PCB_VIA(board)
    v.SetNet(net_item)
    v.SetPosition(pt(x, y))
    v.SetDrill(mm(drill))
    v.SetWidth(mm(dia))
    v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
    board.Add(v)


def parse_report(text: str):
    def count(tag):
        return len(re.findall(rf'^\[{re.escape(tag)}\]:', text, flags=re.M))
    total_unconnected = count('unconnected_items')
    drill = count('drill_out_of_range')
    lib = count('lib_footprint_issues')
    clearance = count('clearance')
    shorting = count('shorting_items')
    crossing = count('tracks_crossing')
    hole = count('hole_clearance')
    items_not_allowed = count('items_not_allowed')
    return {
        'unconnected': total_unconnected,
        'drill': drill,
        'lib': lib,
        'clearance': clearance,
        'shorting': shorting,
        'crossing': crossing,
        'hole': hole,
        'keepout': items_not_allowed,
        'extra_real': clearance + shorting + crossing + hole + items_not_allowed,
    }

results = []
for x in [round(v, 1) for v in [61.9, 62.0, 62.1, 62.2, 62.3, 62.4, 62.5, 62.6, 62.7]]:
    for y in [round(v, 1) for v in [14.0, 14.1, 14.2, 14.3, 14.4, 14.5]]:
        board = pcbnew.LoadBoard(str(board_path))
        gnd = board.FindNet('GND')
        add_via(board, gnd, x, y)
        add_track(board, gnd, pcbnew.F_Cu, [(61.95, 13.9375), (x, y)], 0.2)
        add_track(board, gnd, pcbnew.B_Cu, [(x, y), (x, 9.2), (65.9119, 9.2), (65.9119, 9.6690)], 0.2)
        pcbnew.ZONE_FILLER(board).Fill(board.Zones())
        board_file = search_dir / f'item4-{x:.1f}-{y:.1f}.kicad_pcb'
        rpt_file = search_dir / f'item4-{x:.1f}-{y:.1f}.rpt'
        pcbnew.SaveBoard(str(board_file), board)
        subprocess.run([kicad, 'pcb', 'drc', str(board_file), '--output', str(rpt_file)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        text = rpt_file.read_text(encoding='utf-8', errors='ignore')
        parsed = parse_report(text)
        # normalize out the known scratch-only noise
        parsed['net_score'] = parsed['extra_real'] + max(0, parsed['unconnected'] - 4)
        results.append((parsed['net_score'], parsed['extra_real'], parsed['unconnected'], x, y, parsed))

results.sort()
for score, extra_real, unconnected, x, y, parsed in results[:15]:
    print(f'x={x:.1f} y={y:.1f} score={score} extra_real={extra_real} unconnected={unconnected} details={parsed}')
