import pcbnew
board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
for x,y in [(39.8177,25.0310),(40.6386,25.3993),(53.0,22.1750),(80.15,57.5)]:
    p = pcbnew.VECTOR2I_MM(x,y)
    print('POINT', x, y)
    for item in board.GetTracks():
        cls = item.GetClass()
        if cls == 'PCB_TRACK':
            a = item.GetStart(); b = item.GetEnd()
            if ((a == p) or (b == p)):
                print(' TRACK', round(pcbnew.ToMM(a.x),4), round(pcbnew.ToMM(a.y),4), '->', round(pcbnew.ToMM(b.x),4), round(pcbnew.ToMM(b.y),4), item.GetLayerName(), item.GetNetname())
        elif cls == 'PCB_VIA':
            pos = item.GetPosition()
            if pos == p:
                print(' VIA', round(pcbnew.ToMM(pos.x),4), round(pcbnew.ToMM(pos.y),4), 'drill', round(pcbnew.ToMM(item.GetDrillValue()),4), 'net', item.GetNetname())
    print()
