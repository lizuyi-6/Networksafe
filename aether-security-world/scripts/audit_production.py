"""500-world production 审计（Phase 2B brief §28/§62/§63）。

与 ``scripts/audit_phase2a.py`` 同一把尺子（结构签名 / 语义指纹 / 覆盖 / 经济性），
但读 ``worlds/production/`` 布局，并按 brief §63 的十一项审计分节。episode 级的
critical / irrelevant / masked 正确性由 ``expand_family`` 重展开逐条复算（与
``phase2a_final_audit`` 同语义），不是读 runner 的汇总数。

用法::

    py -3 scripts/audit_production.py                     # run-002
    py -3 scripts/audit_production.py --run-id X --out reports/phase2b/production-500.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic_skeleton.fingerprint import semantic_fingerprint  # noqa: E402

RUN_ID = "provider-run-production-002"
AUDIT_CONFIG = ROOT / "configs" / "phase2a.json"


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


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _structural_signature(spec: Mapping[str, Any]) -> str:
    shape = (
        len(spec.get("actors") or []), len(spec.get("resources") or []),
        len(spec.get("sessions") or []), len(spec.get("tokens") or []),
        len(spec.get("evidence") or []), len(spec.get("state_history") or []),
        len(spec.get("policies") or []), len(spec.get("trust_boundaries") or []),
        len(spec.get("caches") or []),
    )
    categories = sorted(str(item.get("category")) for item in spec.get("invariants") or [])
    fields = sorted(
        ".".join(str(path).split(".")[2:]) or str(path)
        for path in spec.get("critical_state_variables") or []
    )
    topology = sorted(
        (len(w.get("states") or []), len(w.get("transitions") or []))
        for w in spec.get("workflows") or []
    )
    return _sha256_text(json.dumps(
        {"shape": shape, "categories": categories, "fields": fields,
         "topology": topology, "attack_family": spec.get("attack_family")},
        ensure_ascii=False, sort_keys=True,
    ))


def collect(run_id: str) -> dict[str, Any]:
    worlds = ROOT / "worlds" / "production"
    suffix = "" if run_id == RUN_ID else f"-{run_id}"
    progress_path = ROOT / "state" / f"production-progress{suffix}.json"
    progress = json.loads(progress_path.read_text(encoding="utf-8")) if progress_path.is_file() else {}
    coverage_path = ROOT / "state" / f"production-coverage{suffix}.json"
    coverage = json.loads(coverage_path.read_text(encoding="utf-8")) if coverage_path.is_file() else {}
    infra_path = ROOT / "state" / f"infrastructure-failures-{run_id}.jsonl"
    return {
        "run_id": run_id,
        "accepted": _read_jsonl(worlds / "accepted" / f"{run_id}.jsonl"),
        "rejected": _read_jsonl(worlds / "rejected" / f"{run_id}.jsonl"),
        "quarantine": _read_jsonl(worlds / "quarantine" / f"{run_id}.jsonl"),
        "raw": _read_jsonl(worlds / "raw" / f"{run_id}.jsonl"),
        "progress": progress,
        "coverage": coverage,
        "infrastructure_failures": _read_jsonl(infra_path),
        "selection_trace": _read_jsonl(ROOT / "state" / f"mechanism-selection-trace-{run_id}.jsonl"),
    }


def audit(data: Mapping[str, Any]) -> dict[str, Any]:
    accepted = data["accepted"]
    progress = data["progress"]
    raw_count = int(progress.get("raw_skeletons") or len(data["raw"]))
    output_tokens = int(progress.get("output_tokens") or 0)
    input_tokens = int(progress.get("input_tokens") or 0)

    rejection_reasons = dict(sorted(Counter(
        str(record.get("reason")) for record in data["rejected"]
    ).items()))
    quarantine_reasons = dict(sorted(Counter(
        str(record.get("reason")) for record in data["quarantine"]
    ).items()))
    schema_failures = sum(
        count for reason, count in rejection_reasons.items()
        if reason in ("element_skeleton_rejected",)
    )
    compile_failures = int(progress.get("compile_failures") or 0)
    internal_compiler_errors = int(quarantine_reasons.get("internal_compiler_error", 0))
    verify_failures = int(quarantine_reasons.get("verify_failed", 0))
    contradictory = int(rejection_reasons.get("contradictory_expectation", 0))
    duplicates = int(rejection_reasons.get("duplicate_canonical_id", 0))
    near_duplicates = int(quarantine_reasons.get("semantic_near_duplicate", 0))

    fingerprints = [str(record.get("semantic_fingerprint")) for record in accepted]
    semantic = Counter(fingerprints)
    structural = Counter(_structural_signature(r.get("spec_document") or {}) for r in accepted)
    families = Counter(str(r.get("mechanism_family")) for r in accepted)
    labels: Counter[str] = Counter()
    domains: Counter[str] = Counter()
    complexity: Counter[str] = Counter()
    attack_families: Counter[str] = Counter()
    for record in accepted:
        labels.update(str(label) for label in record.get("coverage_labels") or ())
        domains[str(record.get("application_domain"))] += 1
        complexity[str(record.get("complexity"))] += 1
        attack_families[str(record.get("attack_family"))] += 1

    # ---- episode 级复算（与 phase2a_final_audit 同语义）---------------------- #
    from security_world.expansion import expand_family
    from security_world.expansion.config import ExpansionConfig
    from security_world.model import WorldSpec

    cfg = ExpansionConfig.from_config(json.loads(AUDIT_CONFIG.read_text(encoding="utf-8")))
    audit_config = json.loads(AUDIT_CONFIG.read_text(encoding="utf-8"))
    critical_total = critical_ok = 0
    critical_mismatches: list[dict[str, Any]] = []
    irrelevant_total = irrelevant_ok = 0
    irrelevant_mismatches: list[dict[str, Any]] = []
    masked_total = masked_ok = 0
    masked_mismatches: list[dict[str, Any]] = []
    episode_count = 0
    base_labels: Counter[str] = Counter()
    reexpansion_failures: list[dict[str, str]] = []
    from security_world.validation.lexical import scan_model_visible

    leakage_findings: list[dict[str, str]] = []
    for record in accepted:
        base_labels.update(str(label) for label in record.get("base_labels") or ())
        try:
            spec = WorldSpec.from_document(record["spec_document"])
            result = expand_family(spec, config=cfg, compile_config=audit_config,
                                   renderer="http_request")
        except Exception as exc:  # noqa: BLE001
            reexpansion_failures.append({
                "world_id": str(record.get("world_id")),
                "error": f"{type(exc).__name__}: {exc}"[:200],
            })
            continue
        base = result.variants[0]
        base_truth = base.oracle_output.world_truth
        base_observable = base.oracle_output.observable_decision
        declared = {
            str((axis if isinstance(axis, Mapping) else getattr(axis, "variable", None))
                and (axis.get("variable") if isinstance(axis, Mapping) else axis.variable)): axis
            for axis in (spec.hypotheses.expected_counterfactual_axes or ())
        }
        for episode in result.variants:
            episode_count += 1
            truth = episode.oracle_output.world_truth
            observable = episode.oracle_output.observable_decision
            document = episode.to_document()
            for hit in scan_model_visible(document["observation"]["model_visible"]):
                leakage_findings.append({
                    "world_id": str(record.get("world_id")),
                    "episode_id": document["episode_id"],
                    "marker": hit.marker, "path": hit.path,
                })
            if episode.variant_type == "critical_intervention":
                variable = str((episode.intervention or {}).get("intervention_variable") or "")
                axis = declared.get(variable)
                expected = str(
                    axis.get("expected_effect") if isinstance(axis, Mapping)
                    else getattr(axis, "expected_effect", "") or ""
                )
                changed = (truth, observable) != (base_truth, base_observable)
                critical_total += 1
                if expected == "verdict_flip":
                    if changed:
                        critical_ok += 1
                    else:
                        critical_mismatches.append({
                            "world_id": str(record.get("world_id")), "variable": variable,
                            "kind": "flip_expected_but_invariant",
                        })
                elif expected == "verdict_invariant":
                    if not changed:
                        critical_ok += 1
                    else:
                        critical_mismatches.append({
                            "world_id": str(record.get("world_id")), "variable": variable,
                            "kind": "invariant_expected_but_flipped",
                        })
            elif episode.variant_type == "irrelevant_perturbation":
                irrelevant_total += 1
                if (truth, observable) == (base_truth, base_observable):
                    irrelevant_ok += 1
                else:
                    irrelevant_mismatches.append({
                        "world_id": str(record.get("world_id")),
                        "base": base_observable, "variant": observable,
                    })
            elif episode.variant_type == "evidence_masked":
                masked_total += 1
                if truth == base_truth:
                    masked_ok += 1
                else:
                    masked_mismatches.append({
                        "world_id": str(record.get("world_id")),
                        "base_truth": base_truth, "variant_truth": truth,
                    })

    # ---- 世界级 critical correctness（brief §28 的主判据）------------------- #
    # 逐轴 mismatch 有已知的 mixed-base 语义：base 是 attack/insufficient_evidence 时，
    # 真正被违反的是另一条不变量，个别 critical 轴单独翻转不了（Phase 2A 同一豁免）。
    # 主判据按世界级：声明了 verdict_flip 的世界，至少一条声明轴真的翻转。
    world_critical_total = 0
    world_critical_ok = 0
    world_no_flip: list[dict[str, str]] = []
    if reexpansion_failures:
        world_no_flip.append({"world_id": "?", "reason": "reexpansion failures present"})
    else:
        for record in accepted:
            spec = WorldSpec.from_document(record["spec_document"])
            result = expand_family(spec, config=cfg, compile_config=audit_config,
                                   renderer="http_request")
            base_truth = result.variants[0].oracle_output.world_truth
            declared = {
                str((axis if isinstance(axis, Mapping) else getattr(axis, "variable", None))
                    and (axis.get("variable") if isinstance(axis, Mapping) else axis.variable)): axis
                for axis in (spec.hypotheses.expected_counterfactual_axes or ())
            }
            expects_flip = any(
                str(getattr(axis, "expected_effect", None)
                    or (axis.get("expected_effect") if isinstance(axis, Mapping) else "")) == "verdict_flip"
                for axis in declared.values()
            )
            if not expects_flip:
                continue
            world_critical_total += 1
            flipped = any(
                episode.oracle_output.world_truth != base_truth
                for episode in result.variants
                if episode.variant_type == "critical_intervention"
            )
            if flipped:
                world_critical_ok += 1
            else:
                world_no_flip.append({"world_id": str(record.get("world_id")),
                                      "base_truth": str(base_truth)})

    per_100k = (len(accepted) / output_tokens * 100_000) if output_tokens else 0.0
    acceptance = len(accepted) / raw_count if raw_count else 0.0

    return {
        "run_id": data["run_id"],
        "contract": "production",
        "compiler_version": "0.3.0",
        "counts": {
            "raw_skeletons": raw_count,
            "accepted": len(accepted),
            "rejected": int(progress.get("rejected") or len(data["rejected"])),
            "quarantined": int(progress.get("quarantined") or len(data["quarantine"])),
            "duplicates": duplicates,
            "near_duplicates": near_duplicates,
            "batches": int(progress.get("batches") or 0),
        },
        "schema": {
            "element_schema_failures": schema_failures,
            "schema_failure_rate": round(schema_failures / raw_count, 4) if raw_count else 0.0,
        },
        "compiler": {
            "compile_failures": compile_failures,
            "compile_failure_rate": round(compile_failures / raw_count, 4) if raw_count else 0.0,
            "internal_compiler_errors": internal_compiler_errors,
            "verify_failures": verify_failures,
            "contradictory_expectations": contradictory,
            "reexpansion_failures": reexpansion_failures,
        },
        "oracle": {
            "oracle_failures": verify_failures,
            "critical_total": critical_total, "critical_ok": critical_ok,
            "critical_mismatch_count": len(critical_mismatches),
            "critical_mismatches": critical_mismatches[:20],
            "world_level_total": world_critical_total,
            "world_level_ok": world_critical_ok,
            "world_level_mismatches": world_no_flip[:20],
            "world_level_mismatch_count": len(world_no_flip),
            "irrelevant_total": irrelevant_total, "irrelevant_ok": irrelevant_ok,
            "irrelevant_mismatch_count": len(irrelevant_mismatches),
            "masked_total": masked_total, "masked_ok": masked_ok,
            "masked_mismatch_count": len(masked_mismatches),
            "base_labels": dict(sorted(base_labels.items())),
            "episode_count": episode_count,
            "leakage_findings": len(leakage_findings),
            "leakage_samples": leakage_findings[:10],
        },
        "dedup": {
            "semantic_clusters": len(semantic),
            "largest_semantic_share": round(max(semantic.values()) / len(accepted), 4) if accepted else 0.0,
            "structural_clusters": len(structural),
            "largest_structural_share": round(max(structural.values()) / len(accepted), 4) if accepted else 0.0,
            "templates_over_10pct": sum(1 for n in structural.values() if accepted and n / len(accepted) > 0.10),
            "semantic_templates_over_10pct": sum(1 for n in semantic.values() if accepted and n / len(accepted) > 0.10),
        },
        "diversity": {
            "distinct_mechanism_families": len(families),
            "mechanism_families": dict(sorted(families.items())),
            "coverage_labels": dict(sorted(labels.items())),
            "domains": dict(sorted(domains.items())),
            "complexity": dict(sorted(complexity.items())),
            "attack_families": dict(sorted(attack_families.items())),
        },
        "provider": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "retries": int(progress.get("retries") or 0),
            "provider_errors": int(progress.get("provider_errors") or 0),
            "usage_missing_calls": int(progress.get("usage_missing_calls") or 0),
            "provider_claimed_id_reuse": int(progress.get("provider_claimed_id_reuse") or 0),
            "infrastructure_failures": len(data["infrastructure_failures"]),
            "wallclock_s": progress.get("wallclock_s"),
        },
        "token_economy": {
            "acceptance_rate": round(acceptance, 4),
            "accepted_per_100k_output_tokens": round(per_100k, 3),
        },
        "coverage_controller": data["coverage"],
        "selection_trace_batches": len(data["selection_trace"]),
    }


def render(doc: Mapping[str, Any]) -> str:
    return f"""# Production 500-world 审计（brief §28/§62/§63）

- run: `{doc['run_id']}`（contract=production, compiler 0.3.0）
- raw {doc['counts']['raw_skeletons']} → accepted **{doc['counts']['accepted']}** /
  rejected {doc['counts']['rejected']} / quarantined {doc['counts']['quarantined']}
  （canonical-id 重复 {doc['counts']['duplicates']}，语义近重复 {doc['counts']['near_duplicates']}）
- batches {doc['counts']['batches']}

## 质量门（brief §28）

| 门 | 实测 |
| --- | --- |
| internal compiler error = 0 | {doc['compiler']['internal_compiler_errors']} |
| oracle failure = 0 | {doc['oracle']['oracle_failures']} |
| leakage = 0 | {doc['oracle']['leakage_findings']} |
| critical intervention 100% | {doc['oracle']['critical_ok']}/{doc['oracle']['critical_total']}（mismatch {doc['oracle']['critical_mismatch_count']}） |
| irrelevant invariance 100% | {doc['oracle']['irrelevant_ok']}/{doc['oracle']['irrelevant_total']} |
| evidence masking 真值保持 100% | {doc['oracle']['masked_ok']}/{doc['oracle']['masked_total']} |
| largest structural cluster < 10% | {doc['dedup']['largest_structural_share']:.2%}（>10% 模板 {doc['dedup']['templates_over_10pct']}） |
| largest semantic cluster | {doc['dedup']['largest_semantic_share']:.2%} |

- 重新展开失败（accepted 世界重跑 expand_family 失败）: {len(doc['compiler']['reexpansion_failures'])}
- 先验矛盾拒收: {doc['compiler']['contradictory_expectations']}
- base labels: {doc['oracle']['base_labels']}
- episodes（默认 renderer）: {doc['oracle']['episode_count']}

## 多样性

- distinct mechanism families: {doc['diversity']['distinct_mechanism_families']}/46
- labels: {doc['diversity']['coverage_labels']}
- complexity: {doc['diversity']['complexity']}
- domains: {len(doc['diversity']['domains'])} 个
- attack families: {len(doc['diversity']['attack_families'])} 个

## 经济性 / provider

- acceptance rate: {doc['token_economy']['acceptance_rate']:.2%}
- accepted / 100k output tokens: {doc['token_economy']['accepted_per_100k_output_tokens']}
- tokens: in {doc['provider']['input_tokens']} / out {doc['provider']['output_tokens']}
- retries {doc['provider']['retries']}，provider errors {doc['provider']['provider_errors']}，
  infrastructure failures {doc['provider']['infrastructure_failures']}
- provider 撞 id（只记录不拒收）: {doc['provider']['provider_claimed_id_reuse']}
- wallclock: {doc['provider']['wallclock_s']}s
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Production 500-world 审计")
    parser.add_argument("--run-id", default=RUN_ID)
    parser.add_argument("--out", default="reports/phase2b/production-500.json")
    parser.add_argument("--md", default="reports/phase2b/production-500.md")
    args = parser.parse_args()

    doc = audit(collect(args.run_id))
    out_path = ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(
        (json.dumps(doc, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    (ROOT / args.md).write_bytes(render(doc).encode("utf-8"))
    print(json.dumps({
        "accepted": doc["counts"]["accepted"],
        "raw": doc["counts"]["raw_skeletons"],
        "acceptance_rate": doc["token_economy"]["acceptance_rate"],
        "internal_compiler_errors": doc["compiler"]["internal_compiler_errors"],
        "oracle_failures": doc["oracle"]["oracle_failures"],
        "leakage": doc["oracle"]["leakage_findings"],
        "critical": f"{doc['oracle']['critical_ok']}/{doc['oracle']['critical_total']}",
        "irrelevant": f"{doc['oracle']['irrelevant_ok']}/{doc['oracle']['irrelevant_total']}",
        "masked": f"{doc['oracle']['masked_ok']}/{doc['oracle']['masked_total']}",
        "largest_structural_share": doc["dedup"]["largest_structural_share"],
        "mechanisms": doc["diversity"]["distinct_mechanism_families"],
        "episodes": doc["oracle"]["episode_count"],
        "accepted_per_100k": doc["token_economy"]["accepted_per_100k_output_tokens"],
    }, ensure_ascii=False, indent=2))
    print(f"report -> {out_path} / {ROOT / args.md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
