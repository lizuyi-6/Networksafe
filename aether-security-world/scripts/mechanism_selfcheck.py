"""机制族注册表自检（brief §24 的注册期自校验，落成可执行脚本）。

对**每一个**机制族合成一个最小合法骨架，跑完整链路
``load_skeleton → compile → world-spec schema → compile_spec → expand → oracle → verify``，
任何一步不过就是注册表缺陷——在 provider 烧 token 之前发现，而不是之后。

用法::

    py -3 scripts/mechanism_selfcheck.py [--json reports/phase2a/mechanism-selfcheck.json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from generation.schema_registry import world_spec_validator  # noqa: E402
from semantic_skeleton import SemanticSkeletonCompiler, CompileContext, load_skeleton  # noqa: E402
from semantic_skeleton.compiler.errors import SkeletonCompileError  # noqa: E402
from semantic_skeleton.mechanisms import MECHANISMS, mechanism  # noqa: E402
from semantic_skeleton.tests._probe import probe_skeleton  # noqa: E402
from semantic_skeleton.validators import verify_compiled_world  # noqa: E402

def _skeleton_for(index: int, family: str) -> dict[str, Any]:
    return probe_skeleton(family, index=index)


def _unused_skeleton_for(index: int, family: str) -> dict[str, Any]:
    item = mechanism(family)
    assert item is not None
    domain = DOMAINS[index % len(DOMAINS)]
    history = [LANDMARK_PHRASES[landmark] for landmark in item.required_landmarks]
    invariants = [
        {"type": spec.archetype, "rule": f"{spec.archetype} must hold for {family}"}
        for spec in item.invariants
    ]
    evidence_facts = [spec.fact for spec in item.evidence] or list(item.required_facts)
    counterfactuals = [
        {
            "target_fact": spec.fact,
            "change": spec.changes[0],
            "semantic_expectation": (
                "verdict_invariant" if spec.changes[0] in ("change_cosmetic",) else "verdict_flip"
            ),
        }
        for spec in item.counterfactuals
    ]
    return {
        "skeleton_id": f"SK-SELFCHECK-{index:03d}",
        "domain": domain,
        "scenario_summary": (
            f"Self-check world for mechanism {family}: {item.summary}"
        ),
        "mechanism_family": family,
        "complexity": "medium",
        "actor_types": ["ordinary_user", "tenant_admin", "api_gateway"],
        "resource_types": [RESOURCE_TYPES_BY_FAMILY.get(item.category, "database_record")],
        "service_types": [SERVICE_TYPES_BY_FAMILY.get(item.category, "identity_service")],
        "security_goal": item.summary,
        "critical_facts": list(item.required_facts),
        "history": history,
        "security_invariants": invariants,
        "failure_mechanism": item.summary,
        "required_evidence": list(dict.fromkeys(evidence_facts)),
        "optional_evidence": [],
        "untrusted_evidence": [
            spec.fact for spec in item.evidence if spec.trust in ("untrusted", "derived")
        ],
        "irrelevant_facts": ["request_trace_id", "display_locale"],
        "counterfactuals": counterfactuals,
        "evidence_masking_targets": list(dict.fromkeys(evidence_facts))[:2],
        "trust_relationships": [
            {"kind": "authoritative_for", "about": item.required_facts[0]},
        ],
        "notes_for_compiler": [],
    }


def check(index: int, family: str) -> dict[str, Any]:
    row: dict[str, Any] = {"family": family, "stage": "skeleton"}
    document = _skeleton_for(index, family)
    try:
        skeleton = load_skeleton(document)
    except Exception as exc:
        row.update(ok=False, error=f"{type(exc).__name__}: {exc}"[:400])
        return row
    row["stage"] = "compile"
    try:
        result = SemanticSkeletonCompiler().compile_with_plan(
            skeleton.document, context=CompileContext()
        )
    except SkeletonCompileError as exc:
        row.update(ok=False, error=f"{exc.failure.code}: {exc.failure.detail}"[:400])
        return row
    except Exception as exc:  # pragma: no cover - 未登记失败码即编译器 bug
        row.update(ok=False, error=f"INTERNAL_COMPILER_ERROR: {type(exc).__name__}: {exc}"[:400])
        return row
    spec = result.spec
    row["stage"] = "schema"
    errors = list(world_spec_validator().iter_errors(spec))
    if errors:
        row.update(
            ok=False,
            error="; ".join(
                f"{'/'.join(str(p) for p in e.absolute_path)}: {e.message[:160]}"
                for e in errors[:3]
            )[:400],
        )
        return row
    row["stage"] = "verify"
    report = verify_compiled_world(
        spec, skeleton=skeleton.document, plan=result.plan,
        config_path=ROOT / "configs" / "phase2a.json",
    )
    row.update(
        ok=bool(report.ok and report.outcomes),
        world_id=report.world_id,
        attack_family=report.attack_family,
        probes=report.probes,
        episodes=report.episodes,
        base_labels=list(report.base_labels),
        axes=len(report.outcomes),
        contradictions=len(report.contradictions),
        error=report.error_detail[:300] if report.error_code else "",
    )
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description="机制族注册表自检")
    parser.add_argument("--json", default="reports/phase2a/mechanism-selfcheck.json")
    args = parser.parse_args()
    rows = [check(index, family) for index, family in enumerate(
        sorted(item.family for item in MECHANISMS)
    )]
    failures = [row for row in rows if not row.get("ok")]
    payload = {
        "mechanisms": len(rows),
        "passed": len(rows) - len(failures),
        "failed": len(failures),
        "rows": rows,
    }
    out = ROOT / args.json
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                   encoding="utf-8")
    print(f"mechanisms={payload['mechanisms']} passed={payload['passed']} failed={payload['failed']}")
    for row in failures:
        print(f"  FAIL {row['family']} @{row['stage']}: {row.get('error', '')}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
