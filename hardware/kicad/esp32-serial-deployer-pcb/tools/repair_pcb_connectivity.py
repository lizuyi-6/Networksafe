import pcbnew


BOARD_PATH = r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb"


def mm(value: float) -> int:
    return pcbnew.FromMM(value)


def point(x_mm: float, y_mm: float) -> pcbnew.VECTOR2I:
    return pcbnew.VECTOR2I(mm(x_mm), mm(y_mm))


def find_net(board: pcbnew.BOARD, net_name: str) -> pcbnew.NETINFO_ITEM:
    net = board.FindNet(net_name)
    if net is None:
        raise RuntimeError(f"Net not found: {net_name}")
    return net


def add_track(
    board: pcbnew.BOARD,
    net: pcbnew.NETINFO_ITEM,
    layer: int,
    start: tuple[float, float],
    end: tuple[float, float],
    width_mm: float,
) -> None:
    track = pcbnew.PCB_TRACK(board)
    track.SetNet(net)
    track.SetLayer(layer)
    track.SetStart(point(*start))
    track.SetEnd(point(*end))
    track.SetWidth(mm(width_mm))
    board.Add(track)


def add_path(
    board: pcbnew.BOARD,
    net: pcbnew.NETINFO_ITEM,
    layer: int,
    pts: list[tuple[float, float]],
    width_mm: float,
) -> None:
    for start, end in zip(pts, pts[1:]):
        add_track(board, net, layer, start, end, width_mm)


def add_via(
    board: pcbnew.BOARD,
    net: pcbnew.NETINFO_ITEM,
    at: tuple[float, float],
    drill_mm: float = 0.3,
    diameter_mm: float = 0.7,
) -> None:
    via = pcbnew.PCB_VIA(board)
    via.SetNet(net)
    via.SetPosition(point(*at))
    via.SetDrill(mm(drill_mm))
    via.SetWidth(mm(diameter_mm))
    via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
    board.Add(via)


def fill_zones(board: pcbnew.BOARD) -> None:
    pcbnew.ZONE_FILLER(board).Fill(board.Zones())


def repair_board() -> None:
    board = pcbnew.LoadBoard(BOARD_PATH)
    gnd = find_net(board, "GND")
    p3v3 = find_net(board, "3V3")

    # Close the last isolated 3V3 pin on the host CP2102N.
    add_track(board, p3v3, pcbnew.F_Cu, (70.75, 35.9625), (71.75, 35.9625), 0.25)

    # Local GND vias used as anchors for an explicit bottom-layer spine.
    for via_xy in (
        (6.5, 24.74),   # MCU cluster
        (27.0, 46.5),   # boot/reset cluster
        (49.0, 40.0),   # power/LDO/buzzer cluster
        (58.0, 23.0),   # service control cluster
        (67.0, 15.0),   # service USB/CP2102 cluster
        (69.0, 37.0),   # host CP2102 cluster
        (88.0, 31.0),   # host pigtail cluster
        (56.0, 54.5),   # UI buttons cluster
        (38.0, 9.0),    # power LED cluster
    ):
        add_via(board, gnd, via_xy)

    # Explicit GND connectivity for duplicated switch pads and sparse top-side islands.
    top_gnd_paths = [
        [(10.85, 50.5), (25.15, 50.5), (28.85, 50.5), (43.15, 50.5), (27.0, 50.5), (27.0, 46.5)],
        [(34.0, 39.225), (34.0, 46.5), (27.0, 46.5)],
        [(48.85, 57.5), (63.15, 57.5), (65.85, 57.5), (80.15, 57.5), (82.85, 57.5), (97.15, 57.5)],
        [(56.0, 68.0), (56.0, 57.5), (56.0, 54.5)],
        [(3.25, 24.74), (6.5, 24.74)],
        [(38.0, 6.7875), (38.0, 9.0)],
        [(38.0, 24.225), (41.8625, 26.0), (48.0, 24.225)],
        [(41.8625, 26.0), (40.0, 29.225), (44.0, 29.225), (46.9375, 37.05), (49.0, 40.0)],
        [(50.0, 22.175), (53.0, 22.175), (58.0, 23.0)],
        [(60.9375, 21.05), (58.0, 23.0), (60.9375, 25.05)],
        [(61.95, 13.9375), (67.0, 15.0)],
        [(66.0, 11.225), (67.0, 11.225), (67.0, 15.0)],
        [(68.0, 11.225), (68.0, 15.0), (67.0, 15.0)],
        [(71.0375, 13.25), (67.0, 15.0)],
        [(66.0, 29.225), (70.0375, 33.25), (69.0, 37.0)],
        [(63.55, 34.7), (66.0, 39.225), (69.0, 37.0)],
        [(85.05, 31.0625), (88.0, 31.0), (92.2, 29.25)],
        [(51.75, 9.045), (58.25, 9.045)],
        [(51.75, 9.045), (50.68, 8.13), (50.68, 3.95)],
        [(58.25, 9.045), (59.32, 8.13), (59.32, 3.95)],
    ]
    for pts in top_gnd_paths:
        add_path(board, gnd, pcbnew.F_Cu, pts, 0.25)

    # Bottom-layer spine ties the local via anchors together without relying on pours.
    bottom_gnd_paths = [
        [(38.0, 9.0), (50.68, 9.0), (50.68, 8.13)],
        [(50.68, 8.13), (50.68, 15.0), (67.0, 15.0)],
        [(67.0, 15.0), (67.0, 23.0), (58.0, 23.0)],
        [(67.0, 15.0), (67.0, 37.0), (69.0, 37.0)],
        [(69.0, 37.0), (69.0, 31.0), (88.0, 31.0)],
        [(49.0, 40.0), (49.0, 23.0), (58.0, 23.0)],
        [(49.0, 40.0), (49.0, 46.5), (27.0, 46.5)],
        [(49.0, 40.0), (49.0, 54.5), (56.0, 54.5)],
        [(27.0, 46.5), (6.5, 46.5), (6.5, 24.74)],
        [(88.0, 31.0), (90.0, 31.0), (90.0, 7.5), (86.73, 7.5)],
    ]
    for pts in bottom_gnd_paths:
        add_path(board, gnd, pcbnew.B_Cu, pts, 0.35)

    fill_zones(board)
    pcbnew.SaveBoard(BOARD_PATH, board)


if __name__ == "__main__":
    repair_board()
