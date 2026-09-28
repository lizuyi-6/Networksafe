"""人工测试世界语料的加载器（测试与集成管线的唯一入口）。

语料以 ``worlds/handcrafted/ASW-HC-NNN/{world-spec.json,expected.md}`` 为权威；
本模块只负责读它并给出**人写**的预期（从 ``expected.md`` 的表格里解析），绝不从
oracle 输出反填——否则"oracle 必须等于预期"会变成同义反复。

解析 ``expected.md`` 的表格行::

    | P1 | `read` | `safe` | `safe` | owner reads own resource |

得到 ``probe_index -> Expectation``。表格是人写的，解析器只认这个形状；形状不符
即抛 :class:`ValueError`（不猜）。
"""
from __future__ import annotations

import json
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from security_world.model import WorldSpec, validate_document

#: 语料根目录。
CORPUS_DIR = Path(__file__).resolve().parent / "handcrafted"

#: ``expected.md`` 的预期表格行。
_EXPECTATION_ROW = re.compile(
    r"^\|\s*P(?P<index>\d+)\s*\|\s*`(?P<operation>[^`]+)`\s*\|\s*`(?P<truth>[^`]+)`\s*"
    r"\|\s*`(?P<observable>[^`]+)`\s*\|\s*(?P<note>.*?)\s*\|\s*$"
)

#: 世界目录名。
_DIRECTORY_PATTERN = re.compile(r"^ASW-HC-(?P<number>\d{3})$")


@dataclass(frozen=True)
class HandcraftedWorld:
    """一个落盘的人工世界（spec + 人写预期）。"""

    directory: str
    number: int
    spec_path: Path
    expected_path: Path
    spec_document: Mapping[str, Any]
    #: ``probe_index (1-based) -> (world_truth, observable_decision, note)``
    expectations: Mapping[int, tuple[str, str, str]]

    @property
    def world_id(self) -> str:
        return str(self.spec_document["world_id"])

    @property
    def attack_family(self) -> str:
        return str(self.spec_document["attack_family"])

    @property
    def application_domain(self) -> str:
        return str(self.spec_document["application_domain"])

    @property
    def spec(self) -> WorldSpec:
        return WorldSpec.from_document(self.spec_document)

    def probes(self) -> tuple[tuple[str, Mapping[str, Any]], ...]:
        """episode 模板的 probe 动作（按 ``t_offset_ms`` 排序，确定性）。

        返回 ``(summary, binds)``；``binds`` 已把事件的 ``actor_id`` 合并进去
        （schema 的 ``binds`` 对象不含 actor，actor 是事件字段），因此它可以直接
        喂给 ``policy.Action.from_document``。
        """
        template = self.spec_document["episode_templates"][0]
        events = sorted(template["events"], key=lambda event: int(event["t_offset_ms"]))
        out: list[tuple[str, Mapping[str, Any]]] = []
        for event in events:
            binds = dict(event.get("binds") or {})
            if not binds:
                continue
            merged = {"actor": event.get("actor_id"), **binds}
            out.append((str(event.get("summary") or ""), merged))
        return tuple(out)


def _parse_expected(text: str, *, where: str) -> dict[int, tuple[str, str, str]]:
    out: dict[int, tuple[str, str, str]] = {}
    for line in text.splitlines():
        match = _EXPECTATION_ROW.match(line.strip())
        if match is None:
            continue
        index = int(match.group("index"))
        out[index] = (
            match.group("truth").strip(),
            match.group("observable").strip(),
            match.group("note").strip(),
        )
    if not out:
        raise ValueError(f"{where}: 没有解析到任何预期表格行（| P<n> | `op` | `truth` | `observable` | note |）")
    return out


def load_handcrafted(directory: Path) -> HandcraftedWorld:
    """加载一个 ``ASW-HC-NNN`` 目录。"""
    name_match = _DIRECTORY_PATTERN.match(directory.name)
    if name_match is None:
        raise ValueError(f"{directory} 不是 ASW-HC-NNN 形式的人工世界目录")
    spec_path = directory / "world-spec.json"
    expected_path = directory / "expected.md"
    if not spec_path.is_file():
        raise FileNotFoundError(f"缺少 {spec_path}")
    if not expected_path.is_file():
        raise FileNotFoundError(f"缺少 {expected_path}")
    document = json.loads(spec_path.read_text(encoding="utf-8"))
    errors = validate_document(document, "world-spec")
    if errors:
        raise ValueError(
            f"{spec_path} 未通过 world-spec.schema.json:\n  - " + "\n  - ".join(errors)
        )
    return HandcraftedWorld(
        directory=directory.name,
        number=int(name_match.group("number")),
        spec_path=spec_path,
        expected_path=expected_path,
        spec_document=document,
        expectations=_parse_expected(expected_path.read_text(encoding="utf-8"), where=str(expected_path)),
    )


def iter_handcrafted(root: Path | None = None) -> Iterator[HandcraftedWorld]:
    """按编号顺序产出全部人工世界。"""
    base = root if root is not None else CORPUS_DIR
    if not base.is_dir():
        return
    directories = sorted(
        (item for item in base.iterdir() if item.is_dir() and _DIRECTORY_PATTERN.match(item.name)),
        key=lambda item: item.name,
    )
    for directory in directories:
        yield load_handcrafted(directory)


def load_all(root: Path | None = None) -> tuple[HandcraftedWorld, ...]:
    return tuple(iter_handcrafted(root))


__all__ = [
    "CORPUS_DIR",
    "HandcraftedWorld",
    "iter_handcrafted",
    "load_all",
    "load_handcrafted",
]
