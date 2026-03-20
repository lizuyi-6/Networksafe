import pcbnew
board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
center = pcbnew.VECTOR2I_MM(72.0,31.0)
radius = pcbnew.FromMM(30)
for item in board.GetTracks():
    cls=item.GetClass()
    if cls=='PCB_TRACK':
        a=item.GetStart(); b=item.GetEnd()
        if min(abs(a.x-center.x)+abs(a.y-center.y), abs(b.x-center.x)+abs(b.y-center.y)) <= radius and item.GetLayerName() in ('B.Cu','In1.Cu','In2.Cu'):
            print(item.GetLayerName(), item.GetNetname(), round(pcbnew.ToMM(a.x),4), round(pcbnew.ToMM(a.y),4), round(pcbnew.ToMM(b.x),4), round(pcbnew.ToMM(b.y),4), round(pcbnew.ToMM(item.GetWidth()),4))
    elif cls=='PCB_VIA':
        pos=item.GetPosition()
        if abs(pos.x-center.x)+abs(pos.y-center.y) <= radius:
            print('VIA', item.GetNetname(), round(pcbnew.ToMM(pos.x),4), round(pcbnew.ToMM(pos.y),4), 'drill', round(pcbnew.ToMM(item.GetDrillValue()),4))
