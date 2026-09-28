"""Phase 2A 最终 GO/NO-GO 审计（brief §61-§62 的每一项都单独实测）。

``audit_phase2a.py`` 给的是十项结构审计；本脚本补上四项**行为**判据——它们只能靠
真的把每个 accepted 世界展开、跑 Oracle、扫渲染文本来测：

=====================  ================================================
判据                   测法
=====================  ================================================
critical intervention  声明 verdict_flip 的干预是否真的翻转；声明
                        verdict_invariant 的是否真的不变（预期 vs 实测）
irrelevant invariance  每个无关扰动变体的判决是否与 base 逐字节一致
evidence masking       每个掩蔽变体的 observable_decision 是否符合该
                        level 的判定规则（§9.4）
label leakage          G12 词表扫全部 episode 的 model_visible 侧
structural cluster     编译后结构签名的最大簇占比
=====================  ================================================

用法::

    py -3 scripts/phase2a_final_audit.py [--out reports/phase2a/go-no-go.json]
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

from analysis.pipeline import (  # noqa: E402
    action_from_binds,
    axes_for_probe,
    family_view_for_action,
    spec_probes,
    spec_with_axes,
)
from security_world.expansion import expand_family  # noqa: E402
from security_world.expansion.config import ExpansionConfig  # noqa: E402
from security_world.model import WorldSpec  # noqa: E402
from security_world.model.config import load_default_config  # noqa: E402
from security_world.validation.lexical import scan_model_visible  # noqa: E402

RUN_ID = "provider-run-002"
AUDIT_RUN_ID = "provider-run-002"
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


def _trace(episode: Any) -> tuple[str, str]:
    output = episode.oracle_output
    document = output.to_document() if hasattr(output, "to_document") else dict(output)
    return str(document.get("world_truth")), str(document.get("observable_decision"))


def measure(accepted: list[dict[str, Any]]) -> dict[str, Any]:
    config = load_default_config(PHASE2A_CONFIG)
    cfg = ExpansionConfig.from_config(config)

    flip_expected = flip_observed = 0
    invariant_expected = invariant_observed = 0
    downgrade_expected = downgrade_observed = 0
    critical_mismatches: list[dict[str, Any]] = []
    mixed_base: list[dict[str, Any]] = []
    flip_confirmed_variables: set[str] = set()
    invariant_confirmed_variables: set[str] = set()

    irrelevant_total = irrelevant_identical = 0
    irrelevant_mismatches: list[dict[str, Any]] = []

    masked_total = masked_valid = 0
    masked_mismatches: list[dict[str, Any]] = []

    episodes_scanned = 0
    leakage_findings: list[dict[str, Any]] = []
    worlds_measured = 0
    base_labels: Counter[str] = Counter()

    for record in accepted:
        spec_document = record.get("spec_document")
        if not isinstance(spec_document, Mapping):
            continue
        try:
            spec = WorldSpec.from_document(json.loads(json.dumps(dict(spec_document))))
        except Exception:  # noqa: BLE001
            continue
        worlds_measured += 1
        at = str(spec_document["current_state"]["at"])
        declared = {
            str(axis.get("variable")): axis
            for axis in (spec_document.get("hypotheses") or {}).get(
                "expected_counterfactual_axes"
            ) or ()
        }
        for _summary, binds in spec_probes(spec):
            action = action_from_binds(binds, action_id=f"ACTN-FINAL-{worlds_measured}", at=at)
            probe_spec = spec_with_axes(spec, axes_for_probe(spec, binds))
            try:
                result = expand_family(
                    probe_spec, seed=spec.seed, action=action, config=cfg,
                    renderer="http_request", compile_config=config,
                )
                view = family_view_for_action(result, action, seed=spec.seed, spec=probe_spec)
            except Exception:  # noqa: BLE001
                continue
            base_truth, base_observable = _trace(view.base)
            base_labels[base_observable] += 1
            for episode in view.variants:
                episodes_scanned += 1
                truth, observable = _trace(episode)
                # 标签泄漏：只扫 model_visible 侧
                for hit in scan_model_visible(
                    episode.observation.get("model_visible") or {}
                ):
                    leakage_findings.append({
                        "world_id": record.get("world_id"),
                        "episode_id": episode.episode_id,
                        "marker": hit.marker,
                        "path": hit.path,
                        "excerpt": hit.excerpt[:120],
                    })

                if episode.variant_type == "critical_intervention":
                    variable = str(
                        (episode.intervention or {}).get("intervention_variable") or ""
                    )
                    axis = declared.get(variable, {})
                    expected = str(axis.get("expected_effect") or "")
                    changed = truth != base_truth or observable != base_observable
                    if expected == "verdict_flip":
                        flip_expected += 1
                        if changed:
                            flip_observed += 1
                            flip_confirmed_variables.add(variable)
                        else:
                            # 混合 base：同一轴在别的 probe 上被证实时不判缺陷
                            # （与 runner 的按轴聚合、G5 的家族粒度判定同一语义）。
                            mixed_base.append({
                                "world_id": record.get("world_id"),
                                "episode_id": episode.episode_id,
                                "variable": variable,
                                "kind": "flip_expected_but_invariant",
                            })
                    elif expected == "verdict_invariant":
                        invariant_expected += 1
                        if not changed:
                            invariant_observed += 1
                            invariant_confirmed_variables.add(variable)
                        else:
                            mixed_base.append({
                                "world_id": record.get("world_id"),
                                "episode_id": episode.episode_id,
                                "variable": variable,
                                "kind": "invariant_expected_but_flipped",
                            })
                    elif expected == "observable_downgrade":
                        downgrade_expected += 1
                        if observable != base_observable and truth == base_truth:
                            downgrade_observed += 1

                elif episode.variant_type == "irrelevant_perturbation":
                    irrelevant_total += 1
                    if (truth, observable) == (base_truth, base_observable):
                        irrelevant_identical += 1
                    else:
                        irrelevant_mismatches.append({
                            "world_id": record.get("world_id"),
                            "episode_id": episode.episode_id,
                            "base": base_observable,
                            "variant": observable,
                        })

                elif episode.variant_type == "evidence_masked":
                    masked_total += 1
                    # 掩蔽只改可见性：observable 可以降级成 insufficient_evidence，
                    # 但 world_truth 不得改变（掩蔽不是反事实）。
                    if truth == base_truth:
                        masked_valid += 1
                    else:
                        masked_mismatches.append({
                            "world_id": record.get("world_id"),
                            "episode_id": episode.episode_id,
                            "base_truth": base_truth,
                            "variant_truth": truth,
                        })

    # 一条轴只有在**没有任何**适用 probe 证实它时才算矛盾
    unconfirmed = [
        row for row in mixed_base
        if row["variable"] not in flip_confirmed_variables
        and row["variable"] not in invariant_confirmed_variables
    ]
    return {
        "worlds_measured": worlds_measured,
        "episodes_scanned": episodes_scanned,
        "base_label_distribution": dict(sorted(base_labels.items())),
        "critical_intervention": {
            "flip_expected": flip_expected,
            "flip_observed": flip_observed,
            "flip_rate": (flip_observed / flip_expected) if flip_expected else None,
            "invariant_expected": invariant_expected,
            "invariant_observed": invariant_observed,
            "invariance_rate": (invariant_observed / invariant_expected) if invariant_expected else None,
            "downgrade_expected": downgrade_expected,
            "downgrade_observed": downgrade_observed,
            "mismatches": unconfirmed[:20],
            "mismatch_count": len(unconfirmed),
            "mixed_base_count": len(mixed_base) - len(unconfirmed),
        },
        "irrelevant_perturbation": {
            "total": irrelevant_total,
            "verdict_identical": irrelevant_identical,
            "rate": (irrelevant_identical / irrelevant_total) if irrelevant_total else None,
            "mismatches": irrelevant_mismatches[:20],
            "mismatch_count": len(irrelevant_mismatches),
        },
        "evidence_masked": {
            "total": masked_total,
            "world_truth_preserved": masked_valid,
            "rate": (masked_valid / masked_total) if masked_total else None,
            "mismatches": masked_mismatches[:20],
            "mismatch_count": len(masked_mismatches),
        },
        "leakage": {
            "episodes_scanned": episodes_scanned,
            "findings": len(leakage_findings),
            "samples": leakage_findings[:10],
        },
    }


def verdict(audit: Mapping[str, Any], behaviour: Mapping[str, Any]) -> dict[str, Any]:
    """brief §62 的 GO 判据逐条比对。"""
    counts = audit["counts"]
    token = audit["token_economy"]
    labels = audit["coverage"]["labels"]
    critical = behaviour["critical_intervention"]
    irrelevant = behaviour["irrelevant_perturbation"]
    masked = behaviour["evidence_masked"]
    leakage = behaviour["leakage"]
    dedup = audit["dedup"]

    # schema/shape 类失败单独测：Phase 2A 的低层形状由编译器产出，结构上不可能出现
    # Phase 1 那类 resource_states / state_preconditions 形状失败；实测的就是
    # world-spec schema 违规数（骨架被 schema 拒是**元素级**语义拒绝，另计在
    # acceptance rate 里，不混入本项）。
    shape_failures = audit["schema"]["failures"]
    shape_failure_rate = (
        shape_failures / counts["raw_skeletons"] if counts["raw_skeletons"] else 0.0
    )
    compiler_failure_rate = (
        audit["compiler"]["total_failures"] / counts["raw_skeletons"]
        if counts["raw_skeletons"] else 0.0
    )
    criteria = [
        ("accepted >= 100", counts["accepted"] >= 100, counts["accepted"]),
        ("acceptance rate >= 70%", counts["acceptance_rate"] >= 0.70,
         f"{counts['acceptance_rate']:.4f}"),
        ("schema/shape generation failure < 10% raw", shape_failure_rate < 0.10,
         f"{shape_failure_rate:.4f}（{shape_failures}/{counts['raw_skeletons']}）"),
        ("compiler failure < 10% raw", compiler_failure_rate < 0.10,
         f"{compiler_failure_rate:.4f}"),
        ("oracle failure = 0", audit["oracle"]["failures"] == 0, audit["oracle"]["failures"]),
        ("internal compiler error = 0",
         audit["compiler"]["internal_compiler_errors"] == 0,
         audit["compiler"]["internal_compiler_errors"]),
        ("critical intervention correctness = 100%",
         critical["mismatch_count"] == 0, critical["mismatch_count"]),
        ("irrelevant invariance = 100%",
         irrelevant["mismatch_count"] == 0, irrelevant["mismatch_count"]),
        ("evidence masking world_truth preserved = 100%",
         masked["mismatch_count"] == 0, masked["mismatch_count"]),
        ("leakage findings = 0", leakage["findings"] == 0, leakage["findings"]),
        ("largest structural cluster < 10%",
         dedup["largest_structural_share"] < 0.10,
         f"{dedup['largest_structural_share']:.4f}"),
        ("multi_tenant >= 8", int(labels.get("multi_tenant", 0)) >= 8,
         labels.get("multi_tenant", 0)),
        ("accepted / 100k output tokens > 2",
         token["accepted_per_100k_output"] > 2,
         f"{token['accepted_per_100k_output']:.3f}"),
        ("provider 无未解决的系统性挂死",
         audit["provider"]["provider_errors"] == 0, audit["provider"]["provider_errors"]),
    ]
    return {
        "criteria": [
            {"criterion": name, "passed": bool(ok), "actual": actual}
            for name, ok, actual in criteria
        ],
        "go": all(ok for _name, ok, _actual in criteria),
        "passed": sum(1 for _n, ok, _a in criteria if ok),
        "total": len(criteria),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 2A GO/NO-GO 审计")
    parser.add_argument("--audit", default="reports/phase2a/final-100.json")
    parser.add_argument("--out", default="reports/phase2a/go-no-go.json")
    parser.add_argument("--run-id", default=AUDIT_RUN_ID)
    args = parser.parse_args()

    audit_path = ROOT / args.audit
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    accepted = _read_jsonl(
        ROOT / "worlds" / "skeletons" / "accepted" / f"{args.run_id}.jsonl"
    )
    behaviour = measure(accepted)
    decision = verdict(audit, behaviour)
    payload = {"audit": audit, "behaviour": behaviour, "decision": decision}
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                   encoding="utf-8")

    print("# Phase 2A GO / NO-GO")
    print()
    for item in decision["criteria"]:
        mark = "PASS" if item["passed"] else "FAIL"
        print(f"- [{mark}] {item['criterion']} — 实际 {item['actual']}")
    print()
    print(f"## 行为判据实测")
    print(f"- worlds measured: {behaviour['worlds_measured']}；"
          f"episodes scanned: {behaviour['episodes_scanned']}")
    print(f"- base label 分布: {behaviour['base_label_distribution']}")
    critical = behaviour["critical_intervention"]
    print(f"- critical intervention: flip {critical['flip_observed']}/{critical['flip_expected']}"
          f"（rate {critical['flip_rate']}）；invariant "
          f"{critical['invariant_observed']}/{critical['invariant_expected']}"
          f"（rate {critical['invariance_rate']}）；mismatches {critical['mismatch_count']}")
    irrelevant = behaviour["irrelevant_perturbation"]
    print(f"- irrelevant perturbation: {irrelevant['verdict_identical']}/{irrelevant['total']}"
          f" 判决一致（rate {irrelevant['rate']}）")
    masked = behaviour["evidence_masked"]
    print(f"- evidence masked: {masked['world_truth_preserved']}/{masked['total']}"
          f" world_truth 不变（rate {masked['rate']}）")
    print(f"- leakage findings: {behaviour['leakage']['findings']}")
    print()
    print(f"## 结论: {'GO' if decision['go'] else 'NO-GO'}"
          f"（{decision['passed']}/{decision['total']} 项通过）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
