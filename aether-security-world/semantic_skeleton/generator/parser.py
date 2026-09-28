"""Phase 2A 的骨架批解析器（brief §31 / §40）。

两级拒绝，刻意显式：

* **帧级**——输出必须是严格的 JSONL：一行一个骨架，任何一行解码失败 ⇒ **整批**拒绝。
  没有部分打捞——一个不能完全解码的帧就是一个不能信任的帧。
* **元素级**——解得好但过不了 ``semantic-skeleton.schema.json`` 或 §17 扫描的骨架
  **单独**拒收，其余继续。Phase 1 的 ``batch_all_elements_rejected`` 大量出现就是因为
  一个坏元素拖垮整批；brief §40 明确要求改掉。

解析器**从不**修值、猜语义、丢未知键。

Phase 2B 起 production contract 传 ``reject_duplicate_ids=False``：provider 不再拥有
``skeleton_id``（契约里已删除），它自称的 id 撞车只是 provenance 事件，不是拒收理由
（brief §29）。去重只认语义指纹。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from ..skeleton import SkeletonRejected, load_skeleton
#: 帧级拒绝原因码。
FRAME_REASONS: tuple[str, ...] = (
    "frame_undecodable",
    "frame_empty",
    "frame_not_jsonl",
    "duplicate_skeleton_id",
)


@dataclass(frozen=True)
class Rejection:
    """一次拒绝（帧级或元素级）。"""

    kind: str  # "frame" | "element"
    reason: str
    detail: str
    line: int | None = None
    skeleton_id: str | None = None

    def to_document(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "reason": self.reason,
            "detail": self.detail,
            "line": self.line,
            "skeleton_id": self.skeleton_id,
        }


@dataclass
class SkeletonBatch:
    """一批骨架的解析结果。"""

    skeletons: tuple[Mapping[str, Any], ...] = ()
    rejections: tuple[Rejection, ...] = ()
    frame_rejected: bool = False
    lines: int = 0

    @property
    def ok(self) -> bool:
        return not self.frame_rejected and bool(self.skeletons)


def parse_skeleton_batch(
    text: str,
    *,
    reject_duplicate_ids: bool = True,
    schema_path: str | Path | None = None,
) -> SkeletonBatch:
    """把一段 JSONL 文本解析成一批语义骨架。

    ``reject_duplicate_ids=False``（production contract）：provider 自称 id 的撞车不再
    产生元素级拒收，只记录。``schema_path`` 指向 production schema 时按它校验。
    """
    if not isinstance(text, str) or not text.strip():
        return SkeletonBatch(frame_rejected=True, rejections=(
            Rejection("frame", "frame_empty", "provider 返回了空响应"),
        ))
    lines = text.splitlines()
    documents: list[tuple[int, Any]] = []
    frame_rejections: list[Rejection] = []
    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped:
            continue
        try:
            document = json.loads(stripped)
        except json.JSONDecodeError as exc:
            frame_rejections.append(Rejection(
                "frame", "frame_undecodable",
                f"第 {index} 行不是合法 JSON: {exc}", line=index,
            ))
            continue
        if not isinstance(document, dict):
            frame_rejections.append(Rejection(
                "frame", "frame_not_jsonl",
                f"第 {index} 行是 {type(document).__name__}，不是对象", line=index,
            ))
            continue
        documents.append((index, document))
    if frame_rejections:
        return SkeletonBatch(
            frame_rejected=True, rejections=tuple(frame_rejections), lines=len(lines)
        )
    if not documents:
        return SkeletonBatch(frame_rejected=True, rejections=(
            Rejection("frame", "frame_empty", "响应里没有任何非空行"),
        ), lines=len(lines))

    accepted: list[Mapping[str, Any]] = []
    rejections: list[Rejection] = []
    seen: set[str] = set()
    for line_number, document in documents:
        claimed = document.get("skeleton_id") or document.get("provider_claimed_id")
        skeleton_id = str(claimed or "")
        # production 契约里没有 skeleton_id：load_skeleton 会自己算出 canonical id
        # （纯函数，runner 之后算出的值一模一样）。Phase 2A 文档仍走它自己的 skeleton_id。
        try:
            load_skeleton(document, schema_path=schema_path)
        except SkeletonRejected as exc:
            rejections.append(Rejection(
                "element", "skeleton_rejected", str(exc)[:600],
                line=line_number, skeleton_id=skeleton_id or None,
            ))
            continue
        if reject_duplicate_ids and skeleton_id in seen:
            rejections.append(Rejection(
                "element", "duplicate_skeleton_id",
                f"skeleton_id {skeleton_id!r} 在本批内重复", line=line_number,
                skeleton_id=skeleton_id,
            ))
            continue
        seen.add(skeleton_id)
        accepted.append(document)
    return SkeletonBatch(
        skeletons=tuple(accepted), rejections=tuple(rejections), lines=len(lines)
    )


__all__ = [
    "FRAME_REASONS",
    "Rejection",
    "SkeletonBatch",
    "parse_skeleton_batch",
]
