import pcbnew
import os

pcb_path = "X:/repos/Networksafe/hardware/kicad/aetherguard-control-board-v2/aetherguard-control-board-v2.kicad_pcb"
dsn_path = "X:/repos/Networksafe/hardware/kicad/aetherguard-control-board-v2/aetherguard-control-board-v2.dsn"

board = pcbnew.LoadBoard(pcb_path)
print(f"Board loaded: {board.GetFileName()}")
print(f"Nets: {board.GetNetCount()}")
print(f"Footprints: {len(board.GetFootprints())}")
print(f"Tracks: {len(board.GetTracks())}")

pcbnew.ExportSpecctraDSN(board, dsn_path)
print(f"DSN exported: {dsn_path}")
print(f"DSN size: {os.path.getsize(dsn_path)} bytes")
