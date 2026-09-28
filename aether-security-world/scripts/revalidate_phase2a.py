"""把已 accepted 的语义骨架用**当前**编译器重编译（brief §44 的重裁模式）。

为什么需要：编译器在 v0.6 修了一个 G12 泄漏（机制族名/attack_family 泄进
``episode_templates[].events[].summary``，而 summary 进 model_visible）。修的是渲染面，
不动 Oracle 判决；但已 accepted 的世界是按旧编译器产出的，审计会在同一处报 144 个泄漏。

做法与 Phase 1 的 ``revalidate.py`` 同构：**raw 源文件是唯一真源**，用当前合同重裁，
产物写新目录，旧产物不覆盖。每个世界记录：

* 重编译是否成功、失败码；
* Oracle 复核是否通过、先验是否矛盾；
* 与旧编译产出的语义差异（不变量族 / 关键轴 / 判决族 / 反事实行为）。

用法::

    py -3 scripts/revalidate_phase2a.py [--source <accepted jsonl>]
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
from semantic_skeleton import CompileContext, SemanticSkeletonCompiler  # noqa: E402
from semantic_skeleton.compiler import SkeletonCompileError  # noqa: E402
from semantic_skeleton.fingerprint import semantic_fingerprint  # noqa: E402
from semantic_skeleton.validators import verify_compiled_world  # noqa: E402

PHASE2A_CONFIG = ROOT / "configs" / "phase2a.json"


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


def _semantic_shape(spec: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "attack_family": spec.get("attack_family"),
        "invariant_categories": sorted(
            str(item.get("category")) for item in spec.get("invariants") or []
        ),
        "critical_axes": sorted(str(p) for p in spec.get("critical_state_variables") or []),
        "irrelevant_axes": sorted(str(p) for p in spec.get("irrelevant_state_variables") or []),
        "policies": len(spec.get("policies") or []),
        "evidence": len(spec.get("evidence") or []),
    }


def revalidate(source: Path, out_dir: Path) -> dict[str, Any]:
    records = _read_jsonl(source)
    compiler = SemanticSkeletonCompiler()
    context = CompileContext(generator_model="phase2a-revalidation")
    rows: list[dict[str, Any]] = []
    accepted: list[dict[str, Any]] = []
    for record in records:
        skeleton = record.get("skeleton_document")
        if not isinstance(skeleton, Mapping):
            rows.append({"skeleton_id": record.get("skeleton_id"), "ok": False,
                         "reason": "no skeleton_document"})
            continue
        skeleton_id = str(skeleton.get("skeleton_id") or record.get("skeleton_id") or "?")
        try:
            result = compiler.compile_with_plan(skeleton, context=context)
        except SkeletonCompileError as exc:
            rows.append({"skeleton_id": skeleton_id, "ok": False,
                         "reason_code": exc.code, "detail": exc.failure.detail[:300]})
            continue
        except Exception as exc:  # noqa: BLE001
            rows.append({"skeleton_id": skeleton_id, "ok": False,
                         "reason_code": "INTERNAL_COMPILER_ERROR",
                         "detail": f"{type(exc).__name__}: {exc}"[:300]})
            continue
        spec = result.spec
        errors = list(world_spec_validator().iter_errors(spec))
        if errors:
            rows.append({"skeleton_id": skeleton_id, "ok": False,
                         "reason_code": "schema_invalid",
                         "detail": "; ".join(e.message[:120] for e in errors[:2])})
            continue
        report = verify_compiled_world(
            spec, skeleton=skeleton, plan=result.plan, config_path=PHASE2A_CONFIG
        )
        if not report.compiled:
            rows.append({"skeleton_id": skeleton_id, "ok": False,
                         "reason_code": str(report.error_code),
                         "detail": report.error_detail[:300]})
            continue
        if report.contradictions:
            rows.append({"skeleton_id": skeleton_id, "ok": False,
                         "reason_code": "CONTRADICTORY_EXPECTATION",
                         "detail": "; ".join(
                             f"{o.axis_id}:{o.declared_expectation}->{o.actual_effect}"
                             for o in report.contradictions)[:300]})
            continue
        old_shape = _semantic_shape(record.get("spec_document") or {})
        new_shape = _semantic_shape(spec)
        rows.append({
            "skeleton_id": skeleton_id,
            "ok": True,
            "semantic_equivalent": old_shape == new_shape,
            "attack_family": spec["attack_family"],
            "episodes": report.episodes,
            "base_labels": list(report.base_labels),
            "counterfactual_outcomes": len(report.outcomes),
            "contradictions": 0,
        })
        accepted.append({
            "skeleton_id": skeleton_id,
            "semantic_fingerprint": semantic_fingerprint(skeleton),
            "mechanism_family": skeleton.get("mechanism_family"),
            "attack_family": spec["attack_family"],
            "coverage_labels": record.get("coverage_labels") or [],
            "complexity": skeleton.get("complexity"),
            "application_domain": skeleton.get("domain"),
            "world_id": spec["world_id"],
            "probes": report.probes,
            "episodes": report.episodes,
            "base_labels": list(report.base_labels),
            "batch": record.get("batch"),
            "skeleton_document": dict(skeleton),
            "spec_document": spec,
        })
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "provider-run-002-revalidated.jsonl").open("w", encoding="utf-8") as handle:
        for item in accepted:
            handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")
    return {
        "source": str(source.relative_to(ROOT)),
        "considered": len(records),
        "recompiled": len(accepted),
        "rejected": len(records) - len(accepted),
        "semantic_equivalent": sum(1 for r in rows if r.get("semantic_equivalent")),
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 2A accepted 重裁")
    parser.add_argument("--source", default="worlds/skeletons/accepted/provider-run-002.jsonl.v05-run")
    parser.add_argument("--out", default="worlds/skeletons/accepted")
    # Phase 2B：报告与重裁产物可改道。默认值保持 Phase 2A 既有行为（那些报告是冻结
    # 历史，不许被覆盖），Phase 2B 回归显式写到 reports/phase2b/ 与 worlds/revalidated/。
    parser.add_argument("--report", default="reports/phase2a/revalidate.json")
    args = parser.parse_args()
    source = ROOT / args.source
    if not source.is_file():
        raise SystemExit(f"源文件不存在: {source}")
    payload = revalidate(source, ROOT / args.out)
    report_path = ROOT / args.report
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(
        (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    print(json.dumps({k: v for k, v in payload.items() if k != "rows"}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
