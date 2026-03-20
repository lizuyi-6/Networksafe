import pcbnew
board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
out = r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\scratch\freerouting-headless\retry-main-5left.dsn"
pcbnew.ExportSpecctraDSN(board, out)
print(out)
