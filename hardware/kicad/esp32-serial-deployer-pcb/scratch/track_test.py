import pcbnew
board = pcbnew.LoadBoard(r'X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\scratch\best_vbus_1drc\esp32-serial-deployer-pcb.kicad_pcb')
print(type(board.Tracks()))
print(type(board.GetTracks()))
print(hasattr(board.Tracks(),'__iter__'))
try:
    xs = list(board.Tracks())
    print('tracks iterable', len(xs))
except Exception as e:
    print('tracks fail', e)
try:
    xs = list(board.GetTracks())
    print('gettracks iterable', len(xs))
except Exception as e:
    print('gettracks fail', e)
