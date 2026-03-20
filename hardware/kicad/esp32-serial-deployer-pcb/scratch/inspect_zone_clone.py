import pcbnew
board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
zone = board.GetArea(0)
for meth in ['Clone','Duplicate']:
    obj = getattr(zone, meth)()
    print(meth, type(obj), obj.GetClass())
print([n for n in dir(pcbnew) if 'ZONE' in n and 'Cast' in n][:20])
print([n for n in dir(pcbnew) if 'Cast_to' in n and 'ZONE' in n][:20])
