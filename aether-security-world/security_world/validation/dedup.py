"""三层去重 + 确定性语义相似度（设计 §10.4 + 本轮追加的离线语义层）。

Phase 1 必做的三层（``configs/default.json`` 的 ``leakage_control.dedup``）::

    exact        canonical json 的 sha256；**作用域为 counterfactual family 内**
    normalized   大小写/空白/URL 编码/header 顺序归一后再 hash；跨家族
    structural   AST 骨架 hash（标识符抽象成类型占位符）；跨家族

**REVISION 1 的作用域规则**：exact dedup 只在家族内进行。``observation.request
.headers`` 是 JSON object，``canonical_json(sort_keys=True)`` 抹掉键序，于是
"header 顺序"扰动既产不出不同字节、又会与 base 一起被 exact dedup 折叠——「无关
不变性」少一类可训练样本。现在 header 顺序承载到 ``rendered_text``（字符串，顺序
可保留），且去重在家族内进行、跨家族才全局去重。

第四层 **semantic**：设计 §10.4 把"嵌入相似度"列为 Phase 1 NOT IMPLEMENTED
（后端未定）。本轮按任务书要求用**确定性离线方法**实现——字符 3-gram 的
Jaccard 系数（``security_world.validation.dedup`` 内自洽，无外部模型调用、无
网络、无随机）。它只作为**审计**输出（``semantic_pairs``），默认不塌缩样本：
同一家族的 UA 扰动变体 Jaccard 高达 0.98，把它们折叠会重犯 REVISION 1 指出的错误。
阈值可由调用方下调以开启塌缩，语义层的每次塌缩都记进 ``dedup_strategy_counts``。
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import unquote

from ..model.canonical import canonical_json, stable_hash
from ..model.world import world_structural_skeleton_from_document
from .errors import ValidationError

#: 三个必做层（``configs/default.json`` 的 ``leakage_control.dedup``）。
REQUIRED_LAYERS: tuple[str, ...] = ("exact", "normalized", "structural")

#: 语义相似度的默认阈值（Jaccard ≥ 该值记为"语义重复"）。
DEFAULT_SEMANTIC_THRESHOLD = 0.95

#: 语义层的 n-gram 阶数（字符 3-gram：对渲染文本的重排/大小写稳健，且完全确定）。
NGRAM_SIZE = 3

#: 语义对的上限（防止 O(n²) 在大数据集上失控；超出只审计前 N 个）。
MAX_SEMANTIC_PAIRS = 512


@dataclass(frozen=True)
class DuplicateRecord:
    """一次去重判定（哪一层、留下谁、丢掉谁）。"""

    layer: str
    kept_id: str
    dropped_id: str
    scope: str
    digest: str = ""
    similarity: float | None = None

    @property
    def removed(self) -> bool:
        return bool(self.dropped_id)

    def to_document(self) -> dict[str, Any]:
        document: dict[str, Any] = {
            "layer": self.layer,
            "kept_id": self.kept_id,
            "dropped_id": self.dropped_id,
            "scope": self.scope,
            "digest": self.digest,
        }
        if self.similarity is not None:
            document["similarity"] = self.similarity
        return document


@dataclass(frozen=True)
class DedupReport:
    """去重结果（保留的 episode + 逐层记录 + 语义审计对）。"""

    kept: tuple[Any, ...]
    records: tuple[DuplicateRecord, ...]
    semantic_pairs: tuple[DuplicateRecord, ...] = ()
    strategy_counts: Mapping[str, int] = field(default_factory=dict)

    @property
    def removed_count(self) -> int:
        return sum(1 for record in self.records if record.removed)

    @property
    def duplicate_rate(self) -> float:
        total = len(self.kept) + self.removed_count
        return (self.removed_count / total) if total else 0.0

    def to_document(self) -> dict[str, Any]:
        return {
            "kept": len(self.kept),
            "removed": self.removed_count,
            "duplicate_rate": round(self.duplicate_rate, 6),
            "strategy_counts": dict(sorted(self.strategy_counts.items())),
            "records": [record.to_document() for record in self.records],
            "semantic_pairs": [record.to_document() for record in self.semantic_pairs],
        }


# --------------------------------------------------------------------------- #
# 主入口
# --------------------------------------------------------------------------- #
def dedup(
    episodes: Sequence[Any],
    *,
    scope: str = "counterfactual_family_id",
    semantic_threshold: float | None = None,
    collapse_semantic: bool = False,
    layers: Sequence[str] = REQUIRED_LAYERS,
) -> DedupReport:
    """三层去重（+ 语义审计）。

    ``scope`` 是 family 级去重的分组键名（设计 §10.4 的
    ``family_scoped_dedup.scope``）。``semantic_threshold`` 给出时启用语义审计；
    ``collapse_semantic=True`` 才真正按语义层塌缩样本（默认只审计）。

    ``layers`` 限定跑哪些层。**家族内只应跑 ``("exact",)``**：normalized 与
    structural 会折叠掉 UA / header 顺序 / trace id 扰动变体，而那些正是「无关
    不变性」要训练的信号（REVISION 1）。跨家族才跑全部三层。
    """
    if not isinstance(scope, str) or not scope:
        raise ValidationError("invalid_dedup_scope", "scope 必须是非空字符串（family 键名）")
    resolved_layers = tuple(str(layer) for layer in layers)
    unknown = sorted(set(resolved_layers) - set(REQUIRED_LAYERS))
    if unknown:
        raise ValidationError("unknown_dedup_layer", f"未知去重层 {unknown}；可用 {list(REQUIRED_LAYERS)}")
    items = list(episodes)
    if not items:
        return DedupReport(kept=(), records=(), semantic_pairs=(), strategy_counts={})
    families: dict[str, list[Any]] = {}
    for episode in items:
        families.setdefault(_family_of(episode, scope), []).append(episode)
    records: list[DuplicateRecord] = []
    kept: list[Any] = []
    # ---- exact：family 内 ----
    if "exact" in resolved_layers:
        for family in sorted(families):
            seen: dict[str, Any] = {}
            for episode in sorted(families[family], key=_episode_id):
                digest = exact_digest(episode)
                if digest in seen:
                    records.append(
                        DuplicateRecord(
                            "exact", _episode_id(seen[digest]), _episode_id(episode), family, digest
                        )
                    )
                    continue
                seen[digest] = episode
                kept.append(episode)
    else:
        kept = [
            episode for family in sorted(families) for episode in sorted(families[family], key=_episode_id)
        ]
    # ---- normalized + structural：**跨家族** ----
    # 同家族内的两条 normalized/structural 相同**不是**重复：UA / header 顺序 /
    # trace id 扰动变体归一后本来就相同，折叠它们等于删掉「无关不变性」的训练信号
    # （REVISION 1）。因此只有"另一个家族已经见过这个 digest"才判重。
    for layer in ("normalized", "structural"):
        if layer not in resolved_layers:
            continue
        seen: dict[str, str] = {}
        survivors: list[Any] = []
        for family in sorted(families):
            for episode in sorted(families[family], key=_episode_id):
                digest = (
                    normalized_digest(episode) if layer == "normalized" else structural_digest(episode)
                )
                owner = seen.get(digest)
                if owner is not None and owner != family:
                    records.append(
                        DuplicateRecord(
                            layer, _episode_id(_first_with_digest(families, owner, digest, layer)),
                            _episode_id(episode),
                            f"cross_family({owner})",
                            digest,
                        )
                    )
                    continue
                seen.setdefault(digest, family)
                survivors.append(episode)
        kept = survivors
    # ---- semantic：审计（默认）或塌缩 ----
    semantic_pairs = semantic_duplicate_pairs(kept, threshold=semantic_threshold or DEFAULT_SEMANTIC_THRESHOLD)
    if collapse_semantic and semantic_pairs:
        dropped = {pair.dropped_id for pair in semantic_pairs}
        kept = [episode for episode in kept if _episode_id(episode) not in dropped]
        records.extend(semantic_pairs)
    strategy_counts = {layer: 0 for layer in resolved_layers}
    strategy_counts["semantic_audited"] = len(semantic_pairs)
    for record in records:
        strategy_counts[record.layer] = strategy_counts.get(record.layer, 0) + 1
    return DedupReport(
        kept=tuple(kept),
        records=tuple(records),
        semantic_pairs=tuple(semantic_pairs),
        strategy_counts=strategy_counts,
    )


# --------------------------------------------------------------------------- #
# 三层 digest
# --------------------------------------------------------------------------- #
def exact_digest(episode: Any) -> str:
    """episode 文档的 canonical json sha256（字节级相同 ⇒ 重复）。"""
    return stable_hash(_document(episode))


def normalized_digest(episode: Any) -> str:
    """归一化后的 digest：大小写/空白/URL 编码/header 顺序。"""
    document = _document(episode)
    observation = document.get("observation") or {}
    model_visible = observation.get("model_visible") or {}
    request = dict(model_visible.get("request") or {})
    headers = request.get("headers")
    if isinstance(headers, Mapping):
        # header 键序归一：排序后重建（顺序不是语义）
        request["headers"] = {key: headers[key] for key in sorted(headers)}
    rendered = request.get("rendered_text")
    if isinstance(rendered, str):
        request["rendered_text"] = _normalize_text(rendered)
    normalized = {
        "world_id": document.get("world_id"),
        "world_family_id": document.get("world_family_id"),
        "variant_type": document.get("variant_type"),
        "action": _normalize_value(document.get("action")),
        "request": _normalize_value(request),
        "oracle": {
            "world_truth": (document.get("oracle_output") or {}).get("world_truth"),
            "observable_decision": (document.get("oracle_output") or {}).get("observable_decision"),
        },
    }
    return stable_hash(normalized)


def structural_digest(episode: Any) -> str:
    """结构骨架 digest：标识符抽象成类型占位符后的 episode 形状。

    复用 L1 的 ``world_structural_skeleton_from_document``（同一套抽象规则），
    因此"换一组资源 id 的同一场景"共享结构 digest，而"多一条策略"不共享。
    """
    document = _document(episode)
    observation = document.get("observation") or {}
    model_visible = observation.get("model_visible") or {}
    action = _abstract_ids(document.get("action") or {})
    evidence = [_abstract_ids(item) for item in (model_visible.get("evidence") or ())]
    oracle = document.get("oracle_output") or {}
    request = model_visible.get("request") or {}
    skeleton = {
        "variant_type": document.get("variant_type"),
        "action_shape": action,
        # 观测形态也进骨架：同一 (world, action) 用不同 renderer / 风格渲染出的 episode
        # 是**不同的观测**（D2：renderer 是单向投影），不是重复样本。少了这两块，
        # 结构去重会把它们整片折叠掉。
        "renderer": model_visible.get("renderer"),
        "request_shape": {
            "method": request.get("method"),
            "path": _abstract_ids(request.get("path")),
            "has_query": bool(request.get("query")),
            "has_body": request.get("body") is not None,
            "has_rendered_text": bool(request.get("rendered_text")),
        },
        "timeline_shape": [
            _abstract_ids(_event_field(item, "event_type")) for item in (document.get("timeline") or ())
        ],
        "evidence_shape": evidence,
        "invariant_partition": {
            "violated": sorted(oracle.get("violated_invariants") or ()),
            "satisfied": sorted(oracle.get("satisfied_invariants") or ()),
            "skipped": sorted(
                str(item.get("invariant_id")) for item in (oracle.get("skipped_invariants") or ())
            ),
        },
        "world_skeleton": world_structural_skeleton_from_document(_world_document(episode))
        if _world_document(episode) is not None
        else None,
    }
    return stable_hash(skeleton)


def semantic_similarity(left: Any, right: Any) -> float:
    """两个 episode 的语义相似度（字符 3-gram Jaccard，确定性、离线）。"""
    return jaccard(_ngrams(_semantic_text(left)), _ngrams(_semantic_text(right)))


def semantic_duplicate_pairs(
    episodes: Sequence[Any], *, threshold: float = DEFAULT_SEMANTIC_THRESHOLD
) -> tuple[DuplicateRecord, ...]:
    """跨家族的语义近重复对（审计用；只报前 :data:`MAX_SEMANTIC_PAIRS` 对）。"""
    items = sorted(episodes, key=_episode_id)
    texts = [_ngrams(_semantic_text(episode)) for episode in items]
    pairs: list[DuplicateRecord] = []
    for index, left in enumerate(items):
        for other_index in range(index + 1, len(items)):
            if _family_of(left, "counterfactual_family_id") == _family_of(
                items[other_index], "counterfactual_family_id"
            ):
                # 家族内的表面差异（UA / header 顺序 / trace id）是训练信号，不是重复
                continue
            similarity = jaccard(texts[index], texts[other_index])
            if similarity >= threshold:
                pairs.append(
                    DuplicateRecord(
                        layer="semantic",
                        kept_id=_episode_id(left),
                        dropped_id=_episode_id(items[other_index]),
                        scope="cross_family",
                        digest="",
                        similarity=round(similarity, 6),
                    )
                )
                if len(pairs) >= MAX_SEMANTIC_PAIRS:
                    return tuple(pairs)
    return tuple(pairs)


def jaccard(left: frozenset[str], right: frozenset[str]) -> float:
    """Jaccard 系数（两边皆空 ⇒ 0.0，不判重复）。"""
    if not left and not right:
        return 0.0
    union = left | right
    if not union:
        return 0.0
    return len(left & right) / len(union)


# --------------------------------------------------------------------------- #
# 内部助手
# --------------------------------------------------------------------------- #
_WHITESPACE = re.compile(r"\s+")
_URL_ENCODED = re.compile(r"%[0-9A-Fa-f]{2}")


def _document(episode: Any) -> dict[str, Any]:
    to_document = getattr(episode, "to_document", None)
    if callable(to_document):
        return to_document()
    if isinstance(episode, Mapping):
        return dict(episode)
    raise ValidationError(
        "episode_not_document", f"episode 必须是文档或带 to_document()，得到 {type(episode).__name__}"
    )


def _episode_id(episode: Any) -> str:
    value = getattr(episode, "episode_id", None)
    if value is None and isinstance(episode, Mapping):
        value = episode.get("episode_id")
    return str(value or "")


def _event_field(event: Any, name: str) -> Any:
    if isinstance(event, Mapping):
        return event.get(name)
    return getattr(event, name, None)


def _family_of(episode: Any, scope: str) -> str:
    value = getattr(episode, scope, None)
    if value is None and isinstance(episode, Mapping):
        value = episode.get(scope)
    return str(value or "")


def _first_with_digest(
    families: Mapping[str, Sequence[Any]], family: str, digest: str, layer: str
) -> Any:
    """某家族里第一个产生该 digest 的 episode（去重记录的 kept 方）。"""
    for episode in sorted(families.get(family, ()), key=_episode_id):
        produced = normalized_digest(episode) if layer == "normalized" else structural_digest(episode)
        if produced == digest:
            return episode
    raise ValidationError(
        "dedup_bookkeeping_broken", f"家族 {family!r} 里找不到 digest={digest[:12]} 的 episode"
    )


def _world_document(episode: Any) -> Mapping[str, Any] | None:
    world = getattr(episode, "world", None)
    if world is None:
        return None
    to_document = getattr(world, "to_document", None)
    return to_document() if callable(to_document) else None


def _normalize_text(text: str) -> str:
    """大小写/空白/URL 编码归一（header 顺序由调用方单独处理）。"""
    decoded = _URL_ENCODED.sub(lambda match: unquote(match.group(0)), text)
    return _WHITESPACE.sub(" ", decoded).strip().lower()


def _normalize_value(value: Any) -> Any:
    if isinstance(value, str):
        return _normalize_text(value)
    if isinstance(value, Mapping):
        return {str(key): _normalize_value(item) for key, item in sorted(value.items(), key=lambda kv: str(kv[0]))}
    if isinstance(value, (list, tuple)):
        return [_normalize_value(item) for item in value]
    return value


#: 实体 id 的模式（结构抽象用；与 schemas 的前缀模式同源）。
_ID_PATTERN = re.compile(r"^(ACT|RES|SES|TOK|CRED|SVC|CACHE|ROLE|WFL|WFI|EV|POL|INV|TEN)-[A-Za-z0-9][A-Za-z0-9._-]*$")


def _abstract_ids(value: Any) -> Any:
    """把实体 id 替换成类型占位符（结构骨架的抽象规则）。"""
    if isinstance(value, str):
        return _ID_PATTERN.sub(lambda match: f"<{match.group(1)}>", value)
    if isinstance(value, Mapping):
        return {str(key): _abstract_ids(item) for key, item in sorted(value.items(), key=lambda kv: str(kv[0]))}
    if isinstance(value, (list, tuple)):
        return [_abstract_ids(item) for item in value]
    return value


def _semantic_text(episode: Any) -> str:
    """语义比较用的文本：渲染请求面 + 证据投影的规范化拼接。"""
    document = _document(episode)
    observation = document.get("observation") or {}
    model_visible = observation.get("model_visible") or {}
    request = model_visible.get("request") or {}
    parts: list[str] = []
    for key in ("method", "path"):
        if request.get(key) is not None:
            parts.append(f"{key}={request[key]}")
    rendered = request.get("rendered_text")
    if isinstance(rendered, str):
        parts.append(_normalize_text(rendered))
    for item in model_visible.get("evidence") or ():
        parts.append(_normalize_text(canonical_json(item)))
    return "\n".join(parts)


def _ngrams(text: str, size: int = NGRAM_SIZE) -> frozenset[str]:
    if len(text) < size:
        return frozenset({text}) if text else frozenset()
    return frozenset(text[index : index + size] for index in range(len(text) - size + 1))


__all__ = [
    "DEFAULT_SEMANTIC_THRESHOLD",
    "MAX_SEMANTIC_PAIRS",
    "NGRAM_SIZE",
    "REQUIRED_LAYERS",
    "DedupReport",
    "DuplicateRecord",
    "dedup",
    "exact_digest",
    "jaccard",
    "normalized_digest",
    "semantic_duplicate_pairs",
    "semantic_similarity",
    "structural_digest",
]
