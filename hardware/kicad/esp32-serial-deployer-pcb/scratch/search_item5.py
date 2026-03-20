import pcbnew
import subprocess
import re
from pathlib import Path

root = Path(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb")
board_path = root / 'esp32-serial-deployer-pcb.kicad_pcb'
search_dir = root / 'scratch' / 'item5-search'
search_dir.mkdir(parents=True, exist_ok=True)
kicad = r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe"


def mm(v): return pcbnew.FromMM(v)
def pt(x, y): return pcbnew.VECTOR2I(mm(x), mm(y))

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
    clearance = count('clearance')
    shorting = count('shorting_items')
    crossing = count('tracks_crossing')
    hole = count('hole_clearance')
    keepout = count('items_not_allowed')
    unconnected = count('unconnected_items')
    return {
        'extra_real': clearance + shorting + crossing + hole + keepout,
        'unconnected': unconnected,
        'clearance': clearance,
        'shorting': shorting,
        'crossing': crossing,
        'hole': hole,
        'keepout': keepout,
    }

results = []
xs = [70.3, 70.4, 70.5, 70.6, 70.7, 70.8]
ys = [33.0, 33.1, 33.2, 33.3, 33.4, 33.5]
ymids = [31.9, 32.0, 32.1, 32.2, 32.3, 32.4, 32.5]
for x in xs:
    for y in ys:
        for ymid in ymids:
            board = pcbnew.LoadBoard(str(board_path))
            gnd = board.FindNet('GND')
            add_via(board, gnd, x, y)
            add_track(board, gnd, pcbnew.B_Cu, [(x, y), (x, ymid), (62.2946, ymid), (62.2946, 33.9780)], 0.2)
            pcbnew.ZONE_FILLER(board).Fill(board.Zones())
            board_file = search_dir / f'item5-{x:.1f}-{y:.1f}-{ymid:.1f}.kicad_pcb'
            rpt_file = search_dir / f'item5-{x:.1f}-{y:.1f}-{ymid:.1f}.rpt'
            pcbnew.SaveBoard(str(board_file), board)
            subprocess.run([kicad, 'pcb', 'drc', str(board_file), '--output', str(rpt_file)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            text = rpt_file.read_text(encoding='utf-8', errors='ignore')
            parsed = parse_report(text)
            parsed['score'] = parsed['extra_real'] + max(0, parsed['unconnected'] - 4)
            results.append((parsed['score'], parsed['extra_real'], parsed['unconnected'], x, y, ymid, parsed))

results.sort()
for score, extra_real, unconnected, x, y, ymid, parsed in results[:20]:
    print(f'x={x:.1f} y={y:.1f} ymid={ymid:.1f} score={score} extra_real={extra_real} unconnected={unconnected} details={parsed}')
