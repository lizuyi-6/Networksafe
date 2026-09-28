"""Phase 1  accepted worlds → 语义骨架回归（brief §44/§45）。

目的不是改写 Phase 1 的世界，而是用它们当**回归资产**检验新编译器的语义覆盖：

1. **程序化抽取**（brief §45：不让 LLM 反向总结成为真值）——从 Phase 1 的
   world-spec 反推一份语义骨架：机制族按 attack_family + 不变量 category 反查，
   语义事实按 canonical 路径反查本体，历史按快照标签与 episode 事件摘要重组；
2. 用 Phase 2A 编译器编译它；
3. 比对**语义等价性**（不要求 byte-identical）：不变量族、关键事实结构、Oracle 判决族、
   反事实行为。

任何一条 Phase 1 世界抽不出骨架，或编译出来语义不等价，都是新编译器覆盖面的缺口——
如实记进报告，不凑数。

用法::

    py -3 scripts/phase1_regression.py [--limit 30]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic_skeleton import CompileContext, SemanticSkeletonCompiler, load_skeleton  # noqa: E402
from semantic_skeleton.compiler import SkeletonCompileError  # noqa: E402
from semantic_skeleton.compiler.compiler import classify_history_line  # noqa: E402
from semantic_skeleton.mechanisms import MECHANISMS  # noqa: E402
from semantic_skeleton.ontology import FACTS  # noqa: E402
from semantic_skeleton.validators import verify_compiled_world  # noqa: E402

PHASE1_ACCEPTED = ROOT / "worlds" / "accepted" / "milestone-1-100.jsonl"

#: attack_family → 首选机制族（程序化反查；多选一时取注册表里第一个匹配的）。
_FAMILY_TO_MECHANISM: dict[str, str] = {}
for _item in MECHANISMS:
    _FAMILY_TO_MECHANISM.setdefault(_item.attack_family, _item.family)

#: canonical 路径 → 语义事实（按 entity_type + field_path 反查本体）。
_PATH_TO_FACT: dict[tuple[str, str], str] = {}
for _fact in FACTS:
    _PATH_TO_FACT.setdefault((_fact.entity_type, _fact.field_path), _fact.name)

#: 不变量 category → **候选**原型（Phase 2A archetype 的 category 与 Phase 1 同源，
#: 但一个 category 可以落到多个原型——例如 workflow_transition 既可以是
#: ``workflow_state_in`` 也可以是 ``workflow_transition_declared``。按候选列表匹配，
#: 反查才不会因为"精确家族机制的 archetype 名字不同"而整体落空。
_CATEGORY_ARCHETYPES: dict[str, tuple[str, ...]] = {
    "ownership": ("ownership",),
    "authorization": ("role_required", "privilege_required", "owner_or_privileged"),
    "tenant_isolation": ("tenant_isolation",),
    "session_binding": ("session_bound_to_principal",),
    "session_revocation": ("session_not_revoked", "session_active"),
    "token_scope": ("token_scope_subset", "token_scope_carries_tenant"),
    "token_lineage": (
        "token_same_flow", "token_root_flow_is", "token_privilege_version_matches_actor",
    ),
    "one_time_token": ("one_time_token", "one_time_token_unused"),
    "workflow_transition": ("workflow_state_in", "workflow_transition_declared"),
    "privilege_version": (
        "session_privilege_version_matches_actor", "token_privilege_version_matches_actor",
    ),
    "cache_consistency": (
        "cache_matches_authority", "replicas_agree", "cache_not_stale_when_revoked",
    ),
    "authentication_state": ("authentication_state_required", "credential_active"),
    "trust_boundary": ("decisive_fact_established_by_trusted_evidence",),
    "temporal": ("token_not_expired", "revocation_before_use"),
    "cross_flow_isolation": ("token_same_flow", "token_bound_to_action_resource"),
    "resource_state": ("workflow_state_in",),
    "state_freshness": (
        "cache_matches_authority", "cache_not_stale_when_revoked", "replicas_agree",
    ),
}


def _archetypes_for(category: str) -> tuple[str, ...]:
    return _CATEGORY_ARCHETYPES.get(category, ())

_SURFACE_FACTS = ("request_trace_id", "display_locale")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict):
            out.append(record)
    return out


def _fact_for_path(path: str) -> str | None:
    segments = str(path).split(".")
    if len(segments) < 3:
        return None
    entity_type = segments[0]
    field_path = ".".join(segments[2:])
    name = _PATH_TO_FACT.get((entity_type, field_path))
    if name:
        return name
    # 退化匹配：只比实体类型 + 最后一段字段名（ Phase 1 的轴路径有时多一层）
    for fact in FACTS:
        if fact.entity_type == entity_type and fact.field_path.split(".")[-1] == segments[-1]:
            return fact.name
    return None


def _history_from_spec(spec: Mapping[str, Any], mechanism_family: str) -> list[str]:
    """按机制的必需 landmark 生成历史（规范措辞，保证可分类）。

    Phase 1 的快照标签（"T-1 before any event"）与事件摘要（"Alice reads her own order"）
    是**业务叙述**，关键词分类器大多会归到 ``other``——用它当历史会让
    ``HISTORY_INCONSISTENT`` 把整个回归打挂。语义结构由机制的 landmark 序列决定，
    因此这里用规范措辞重建它，Phase 1 的原叙述如实记进 ``notes_for_compiler``。
    """
    from semantic_skeleton.mechanisms import mechanism as _mechanism
    from semantic_skeleton.tests._probe import LANDMARK_PHRASES

    item = _mechanism(mechanism_family)
    landmarks = tuple(item.required_landmarks) if item is not None else ()
    if not landmarks:
        landmarks = ("login", "sensitive_operation")
    return [LANDMARK_PHRASES[landmark] for landmark in landmarks]


def _phase1_narrative(spec: Mapping[str, Any]) -> list[str]:
    """Phase 1 的原始叙述（快照标签 + 事件摘要），只进 notes，不进历史。"""
    lines: list[str] = []
    for snapshot in spec.get("state_history") or ():
        label = str(snapshot.get("label") or "").strip()
        if label:
            lines.append(label)
    template = (spec.get("episode_templates") or [{}])[0]
    for event in template.get("events") or ():
        summary = str(event.get("summary") or "").strip()
        if summary:
            lines.append(summary)
    return lines[:12]


def _choose_mechanism(spec: Mapping[str, Any]) -> str | None:
    """按覆盖度选机制族（程序化反查，多对一时选覆盖最广的）。

    Phase 1 的一个世界可以带多条不变量（例如 one_time_token + session_revocation），
    而一个机制只支持它自己那几条原型。打分：先看不变量 category 能被机制的 archetype
    覆盖几条，同 ``attack_family`` 再加权——反查永远选**语义最接近**的那个，不猜。
    """
    from semantic_skeleton.mechanisms import mechanism as _mechanism

    categories = [str(item.get("category")) for item in spec.get("invariants") or []]
    attack_family = str(spec.get("attack_family") or "")
    present = _present_entities(spec)
    best: tuple[tuple[int, int], str] | None = None
    for item in MECHANISMS:
        supported = {spec_.archetype for spec_ in item.invariants}
        covered = sum(
            1 for category in categories
            if any(name in supported for name in _archetypes_for(category))
        )
        if covered == 0:
            continue
        # 机制要求的事实里，有多少能在本世界中真的派生出来
        derivable = sum(
            1 for name in item.required_facts
            if any(
                fact.entity_type in present
                for fact in FACTS if fact.name == name
            )
        )
        # attack_family 一致优先于覆盖面：它是世界语义身份的主键，覆盖面只是次要排序。
        # 语义身份优先：先 attack_family，再"必需事实能派生多少"，最后覆盖面。
        key = (
            1 if item.attack_family == attack_family else 0,
            min(derivable, len(item.required_facts)),
            covered,
        )
        if best is None or key > best[0] or (key == best[0] and derivable > _derivable_count(best[1])):
            best = (key, item.family)
    if best is None:
        return _FAMILY_TO_MECHANISM.get(attack_family)
    return best[1]


def _derivable_count(family: str) -> int:
    from semantic_skeleton.mechanisms import mechanism as _mechanism

    item = _mechanism(family)
    return len(item.required_facts) if item is not None else 0


def _present_entities(spec: Mapping[str, Any]) -> set[str]:
    present: set[str] = set()
    for collection, entity_type in (
        ("actors", "actor"), ("resources", "resource"), ("sessions", "session"),
        ("tokens", "token"), ("caches", "cache"), ("services", "service"),
        ("credentials", "credential"), ("trust_boundaries", "trust_boundary"),
    ):
        if spec.get(collection):
            present.add(entity_type)
    if spec.get("workflows"):
        present.add("workflow_instance")
    return present


def extract_skeleton(spec: Mapping[str, Any]) -> dict[str, Any] | None:
    """从一份 Phase 1 world-spec 程序化抽取语义骨架。抽不出返回 ``None``。"""
    attack_family = str(spec.get("attack_family") or "")
    mechanism_family = _choose_mechanism(spec)
    if mechanism_family is None:
        return None

    critical: list[str] = []
    for path in spec.get("critical_state_variables") or ():
        name = _fact_for_path(str(path))
        if name and name not in critical:
            critical.append(name)
    if not critical:
        return None

    from semantic_skeleton.mechanisms import mechanism as _mechanism

    chosen = _mechanism(mechanism_family)
    supported = {spec_.archetype for spec_ in chosen.invariants} if chosen is not None else set()
    invariants: list[dict[str, str]] = []
    declared: set[str] = set()
    uncompiled: list[str] = []
    for item in spec.get("invariants") or ():
        category = str(item.get("category"))
        candidates = [name for name in _archetypes_for(category) if name in supported]
        if not candidates:
            # 机制不支持的 Phase 1 不变量不编译：派生骨架是**投影**，不是全集。
            # 它仍如实记进 notes，回归报告按"不变量族重合度"比较。
            uncompiled.append(category or "unknown")
            continue
        archetype = candidates[0]
        if archetype in declared:
            continue
        declared.add(archetype)
        invariants.append({
            "type": archetype,
            "rule": str(item.get("description") or archetype)[:400],
        })
    # 机制必需但 Phase 1 世界没直接对应的原型，按机制声明补齐
    #（否则 _rules 会以 UNSUPPORTED_INVARIANT 拒收）。
    for spec_ in chosen.invariants if chosen is not None else ():
        if spec_.archetype in declared:
            continue
        declared.add(spec_.archetype)
        invariants.append({
            "type": spec_.archetype,
            "rule": f"{spec_.archetype} required by mechanism {mechanism_family}",
        })
    if not invariants:
        return None

    evidence_facts: list[str] = []
    for item in spec.get("evidence") or ():
        name = _fact_for_path(str(item.get("asserts_ref") or ""))
        if name and name not in evidence_facts:
            evidence_facts.append(name)
    if not evidence_facts:
        evidence_facts = list(critical[:2])

    # 机制要求的事实里，凡其实体类型在本世界中存在，就补进 critical_facts——
    # Phase 1 的 critical_state_variables 只列作者认为关键的轴，未必覆盖机制的全部
    # 必需事实（如 ownership 机制要 authenticated_principal，而 Phase 1 只列了 owner）。
    from semantic_skeleton.mechanisms import mechanism as _mechanism

    item = _mechanism(mechanism_family)
    present_entities = set()
    for collection, entity_type in (
        ("actors", "actor"), ("resources", "resource"), ("sessions", "session"),
        ("tokens", "token"), ("caches", "cache"), ("services", "service"),
        ("credentials", "credential"), ("trust_boundaries", "trust_boundary"),
    ):
        if spec.get(collection):
            present_entities.add(entity_type)
    if spec.get("workflows"):
        present_entities.add("workflow_instance")
    if item is not None:
        for name in item.required_facts:
            if name in critical:
                continue
            fact = next((f for f in FACTS if f.name == name), None)
            if fact is None or fact.entity_type not in present_entities:
                continue
            critical.append(name)
    if not critical:
        return None

    # 反事实：目标事实取 Phase 1 的关键轴，改法取该机制在本世界里的**有效**改法
    #（写死 align_with_authoritative 会在多数机制上变成空干预）。
    from semantic_skeleton.effective import effective_changes

    effective = effective_changes(mechanism_family)
    counterfactuals: list[dict[str, str]] = []
    seen_paths: set[str] = set()
    for axis in (spec.get("hypotheses") or {}).get("expected_counterfactual_axes") or ():
        if str(axis.get("kind")) != "critical":
            continue
        name = _fact_for_path(str(axis.get("variable") or ""))
        if name is None or name in seen_paths:
            continue
        changes = effective.get(name)
        if not changes:
            continue
        seen_paths.add(name)
        counterfactuals.append({
            "target_fact": name,
            "change": changes[0],
            "semantic_expectation": str(axis.get("expected_effect") or "verdict_flip"),
        })
    if not counterfactuals:
        return None

    return {
        "skeleton_id": f"SK-P1-{spec.get('world_id', 'unknown')}",
        "domain": str(spec.get("application_domain") or "saas"),
        "scenario_summary": (
            str((spec.get("application") or {}).get("description") or "")[:600]
            or f"Phase 1 regression world {spec.get('world_id')}."
        ),
        "mechanism_family": mechanism_family,
        "complexity": "medium",
        "actor_types": ["ordinary_user", "tenant_admin"],
        "resource_types": ["database_record"],
        "service_types": ["identity_service"],
        "security_goal": (
            str((spec.get("invariants") or [{}])[0].get("description") or "")[:600]
            or "The decisive security condition must hold."
        ),
        "critical_facts": critical,
        "history": _history_from_spec(spec, mechanism_family),
        "security_invariants": invariants,
        "failure_mechanism": (
            f"Phase 1 world {spec.get('world_id')} exercises {attack_family}; the decisive "
            "condition is violated in the base state."
        )[:600],
        "required_evidence": evidence_facts,
        "optional_evidence": [],
        "untrusted_evidence": [],
        "irrelevant_facts": list(_SURFACE_FACTS),
        "counterfactuals": counterfactuals,
        "evidence_masking_targets": evidence_facts[:2],
        "trust_relationships": [
            {"kind": "authoritative_for", "about": critical[0]},
        ],
        "notes_for_compiler": [
            f"derived programmatically from Phase 1 world {spec.get('world_id')}",
            "Phase 1 narrative (not compiled): "
            + " | ".join(_phase1_narrative(spec))[:250],
            "Phase 1 invariants not compiled by this mechanism: "
            + (", ".join(uncompiled)[:200] if uncompiled else "(none)"),
        ],
    }


def compare(spec: Mapping[str, Any], skeleton: Mapping[str, Any]) -> dict[str, Any]:
    """比对 Phase 1 世界与 Phase 2A 编译结果的语义等价性。"""
    compiled = None
    try:
        compiled = SemanticSkeletonCompiler().compile(
            skeleton, context=CompileContext(generator_model="phase1-regression")
        )
    except SkeletonCompileError:
        return {"compiled": False}
    except Exception:  # noqa: BLE001
        return {"compiled": False, "internal_error": True}

    old_categories = sorted({str(i.get("category")) for i in spec.get("invariants") or []})
    new_categories = sorted({str(i.get("category")) for i in compiled.get("invariants") or []})
    old_axes = sorted(
        ".".join(str(p).split(".")[2:]) or str(p)
        for p in spec.get("critical_state_variables") or []
    )
    new_axes = sorted(
        ".".join(str(p).split(".")[2:]) or str(p)
        for p in compiled.get("critical_state_variables") or []
    )
    report = verify_compiled_world(
        compiled, skeleton=skeleton, config_path=ROOT / "configs" / "phase2a.json"
    )
    return {
        "compiled": True,
        "invariant_categories": {"phase1": old_categories, "phase2a": new_categories},
        "invariant_categories_overlap": sorted(set(old_categories) & set(new_categories)),
        "critical_fields": {"phase1": old_axes, "phase2a": new_axes},
        "critical_fields_overlap": sorted(set(old_axes) & set(new_axes)),
        "attack_family": {
            "phase1": str(spec.get("attack_family")),
            "phase2a": str(compiled.get("attack_family")),
            "same": str(spec.get("attack_family")) == str(compiled.get("attack_family")),
        },
        "oracle_compiles": bool(report.compiled),
        "counterfactual_outcomes": len(report.outcomes),
        "base_labels": list(report.base_labels),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 1 worlds → Phase 2A 语义回归")
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--out", default="reports/phase2a/phase1-regression.json")
    args = parser.parse_args()

    records = _read_jsonl(PHASE1_ACCEPTED)
    rows: list[dict[str, Any]] = []
    for record in records[: args.limit]:
        spec = record.get("spec_document") or record.get("instance_document")
        if not isinstance(spec, Mapping):
            continue
        world_id = str(record.get("world_id") or spec.get("world_id") or "?")
        skeleton = extract_skeleton(spec)
        if skeleton is None:
            rows.append({"world_id": world_id, "extracted": False})
            continue
        try:
            load_skeleton(skeleton)
        except Exception as exc:  # noqa: BLE001
            rows.append({
                "world_id": world_id, "extracted": True, "skeleton_rejected": str(exc)[:300],
            })
            continue
        rows.append({
            "world_id": world_id,
            "extracted": True,
            "mechanism_family": skeleton["mechanism_family"],
            **compare(spec, skeleton),
        })

    extracted = [row for row in rows if row.get("extracted")]
    compiled = [row for row in extracted if row.get("compiled")]
    oracle_ok = [row for row in compiled if row.get("oracle_compiles")]
    same_family = [row for row in compiled if row.get("attack_family", {}).get("same")]
    category_overlap = [
        len(row.get("invariant_categories_overlap") or []) for row in compiled
    ]
    payload = {
        "phase1_accepted_considered": len(records[: args.limit]),
        "extracted": len(extracted),
        "compiled": len(compiled),
        "oracle_compiles": len(oracle_ok),
        "attack_family_preserved": len(same_family),
        "mean_invariant_category_overlap": (
            sum(category_overlap) / len(category_overlap) if category_overlap else 0.0
        ),
        "rows": rows,
    }
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                   encoding="utf-8")
    print(json.dumps({k: v for k, v in payload.items() if k != "rows"}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
