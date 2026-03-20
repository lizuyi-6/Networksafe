import pcbnew
board = pcbnew.LoadBoard(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb")
zone = board.GetArea(0)
print(type(zone))
for name in ['Duplicate','Clone','SetLayer','GetLayerName','Outline','GetNetname','GetNetCode','SetNetCode','SetAssignedPriority','SetName','SetIsRuleArea','SetDoNotAllowCopperPour','SetDoNotAllowTracks','SetDoNotAllowVias']:
    print(name, hasattr(zone, name))
print('layer', zone.GetLayerName(), 'net', zone.GetNetname())
print('outline methods', [n for n in dir(zone.Outline()) if 'Append' in n or 'Add' in n or 'Point' in n][:40])
