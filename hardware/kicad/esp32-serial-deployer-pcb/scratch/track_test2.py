from __future__ import annotations
import pcbnew
board = pcbnew.LoadBoard(r'X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\scratch\best_vbus_1drc\esp32-serial-deployer-pcb.kicad_pcb')
print(type(board.GetTracks()))
print(len(list(board.GetTracks())))
