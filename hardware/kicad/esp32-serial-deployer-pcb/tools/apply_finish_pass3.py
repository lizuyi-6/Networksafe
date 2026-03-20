import pcbnew


BOARD_PATH = r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\esp32-serial-deployer-pcb.kicad_pcb"


def mm(value: float) -> int:
    return pcbnew.FromMM(value)


def point(x_mm: float, y_mm: float) -> pcbnew.VECTOR2I:
    return pcbnew.VECTOR2I(mm(x_mm), mm(y_mm))


def same_point(a: pcbnew.VECTOR2I, b: pcbnew.VECTOR2I) -> bool:
    return a.x == b.x and a.y == b.y


def net(board: pcbnew.BOARD, name: str) -> pcbnew.NETINFO_ITEM:
    item = board.FindNet(name)
    if item is None:
        raise RuntimeError(f"Net not found: {name}")
    return item


def find_track(
    board: pcbnew.BOARD,
    net_name: str,
    layer: int,
    start: tuple[float, float],
    end: tuple[float, float],
) -> pcbnew.PCB_TRACK | None:
    start_pt = point(*start)
    end_pt = point(*end)
    for item in board.GetTracks():
        if item.GetClass() != "PCB_TRACK":
            continue
        if item.GetLayer() != layer or item.GetNetname() != net_name:
            continue
        a = item.GetStart()
        b = item.GetEnd()
        if (same_point(a, start_pt) and same_point(b, end_pt)) or (
            same_point(a, end_pt) and same_point(b, start_pt)
        ):
            return item
    return None


def ensure_track(
    board: pcbnew.BOARD,
    net_item: pcbnew.NETINFO_ITEM,
    layer: int,
    start: tuple[float, float],
    end: tuple[float, float],
    width_mm: float,
) -> None:
    if find_track(board, net_item.GetNetname(), layer, start, end) is not None:
        return
    track = pcbnew.PCB_TRACK(board)
    track.SetNet(net_item)
    track.SetLayer(layer)
    track.SetStart(point(*start))
    track.SetEnd(point(*end))
    track.SetWidth(mm(width_mm))
    board.Add(track)


def find_via(
    board: pcbnew.BOARD, net_name: str, at: tuple[float, float]
) -> pcbnew.PCB_VIA | None:
    target = point(*at)
    for item in board.GetTracks():
        if item.GetClass() != "PCB_VIA":
            continue
        if item.GetNetname() != net_name:
            continue
        if same_point(item.GetPosition(), target):
            return item
    return None


def ensure_via(
    board: pcbnew.BOARD,
    net_item: pcbnew.NETINFO_ITEM,
    at: tuple[float, float],
    drill_mm: float = 0.3,
    diameter_mm: float = 0.5,
) -> None:
    if find_via(board, net_item.GetNetname(), at) is not None:
        return
    via = pcbnew.PCB_VIA(board)
    via.SetNet(net_item)
    via.SetPosition(point(*at))
    via.SetDrill(mm(drill_mm))
    via.SetWidth(mm(diameter_mm))
    via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
    board.Add(via)


def fill_zones(board: pcbnew.BOARD) -> None:
    pcbnew.ZONE_FILLER(board).Fill(board.Zones())


def main() -> None:
    board = pcbnew.LoadBoard(BOARD_PATH)
    gnd = net(board, "GND")

    # item2: U4 ground island -> existing GND via by one safe through-via and In2 spine.
    ensure_via(board, gnd, (40.4, 25.4))
    ensure_track(board, gnd, pcbnew.F_Cu, (41.2393, 26.0000), (40.4, 25.4), 0.2)
    ensure_track(board, gnd, pcbnew.In2_Cu, (40.4, 25.4), (43.8760, 27.8396), 0.2)

    # item3: close the reset-transistor ground gap on In2 between the two existing vias.
    ensure_track(board, gnd, pcbnew.In2_Cu, (60.3156, 19.0262), (60.2144, 23.9031), 0.2)

    # item5: stitch U3 ground island from the exposed pad region up to the existing top-left GND via.
    ensure_via(board, gnd, (70.75, 33.25))
    ensure_track(board, gnd, pcbnew.In2_Cu, (70.75, 33.25), (70.75, 37.2), 0.2)
    ensure_track(board, gnd, pcbnew.In2_Cu, (70.75, 37.2), (65.9394, 38.1090), 0.2)

    fill_zones(board)
    pcbnew.SaveBoard(BOARD_PATH, board)


if __name__ == "__main__":
    main()
