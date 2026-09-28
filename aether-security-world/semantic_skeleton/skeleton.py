"""Phase 2A 的骨架装载与规范化（SkeletonNormalizer）。

职责只有三件：**解码**、**过 schema**、**执行 brief §17 的禁止字段扫描**。它不做任何
语义解释——那属于编译器。

§17 的禁止清单在这里是**结构性**落地的，不是一句提醒：

============================  ================================================
禁止项                       实现
============================  ================================================
``world_id`` / ID 形状        递归扫描所有键与字符串值，命中
                              ``^(ACT|RES|SES|TOK|WFI|WFL|CF|EV|POL|INV|SNAP|TPL|OPP|AXIS|FLOW|TEN)-``
                              即拒（``FORBIDDEN_ID_SHAPE``）
canonical fact path           命中 ``^(actor|resource|session|token|workflow|workflow_instance|cache|service|credential|role)\\.[A-Za-z0-9]``
                              即拒（``FORBIDDEN_FACT_PATH``）
policy AST / state_preconditions / resource_states / evidence IDs
                              这些键根本不在 schema 里（``additionalProperties:
                              false``），再叠加一份显式禁用键表双保险
oracle verdict / attack label / split assignment
                              显式禁用键表 + 判决词表扫描（结构化字段硬拒，
                              散文字段记录不拒——G12 才管渲染泄漏）
family / schema version hashes 64 位十六进制串即拒（``FORBIDDEN_HASH``）
generator provenance internals ``provenance`` 键禁用
============================  ================================================
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from .identity import canonical_skeleton_id, provider_claimed_id

#: ``semantic_skeleton/schemas/semantic-skeleton.schema.json``（本仓库自有契约，
#: 与 ``schemas/`` 下的 world 系列分开：Phase 2A 的冻结哈希只覆盖它自己）。
SCHEMA_PATH = Path(__file__).resolve().parents[0] / "schemas" / "semantic-skeleton.schema.json"

#: production contract 的 schema（Phase 2B brief §6/§7）：provider 不拥有任何 ID，
#: ``skeleton_id`` 已从 provider 契约里删除，只能以 provenance-only 的
#: ``provider_claimed_id`` 出现。由 ``scripts/build_production_schema.py`` 从上面那个
#: 冻结 schema 派生，Phase 2A 冻结文件本身逐字节不变。
PRODUCTION_SCHEMA_PATH = (
    Path(__file__).resolve().parents[0] / "schemas" / "production" / "semantic-skeleton.schema.json"
)

#: 显式禁用的键（大小写不敏感）：这些是程序-owned 字段，骨架里出现即拒。
FORBIDDEN_KEYS: frozenset[str] = frozenset({
    "world_id", "world_family_id", "attack_family", "attack_label", "label", "verdict",
    "expected_verdict", "hypothesized_verdict", "oracle_verdict", "world_truth",
    "observable_decision", "decision", "split", "split_assignment", "group_key",
    "resource_states", "state_preconditions", "policy_ast", "expr", "condition",
    "evidence_id", "evidence", "provenance", "schema_version", "schema_hash",
    "family_hash", "prompt_hash", "canonical_fact_path", "fact_path", "actor_id",
    "resource_id", "session_id", "token_id", "workflow_instance_id", "entity_id",
    "state_history", "current_state", "episode_templates", "policies", "invariants",
    "actors", "resources", "sessions", "tokens", "caches", "services", "workflows",
    "trust_boundaries", "credentials", "roles", "seed", "critical_state_variables",
    "irrelevant_state_variables", "hypotheses", "attack_opportunities",
    "expected_counterfactual_axes",
})

#: ID 形状（brief §17 列出的前缀全集）。用 ``search`` + 前导词边界：ID 可以出现在
#: "actor ACT-001 must be the principal" 这种句子里，而不必独占整个字符串。
_ID_RE = re.compile(
    r"\b(ACT|RES|SES|TOK|WFI|WFL|CF|EV|POL|INV|SNAP|TPL|OPP|AXIS|FLOW|TEN|SVC|CACHE|CRED|TB|ID|SINK|ROLE)-"
    r"[A-Za-z0-9]"
)

#: canonical ID 视图路径形状。同样用 ``search`` + 词边界：路径可以出现在句子里。
_PATH_RE = re.compile(
    r"\b(actor|resource|session|token|workflow_instance|cache|service|credential|role)\."
    r"[A-Za-z0-9]"
)

#: 64 位十六进制（family/schema/prompt hash）。
_HASH_RE = re.compile(r"^[0-9a-f]{64}$")

#: 判决词表（结构化字段硬拒；散文字段只记录）。
_VERDICT_WORDS: tuple[str, ...] = (
    "world_truth", "observable_decision", "insufficient_evidence", "attack",
    "unauthorized", "verdict_flip", "verdict_invariant",
)

#: 允许出现判决词的散文字段（其余字段出现即拒）。
_PROSE_FIELDS: frozenset[str] = frozenset({
    "scenario_summary", "security_goal", "failure_mechanism", "rule", "meaning",
    "why_required", "notes_for_compiler", "summary",
    # 枚举字段：取值由 schema 钉死，不属于"LLM 自己标注判决"
    "semantic_expectation", "hypothesized_verdict",
})


@dataclass(frozen=True)
class SkeletonViolation:
    """一次 §17 违规。"""

    code: str
    field: str
    detail: str

    def to_document(self) -> dict[str, str]:
        return {"code": self.code, "field": self.field, "detail": self.detail}


@dataclass(frozen=True)
class Skeleton:
    """一个通过 §17 扫描的语义骨架（原样保留文档，编译器只读它）。

    ``skeleton_id`` 是 **canonical** id。production contract 下它由程序从骨架语义内容
    派生（:mod:`semantic_skeleton.identity`）；Phase 2A 兼容路径下它退回取文档里的
    ``skeleton_id``（provider 句柄）。``provider_claimed_id`` 只是 provider 自称的值，
    只进 provenance——重复它不构成拒收理由（brief §29）。
    """

    skeleton_id: str
    document: Mapping[str, Any]
    warnings: tuple[str, ...] = ()
    provider_claimed_id: str | None = None

    def get(self, key: str, default: Any = None) -> Any:
        return self.document.get(key, default)

    def __getitem__(self, key: str) -> Any:
        return self.document[key]


@lru_cache(maxsize=None)
def _validator_for(schema_path: str) -> Draft202012Validator:
    schema = json.loads(Path(schema_path).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    registry = Registry().with_resources(
        [(schema["$id"], Resource.from_contents(schema, default_specification=DRAFT202012))]
    )
    return Draft202012Validator(schema, registry=registry)


def _validator() -> Draft202012Validator:
    """Phase 2A 默认契约的校验器（冻结行为，逐字节不变）。"""
    return _validator_for(str(SCHEMA_PATH))


def schema_violations(
    document: Mapping[str, Any], *, schema_path: str | Path | None = None
) -> tuple[SkeletonViolation, ...]:
    """过 ``semantic-skeleton.schema.json``（production 契约传 ``schema_path``）。"""
    validator = _validator_for(str(schema_path)) if schema_path is not None else _validator()
    out: list[SkeletonViolation] = []
    for error in sorted(validator.iter_errors(document), key=lambda item: list(item.absolute_path)):
        path = "/".join(str(part) for part in error.absolute_path) or "<root>"
        out.append(SkeletonViolation("schema_violation", path, error.message[:400]))
    return tuple(out)


def forbidden_violations(document: Mapping[str, Any]) -> tuple[SkeletonViolation, ...]:
    """brief §17 的禁止字段/形状扫描（递归，确定性）。"""
    out: list[SkeletonViolation] = []

    #: 作者侧句柄：brief §6 明确 ``skeleton_id`` 只是句柄（示例值就是 "TEMP"），
    #: 编译器会整体覆盖派生的 world_id。对它做 ID 形状扫描会把 ``SK-TB-004`` 这种
    #: 合法句柄误判成实体 ID（真实 smoke 抓到过）。
    HANDLE_KEYS = frozenset({"skeleton_id"})

    def walk(node: Any, path: str) -> None:
        if isinstance(node, Mapping):
            for key, value in node.items():
                key_text = str(key)
                lowered = key_text.lower()
                child = f"{path}.{key_text}" if path else key_text
                if lowered in FORBIDDEN_KEYS:
                    out.append(SkeletonViolation(
                        "forbidden_field", child,
                        f"键 {key_text!r} 是程序-owned 字段（brief §17）；语义骨架不得携带",
                    ))
                    continue
                if lowered in HANDLE_KEYS:
                    continue
                walk(value, child)
            return
        if isinstance(node, (list, tuple)):
            for index, item in enumerate(node):
                walk(item, f"{path}[{index}]")
            return
        if isinstance(node, str):
            if _ID_RE.search(node):
                out.append(SkeletonViolation(
                    "forbidden_id_shape", path,
                    f"字符串 {node[:64]!r} 是实体/证据/轴 ID 形状——ID 由编译器派生（brief §17）",
                ))
            elif _PATH_RE.search(node):
                out.append(SkeletonViolation(
                    "forbidden_fact_path", path,
                    f"字符串 {node[:64]!r} 是 canonical fact path 形状——路径由 FactPathCompiler 派生",
                ))
            elif _HASH_RE.match(node):
                out.append(SkeletonViolation(
                    "forbidden_hash", path,
                    "64 位十六进制串（family/schema/prompt hash）不得出现在骨架里",
                ))
            elif lowered_not_prose(path) and _has_verdict_word(node):
                out.append(SkeletonViolation(
                    "forbidden_verdict_vocabulary", path,
                    f"非散文字段 {path!r} 出现判决词: {node[:120]!r}",
                ))

    walk(document, "")
    return tuple(out)


def lowered_not_prose(path: str) -> bool:
    leaf = path.rsplit(".", 1)[-1].split("[", 1)[0]
    return leaf not in _PROSE_FIELDS


def _has_verdict_word(text: str) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in _VERDICT_WORDS)


def load_skeleton(
    document: Mapping[str, Any],
    *,
    schema_path: str | Path | None = None,
    canonical_id: str | None = None,
) -> Skeleton:
    """解码 + schema + §17 扫描。任何违规抛 :class:`SkeletonRejected`。

    ``canonical_id`` 给定时用它作为 :attr:`Skeleton.skeleton_id`（production contract：
    ID 由程序派生）；缺省退回文档里的 ``skeleton_id``（Phase 2A 兼容路径）。
    """
    if not isinstance(document, Mapping):
        raise SkeletonRejected((
            SkeletonViolation("schema_violation", "<root>", "骨架必须是 JSON 对象"),
        ))
    violations = schema_violations(document, schema_path=schema_path) + forbidden_violations(document)
    if violations:
        raise SkeletonRejected(violations)
    if canonical_id is not None:
        skeleton_id = str(canonical_id)
    elif "skeleton_id" in document:
        skeleton_id = str(document["skeleton_id"])
    else:
        # production 契约：文档里没有任何 provider-owned id。canonical id 由程序现算
        # （纯函数），而不是让调用方记住传——漏传就是一次身份缺失。
        skeleton_id = canonical_skeleton_id(document)
    return Skeleton(
        skeleton_id=skeleton_id,
        document=dict(document),
        provider_claimed_id=provider_claimed_id(document),
    )


def loads_skeleton(
    text: str,
    *,
    schema_path: str | Path | None = None,
    canonical_id: str | None = None,
) -> Skeleton:
    """从 JSON 文本装载（严格 RFC 8259；不修、不猜）。"""
    try:
        document = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SkeletonRejected((
            SkeletonViolation("undecodable", "<root>", f"JSON 解码失败: {exc}"),
        )) from exc
    return load_skeleton(document, schema_path=schema_path, canonical_id=canonical_id)


class SkeletonRejected(ValueError):
    """骨架被 §17 或 schema 拒收。"""

    def __init__(self, violations: tuple[SkeletonViolation, ...]) -> None:
        super().__init__("; ".join(f"{item.code}@{item.field}: {item.detail}" for item in violations))
        self.violations = violations


__all__ = [
    "FORBIDDEN_KEYS",
    "PRODUCTION_SCHEMA_PATH",
    "SCHEMA_PATH",
    "Skeleton",
    "SkeletonRejected",
    "SkeletonViolation",
    "forbidden_violations",
    "load_skeleton",
    "loads_skeleton",
    "schema_violations",
]
