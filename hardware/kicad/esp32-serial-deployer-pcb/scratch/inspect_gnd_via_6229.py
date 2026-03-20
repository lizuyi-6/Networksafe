import pcbnew
board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
center = pcbnew.VECTOR2I_MM(62.2946,33.978)
radius = pcbnew.FromMM(12)
for item in board.GetTracks():
    cls=item.GetClass()
    if cls=='PCB_TRACK':
        a=item.GetStart(); b=item.GetEnd()
        if min(abs(a.x-center.x)+abs(a.y-center.y), abs(b.x-center.x)+abs(b.y-center.y)) <= radius:
            print(item.GetLayerName(), item.GetNetname(), round(pcbnew.ToMM(a.x),4), round(pcbnew.ToMM(a.y),4), round(pcbnew.ToMM(b.x),4), round(pcbnew.ToMM(b.y),4), round(pcbnew.ToMM(item.GetWidth()),4))
    elif cls=='PCB_VIA':
        pos=item.GetPosition()
        if abs(pos.x-center.x)+abs(pos.y-center.y) <= radius:
            print('VIA', item.GetNetname(), round(pcbnew.ToMM(pos.x),4), round(pcbnew.ToMM(pos.y),4), 'drill', round(pcbnew.ToMM(item.GetDrillValue()),4))
