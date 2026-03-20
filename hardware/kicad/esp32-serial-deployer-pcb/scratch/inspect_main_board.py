import pcbnew
board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
pts = [(39.8177,25.0310),(40.6386,25.3993),(48.0739,22.3320),(53.0,22.1750),(67.0307,58.7411),(80.15,57.5)]
for x,y in pts:
    print(f"POINT {x},{y}")
    p = pcbnew.VECTOR2I_MM(x,y)
    nearby=[]
    for item in board.GetTracks():
        cls = item.GetClass()
        if cls == 'PCB_TRACK':
            a = item.GetStart(); b = item.GetEnd()
            if min(abs(a.x-p.x)+abs(a.y-p.y), abs(b.x-p.x)+abs(b.y-p.y)) <= pcbnew.FromMM(8):
                nearby.append(('TRACK', round(pcbnew.ToMM(item.GetStartX()),4), round(pcbnew.ToMM(item.GetStartY()),4), round(pcbnew.ToMM(item.GetEndX()),4), round(pcbnew.ToMM(item.GetEndY()),4), round(pcbnew.ToMM(item.GetWidth()),4), item.GetLayerName(), item.GetNetname()))
        elif cls == 'PCB_VIA':
            pos = item.GetPosition()
            if abs(pos.x-p.x)+abs(pos.y-p.y) <= pcbnew.FromMM(8):
                nearby.append(('VIA', round(pcbnew.ToMM(pos.x),4), round(pcbnew.ToMM(pos.y),4), round(pcbnew.ToMM(item.GetDrillValue()),4), item.GetNetname()))
    for row in nearby:
        print(row)
    print()
