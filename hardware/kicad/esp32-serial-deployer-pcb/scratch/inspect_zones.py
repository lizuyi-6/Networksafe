import pcbnew
board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
print('zones', board.GetAreaCount())
for i in range(board.GetAreaCount()):
    z = board.GetArea(i)
    print(i, z.GetLayerName(), z.GetNetname())
