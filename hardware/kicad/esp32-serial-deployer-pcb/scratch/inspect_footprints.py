import pcbnew
board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
for ref in ['Q1','Q2','U5','U3','U4']:
    fp = board.FindFootprintByReference(ref)
    pos = fp.GetPosition()
    print('FOOTPRINT', ref, 'at', round(pcbnew.ToMM(pos.x),4), round(pcbnew.ToMM(pos.y),4), 'angle', fp.GetOrientationDegrees())
    for pad in fp.Pads():
        p = pad.GetPosition()
        print(' ', pad.GetNumber(), round(pcbnew.ToMM(p.x),4), round(pcbnew.ToMM(p.y),4), pad.GetNetname(), round(pcbnew.ToMM(pad.GetSizeX()),4), round(pcbnew.ToMM(pad.GetSizeY()),4))
    print()
