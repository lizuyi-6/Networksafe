import pcbnew
board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
for x,y in [(48.0739,22.3320),(67.0307,58.7411),(38.8682,29.3475)]:
    p = pcbnew.VECTOR2I_MM(x,y)
    for item in board.GetTracks():
        if item.GetClass()=='PCB_VIA' and item.GetPosition()==p:
            try:
                w = item.GetWidth(pcbnew.F_Cu)
            except TypeError:
                w = 'TypeError'
            print((x,y,'drill',pcbnew.ToMM(item.GetDrillValue()),'width',pcbnew.ToMM(w) if w!='TypeError' else w,'viaType',item.GetViaType()))
