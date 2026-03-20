import pcbnew
board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
queries = [
    (71.7500,35.9625,'U3 3V3'),
    (41.2393,26.0000,'U4 GND gap'),
    (60.9375,19.6481,'mid GND gap'),
    (61.9500,13.9375,'U5 GND gap'),
    (70.0375,33.2500,'U3 host GND gap'),
]
radius = pcbnew.FromMM(6)
for x,y,label in queries:
    center = pcbnew.VECTOR2I_MM(x,y)
    print('='*80)
    print(label, x, y)
    print('PADS')
    for pad in board.GetPads():
        pos = pad.GetPosition()
        if abs(pos.x-center.x)+abs(pos.y-center.y) <= radius:
            print(' PAD', pad.GetParentAsString(), 'pad', pad.GetNumber(), 'at', round(pcbnew.ToMM(pos.x),4), round(pcbnew.ToMM(pos.y),4), 'layer', pad.GetLayerSet().CuStack(), 'net', pad.GetNetname(), 'size', round(pcbnew.ToMM(pad.GetSizeX()),4), round(pcbnew.ToMM(pad.GetSizeY()),4))
    print('TRACKS/VIAS')
    for item in board.GetTracks():
        cls = item.GetClass()
        if cls == 'PCB_TRACK':
            a = item.GetStart(); b = item.GetEnd()
            if min(abs(a.x-center.x)+abs(a.y-center.y), abs(b.x-center.x)+abs(b.y-center.y)) <= radius:
                print(' TRACK', round(pcbnew.ToMM(a.x),4), round(pcbnew.ToMM(a.y),4), '->', round(pcbnew.ToMM(b.x),4), round(pcbnew.ToMM(b.y),4), item.GetLayerName(), item.GetNetname(), 'w', round(pcbnew.ToMM(item.GetWidth()),4))
        elif cls == 'PCB_VIA':
            pos = item.GetPosition()
            if abs(pos.x-center.x)+abs(pos.y-center.y) <= radius:
                print(' VIA', round(pcbnew.ToMM(pos.x),4), round(pcbnew.ToMM(pos.y),4), 'net', item.GetNetname(), 'drill', round(pcbnew.ToMM(item.GetDrillValue()),4))
    print()
