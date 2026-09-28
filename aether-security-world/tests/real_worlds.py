"""真实 provider run 的 world spec 夹具助手。

重裁（revalidate）会改变 worlds/*.jsonl 里的**结论**，但 spec 本身只存在于
``worlds/raw/provider-run-001.jsonl``——因此“真实世界回归测试”的夹具来源是 raw，
不是 accepted/quarantine（结论文件随门禁演进而变，spec 不变）。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator

RAW_PATH = Path(__file__).resolve().parents[1] / "worlds" / "raw" / "provider-run-001.jsonl"


def iter_raw_worlds() -> Iterator[dict[str, Any]]:
    if not RAW_PATH.is_file():
        return
    for line in RAW_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip():
            yield json.loads(line)


def load_raw_world(world_id: str) -> dict[str, Any]:
    """按 world_id 取 raw 记录（含 ``spec_document``）；不存在即 KeyError。"""
    for record in iter_raw_worlds():
        if str(record.get("world_id")) == world_id:
            return record
    raise KeyError(f"world {world_id!r} 不在 {RAW_PATH}（raw 文件是 spec 的权威来源）")
