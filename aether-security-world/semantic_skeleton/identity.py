"""Canonical identity：ID 由程序派生，provider 不参与（Phase 2B brief §6/§7）。

Phase 2A 实测过的故障驱动这个模块：Step 曾经连续三批复制旧的 ``skeleton_id``。
在那之前 ``skeleton_id`` 不只是个句柄——``WorldPlan.world_id`` / ``seed`` / 全部实体 ID
（``stable_digest(skeleton_id, family, slot)``）都由它派生。也就是说 **provider 随口写
的字符串进了 canonical 身份**：两个语义不同的骨架只要撞了同一个句柄，就会拿到同一个
world_id 和同一批实体 ID。

这里的规则因此是::

    canonical id = f(骨架语义内容)       provider 的 claimed id 只进 provenance
    provider_owned 键（skeleton_id / provider_claimed_id）在派生前被剥掉

于是：

* 同一个 frozen 骨架 ⇒ 同一个 canonical id（纯函数，跨进程、跨批次、跨 run 一致）；
* 到达顺序不影响 id（不用 ordinal——那会让"重新编译同一骨架"换身份）；
* 两个不同骨架撞 id 的概率 = sha256 碰撞，实践为零；真撞了也是程序可判定的重复，
  由 canonical-id 去重拦下，而不是靠 provider 自觉。

``IF CODE CAN DERIVE IT, DO NOT ASK THE LLM TO GENERATE IT.``
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping

#: canonical id 的派生方案名。进哈希输入：将来若派生规则本身需要改，
#: 换 scheme 名就会让全部 id 变掉，不会出现"半个 corpus 用旧规则"的混合身份。
CANONICAL_ID_SCHEME = "asw-canonical-skeleton-id/v1"

#: provider-owned 键：不得进入 canonical 身份的派生输入。
PROVIDER_OWNED_KEYS: frozenset[str] = frozenset({"skeleton_id", "provider_claimed_id"})

#: canonical id 形状（``SK-`` + 16 hex）。仅用于人读与日志，不作为合法性判据。
CANONICAL_ID_PATTERN = "^SK-[0-9a-f]{16}$"


def _canonical_json(document: Any) -> str:
    """确定性 JSON 序列化（键排序、无空白、非 ASCII 原样）。"""
    return json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def semantic_payload(document: Mapping[str, Any]) -> dict[str, Any]:
    """剥掉 provider-owned 键之后的骨架内容（canonical 身份的唯一输入）。"""
    return {str(key): value for key, value in document.items() if str(key) not in PROVIDER_OWNED_KEYS}


def canonical_document_digest(document: Mapping[str, Any]) -> str:
    """骨架语义内容的 sha256（不含任何 provider 提供的 ID）。"""
    return hashlib.sha256(_canonical_json(semantic_payload(document)).encode("utf-8")).hexdigest()


def canonical_skeleton_id(document: Mapping[str, Any]) -> str:
    """确定性 canonical skeleton id。

    纯函数：同一份 frozen 骨架永远得到同一个 id，与它是第几个被接受的、
    在哪个 run 里被接受的、provider 声称自己是谁都无关。
    """
    material = f"{CANONICAL_ID_SCHEME}\x1f{canonical_document_digest(document)}"
    return "SK-" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def provider_claimed_id(document: Mapping[str, Any]) -> str | None:
    """provider 自称的 id（只进 provenance，永不影响 canonical 身份）。

    Phase 2A 的 schema 里这个键叫 ``skeleton_id``；production schema 把它改名成
    ``provider_claimed_id`` 以让"它只是个声明"在契约层就可见。两个名字都接受，
    因为迁移期 provider 还会习惯性吐旧名字。
    """
    for key in ("provider_claimed_id", "skeleton_id"):
        value = document.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


__all__ = [
    "CANONICAL_ID_PATTERN",
    "CANONICAL_ID_SCHEME",
    "PROVIDER_OWNED_KEYS",
    "canonical_document_digest",
    "canonical_skeleton_id",
    "provider_claimed_id",
    "semantic_payload",
]
