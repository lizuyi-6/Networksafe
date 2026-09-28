"""Phase 2A 的**语义指纹**（brief §28）：骨架级结构重复检测。

Phase 1 的结构签名剥掉行业名/实体名后比较骨架，但它比的是**编译后**的形状；Phase 2A
在**骨架级**就做，而且比的是语义结构：::

    mechanism_family + critical_fact_types + history topology
    + invariant types + evidence dependency + trust structure + counterfactual pattern

刻意**不计入**：domain、actor 名、resource 名、装饰性措辞。因此两个只换了业务名的骨架
会拿到同一个指纹——那是语义近重复，进 quarantine，不是 accepted 多样性。

指纹本身是确定性纯函数：同一骨架 ⇒ 同一指纹；换业务名 ⇒ 同一指纹（这正是要点）。
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping, Sequence

from .compiler.compiler import classify_history_line
from .ontology import semantic_fact

#: 计入指纹的语义事实属性（"换了字段名但同一类事实"仍算重复）。
_FACT_STRUCTURE_KEYS = ("group", "entity_type", "value_kind")


def _canonical(document: Any) -> str:
    return json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def fact_structure(fact_name: str) -> dict[str, str]:
    """一个语义事实的**结构签名**（名字本身不计入——那正是要剥掉的 cosmetic）。"""
    fact = semantic_fact(fact_name)
    if fact is None:
        return {"unknown": fact_name}
    return {
        "group": fact.group,
        "entity_type": fact.entity_type,
        "value_kind": fact.value_kind,
    }


def history_topology(history: Sequence[Any]) -> list[str]:
    """历史的**事件类型拓扑**（分类后的 landmark 序列；叙述文本不计入）。"""
    return [classify_history_line(str(line)) for line in history]


def trust_structure(trust_relationships: Sequence[Any]) -> list[dict[str, str]]:
    """信任结构的形状（kind + about 的结构，不含具体名字）。"""
    out: list[dict[str, str]] = []
    for item in trust_relationships:
        if isinstance(item, Mapping):
            kind = str(item.get("kind") or "")
            about = str(item.get("about") or "")
            structure = fact_structure(about) if semantic_fact(about) is not None else {"name": about}
            out.append({"kind": kind, **structure})
        else:
            out.append({"kind": str(item)})
    return sorted(out, key=lambda row: _canonical(row))


def counterfactual_pattern(counterfactuals: Sequence[Any]) -> list[dict[str, str]]:
    """反事实模式：改哪个**结构**上的事实、用什么改法、期望什么。"""
    out: list[dict[str, str]] = []
    for item in counterfactuals:
        if not isinstance(item, Mapping):
            continue
        target = str(item.get("target_fact") or "")
        out.append({
            **fact_structure(target),
            "change": str(item.get("change") or ""),
            "expectation": str(item.get("semantic_expectation") or ""),
        })
    return sorted(out, key=lambda row: _canonical(row))


def evidence_dependency(
    required: Sequence[Any],
    optional: Sequence[Any],
    untrusted: Sequence[Any],
    masking_targets: Sequence[Any],
) -> dict[str, Any]:
    """证据依赖的形状（哪些结构的事实必须/可以/不可信/可被掩蔽）。"""
    def structure(names: Sequence[Any]) -> list[dict[str, str]]:
        return sorted(
            (fact_structure(str(name)) for name in names),
            key=lambda row: _canonical(row),
        )

    return {
        "required": structure(required),
        "optional": structure(optional),
        "untrusted": structure(untrusted),
        "masking": structure(masking_targets),
    }


def semantic_fingerprint(skeleton: Mapping[str, Any]) -> str:
    """一个语义骨架的指纹（sha256，确定性）。"""
    signature = {
        "mechanism_family": str(skeleton.get("mechanism_family") or ""),
        "critical_facts": sorted(
            (_canonical(fact_structure(str(name))) for name in skeleton.get("critical_facts") or ()),
        ),
        "history_topology": history_topology(skeleton.get("history") or ()),
        "invariant_types": sorted(
            str((item or {}).get("type") if isinstance(item, Mapping) else item)
            for item in skeleton.get("security_invariants") or ()
        ),
        "evidence_dependency": evidence_dependency(
            skeleton.get("required_evidence") or (),
            skeleton.get("optional_evidence") or (),
            skeleton.get("untrusted_evidence") or (),
            skeleton.get("evidence_masking_targets") or (),
        ),
        "trust_structure": trust_structure(skeleton.get("trust_relationships") or ()),
        "counterfactual_pattern": counterfactual_pattern(skeleton.get("counterfactuals") or ()),
        # 实体开槽的**形状**（几个 actor / 几个资源 / 有没有 session/token/cache），
        # 不计入具体类型名——同形不同名仍是近重复。
        "entity_shape": {
            "actor_types": len(skeleton.get("actor_types") or ()),
            "resource_types": len(skeleton.get("resource_types") or ()),
            "service_types": len(skeleton.get("service_types") or ()),
        },
    }
    return hashlib.sha256(_canonical(signature).encode("utf-8")).hexdigest()


def fingerprint_similarity(left: Mapping[str, Any], right: Mapping[str, Any]) -> float:
    """两个骨架指纹相同分量的比例（0..1；1.0 = 完全同构）。"""
    keys = (
        "mechanism_family", "critical_facts", "history_topology", "invariant_types",
        "evidence_dependency", "trust_structure", "counterfactual_pattern", "entity_shape",
    )
    from .fingerprint import _components  # 局部导入避免循环

    a, b = _components(left), _components(right)
    matched = sum(1 for key in keys if _canonical(a[key]) == _canonical(b[key]))
    return matched / len(keys)


def _components(skeleton: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "mechanism_family": str(skeleton.get("mechanism_family") or ""),
        "critical_facts": sorted(
            (_canonical(fact_structure(str(name))) for name in skeleton.get("critical_facts") or ()),
        ),
        "history_topology": history_topology(skeleton.get("history") or ()),
        "invariant_types": sorted(
            str((item or {}).get("type") if isinstance(item, Mapping) else item)
            for item in skeleton.get("security_invariants") or ()
        ),
        "evidence_dependency": evidence_dependency(
            skeleton.get("required_evidence") or (),
            skeleton.get("optional_evidence") or (),
            skeleton.get("untrusted_evidence") or (),
            skeleton.get("evidence_masking_targets") or (),
        ),
        "trust_structure": trust_structure(skeleton.get("trust_relationships") or ()),
        "counterfactual_pattern": counterfactual_pattern(skeleton.get("counterfactuals") or ()),
        "entity_shape": {
            "actor_types": len(skeleton.get("actor_types") or ()),
            "resource_types": len(skeleton.get("resource_types") or ()),
            "service_types": len(skeleton.get("service_types") or ()),
        },
    }


__all__ = [
    "counterfactual_pattern",
    "evidence_dependency",
    "fact_structure",
    "fingerprint_similarity",
    "history_topology",
    "semantic_fingerprint",
    "trust_structure",
]
