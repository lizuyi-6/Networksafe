"""Generator-OOD Engineering Pilot 的审计（Phase 2B brief §14）。

目的只有一个：现有 semantic skeleton schema + ontology + mechanism registry +
deterministic compiler 是否过拟合 step-5-preview 的表达方式。**不要求**它达到 Step 的
81.3%——重点是 compiler compatibility（brief §14 的原话）。

按 brief §14 统计：parse success / semantic schema success / ontology coverage /
unknown semantic facts / unknown mechanisms / compiler success / internal compiler
errors / oracle failures / counterfactual correctness / leakage / structural duplicate
rate / semantic diversity / accepted rate / accepted per 100k output tokens。

用法::

    py -3 scripts/audit_ood_pilot.py                    # 默认 run_id
    py -3 scripts/audit_ood_pilot.py --run-id X --out reports/phase2b/ood-pilot.json
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
from semantic_skeleton.ontology import semantic_fact  # noqa: E402

RUN_ID = "provider-ood-pilot-001"


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
    """与 scripts/audit_phase2a.py 同一把尺子（横向可比）。"""
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


def audit(run_id: str) -> dict[str, Any]:
    worlds = ROOT / "worlds" / "ood"
    accepted = _read_jsonl(worlds / "accepted" / f"{run_id}.jsonl")
    rejected = _read_jsonl(worlds / "rejected" / f"{run_id}.jsonl")
    quarantine = _read_jsonl(worlds / "quarantine" / f"{run_id}.jsonl")
    raw = _read_jsonl(worlds / "raw" / f"{run_id}.jsonl")
    frames = _read_jsonl(worlds / "raw" / f"frames-{run_id}.jsonl")
    progress: Mapping[str, Any] = {}
    suffix = "" if run_id == RUN_ID else f"-{run_id}"
    progress_path = ROOT / "state" / f"ood-progress{suffix}.json"
    if progress_path.is_file():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))

    # ---- provider 侧 ------------------------------------------------------ #
    batches = int(progress.get("batches") or len(frames))
    input_tokens = int(progress.get("input_tokens") or 0)
    output_tokens = int(progress.get("output_tokens") or 0)
    raw_skeletons = int(progress.get("raw_skeletons") or len(raw))
    parse_failures = int(progress.get("parse_failures") or 0)

    # ---- 帧级 parse success ---------------------------------------------- #
    # raw 文件按元素记录；frame 失败只在 rejected 里留 ?batch 记录。
    frame_failures = sum(
        1 for record in rejected if record.get("skeleton_id") == "?batch"
    )
    parse_success = (batches - frame_failures) / batches if batches else 0.0

    # ---- 元素级 schema / ontology ---------------------------------------- #
    reason_counts: Counter[str] = Counter(
        str(record.get("reason")) for record in rejected if record.get("skeleton_id") != "?batch"
    )
    quarantine_counts: Counter[str] = Counter(
        str(record.get("reason")) for record in quarantine
    )
    schema_failures = sum(
        count for reason, count in reason_counts.items() if reason == "element_skeleton_rejected"
    )
    compile_failures = sum(
        count for reason, count in reason_counts.items() if reason == "compile_error"
    )

    # unknown fact / unknown mechanism 的细分：从拒绝明细里按错误码归类。
    unknown_fact_rejects = 0
    unknown_mechanism_rejects = 0
    other_schema_rejects = 0
    for record in rejected:
        detail = str(record.get("detail") or "")
        if str(record.get("reason")) != "element_skeleton_rejected":
            continue
        # fact_path 形状的拒绝来自 §17（forbidden_fact_path），不是未知事实；
        # schema 报 required/enumeration 的才是词表外。机制名未知走 compile_error 的
        # UNKNOWN_MECHANISM。这里按可辨认的信号细分，其余进 other。
        lowered = detail.lower()
        if "unknown_mechanism" in lowered:
            unknown_mechanism_rejects += 1
        elif "is not one of" in lowered or "required property" in lowered:
            other_schema_rejects += 1
        else:
            other_schema_rejects += 1
    compiler_failures: Counter[str] = Counter(
        str(record.get("reason_code")) for record in rejected
        if str(record.get("reason")) == "compile_error"
    )
    unknown_mechanism_rejects += int(compiler_failures.get("UNKNOWN_MECHANISM", 0))

    # ---- ontology coverage（accepted 用的语义事实 ÷ 本体全集）------------- #
    used_facts: set[str] = set()
    unknown_facts_in_accepted: set[str] = set()
    for record in accepted:
        document = record.get("skeleton_document") or {}
        for name in (
            list(document.get("critical_facts") or ())
            + list(document.get("required_evidence") or ())
            + list(document.get("optional_evidence") or ())
            + list(document.get("untrusted_evidence") or ())
            + list(document.get("evidence_masking_targets") or ())
            + list(document.get("irrelevant_facts") or ())
        ):
            name = str(name)
            used_facts.add(name)
            if semantic_fact(name) is None:
                unknown_facts_in_accepted.add(name)

    # ---- 编译 / oracle / 反事实（episode 级重展开，与 phase2a_final_audit 同尺）-- #
    internal_compiler_errors = int(quarantine_counts.get("internal_compiler_error", 0))
    verify_failures = int(quarantine_counts.get("verify_failed", 0))
    contradictory = int(reason_counts.get("contradictory_expectation", 0))

    from security_world.expansion import expand_family
    from security_world.expansion.config import ExpansionConfig
    from security_world.model import WorldSpec

    audit_config = json.loads((ROOT / "configs" / "phase2a.json").read_text(encoding="utf-8"))
    cfg = ExpansionConfig.from_config(audit_config)
    from security_world.validation.lexical import scan_model_visible

    leakage_findings: list[dict[str, Any]] = []
    reexpansion_failures: list[dict[str, Any]] = []
    critical_total = 0
    critical_ok = 0
    critical_mismatches: list[dict[str, Any]] = []
    irrelevant_total = 0
    irrelevant_ok = 0
    irrelevant_mismatches: list[dict[str, Any]] = []
    masked_total = 0
    masked_ok = 0
    masked_mismatches: list[dict[str, Any]] = []
    episode_count = 0
    base_labels: Counter[str] = Counter()
    for record in accepted:
        base_labels.update(str(label) for label in record.get("base_labels") or ())
        try:
            spec = WorldSpec.from_document(record["spec_document"])
            result = expand_family(spec, config=cfg, compile_config=audit_config,
                                   renderer="http_request")
        except Exception as exc:  # noqa: BLE001 - accepted 的世界重展开失败是 release blocker
            reexpansion_failures.append({
                "world_id": record.get("world_id"),
                "error": f"{type(exc).__name__}: {exc}"[:200],
            })
            episode_count += int(record.get("episodes") or 0)
            continue
        base = result.variants[0]
        base_truth = base.oracle_output.world_truth
        base_observable = base.oracle_output.observable_decision
        declared_axes: dict[str, Any] = {}
        for axis in (spec.hypotheses.expected_counterfactual_axes or ()):
            # spec 模型里是 CounterfactualAxis 对象（有 .variable/.expected_effect），
            # 文档形态才是 dict——两种都接。
            get = axis.get if hasattr(axis, "get") else lambda key, _a=axis: getattr(_a, key, None)
            variable = str(get("variable") or "")
            if variable:
                declared_axes[variable] = axis
        for episode in result.variants:
            episode_count += 1
            truth = episode.oracle_output.world_truth
            observable = episode.oracle_output.observable_decision
            if episode.variant_type == "critical_intervention":
                variable = str((episode.intervention or {}).get("intervention_variable") or "")
                axis = declared_axes.get(variable) or {}
                get = axis.get if hasattr(axis, "get") else (
                    lambda key, _a=axis: getattr(_a, key, None)
                )
                expected = str(get("expected_effect") or "")
                changed = (truth, observable) != (base_truth, base_observable)
                critical_total += 1
                if expected == "verdict_flip":
                    if changed:
                        critical_ok += 1
                    else:
                        critical_mismatches.append({
                            "world_id": record.get("world_id"), "variable": variable,
                            "kind": "flip_expected_but_invariant",
                        })
                elif expected == "verdict_invariant":
                    if not changed:
                        critical_ok += 1
                    else:
                        critical_mismatches.append({
                            "world_id": record.get("world_id"), "variable": variable,
                            "kind": "invariant_expected_but_flipped",
                        })
            elif episode.variant_type == "irrelevant_perturbation":
                irrelevant_total += 1
                if (truth, observable) == (base_truth, base_observable):
                    irrelevant_ok += 1
                else:
                    irrelevant_mismatches.append({
                        "world_id": record.get("world_id"),
                        "base": base_observable, "variant": observable,
                    })
            elif episode.variant_type == "evidence_masked":
                masked_total += 1
                if truth == base_truth:
                    masked_ok += 1
                else:
                    masked_mismatches.append({
                        "world_id": record.get("world_id"),
                        "base_truth": base_truth, "variant_truth": truth,
                    })
            # G12 词表泄漏：只扫 model_visible 侧（与 phase2a_final_audit 同一扫描器）
            for hit in scan_model_visible(episode.observation.get("model_visible") or {}):
                leakage_findings.append({
                    "world_id": record.get("world_id"),
                    "episode_id": episode.episode_id,
                    "marker": hit.marker,
                    "path": hit.path,
                })

    # ---- 去重 / 多样性 ---------------------------------------------------- #
    fingerprints = [str(record.get("semantic_fingerprint")) for record in accepted]
    semantic_clusters = len(set(fingerprints))
    structural = Counter(
        _structural_signature(record.get("spec_document") or {}) for record in accepted
    )
    largest_structural = (max(structural.values()) / len(accepted)) if accepted else 0.0
    structural_clusters = len(structural)
    families: Counter[str] = Counter(str(record.get("mechanism_family")) for record in accepted)
    labels: Counter[str] = Counter()
    domains: Counter[str] = Counter()
    complexity: Counter[str] = Counter()
    for record in accepted:
        for label in record.get("coverage_labels") or ():
            labels[str(label)] += 1
        domains[str(record.get("application_domain"))] += 1
        complexity[str(record.get("complexity"))] += 1

    accepted_rate = len(accepted) / raw_skeletons if raw_skeletons else 0.0
    per_100k = (len(accepted) / output_tokens * 100_000) if output_tokens else 0.0

    return {
        "run_id": run_id,
        "generator": progress.get("run_id"),
        "provider_batches": batches,
        "raw_skeletons": raw_skeletons,
        "accepted": len(accepted),
        "rejected": int(progress.get("rejected") or len(rejected)),
        "quarantined": int(progress.get("quarantined") or len(quarantine)),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "retries": int(progress.get("retries") or 0),
        "provider_errors": int(progress.get("provider_errors") or 0),
        "provider_claimed_id_reuse": int(progress.get("provider_claimed_id_reuse") or 0),
        "parse": {
            "frame_failures": frame_failures,
            "frame_success_rate": round(parse_success, 4),
            "parse_failures_total": parse_failures,
        },
        "schema": {
            "element_schema_failures": schema_failures,
            "schema_success_rate": round(
                1 - schema_failures / raw_skeletons, 4
            ) if raw_skeletons else 0.0,
            "unknown_mechanism_rejects": unknown_mechanism_rejects,
            "other_schema_rejects": other_schema_rejects,
        },
        "ontology": {
            "distinct_facts_used": len(used_facts),
            "unknown_facts_in_accepted": sorted(unknown_facts_in_accepted),
        },
        "compiler": {
            "compile_failures": compile_failures,
            "compile_failure_codes": dict(sorted(compiler_failures.items())),
            "internal_compiler_errors": internal_compiler_errors,
            "verify_failures": verify_failures,
            "contradictory_expectations": contradictory,
            "compile_success_rate": round(
                1 - compile_failures / raw_skeletons, 4
            ) if raw_skeletons else 0.0,
        },
        "oracle": {
            "oracle_failures": verify_failures,
            "episode_level_reexpansion": True,
            "critical_total": critical_total,
            "critical_ok": critical_ok,
            "critical_mismatch_count": len(critical_mismatches),
            "critical_mismatches": critical_mismatches[:20],
            "irrelevant_total": irrelevant_total,
            "irrelevant_ok": irrelevant_ok,
            "irrelevant_mismatch_count": len(irrelevant_mismatches),
            "irrelevant_mismatches": irrelevant_mismatches[:20],
            "masked_total": masked_total,
            "masked_ok": masked_ok,
            "masked_mismatch_count": len(masked_mismatches),
            "masked_mismatches": masked_mismatches[:20],
            "base_labels": dict(sorted(base_labels.items())),
            "episode_count": episode_count,
            "leakage_findings": len(leakage_findings),
            "leakage_samples": leakage_findings[:10],
            "reexpansion_failures": reexpansion_failures,
        },
        "dedup": {
            "semantic_clusters": semantic_clusters,
            "semantic_duplicates": len(accepted) - semantic_clusters,
            "structural_clusters": structural_clusters,
            "largest_structural_share": round(largest_structural, 4),
            "templates_over_10pct": sum(
                1 for size in structural.values()
                if accepted and size / len(accepted) > 0.10
            ),
            "semantic_near_duplicate_quarantined": int(
                quarantine_counts.get("semantic_near_duplicate", 0)
            ),
        },
        "diversity": {
            "mechanism_families": dict(sorted(families.items())),
            "distinct_mechanism_families": len(families),
            "coverage_labels": dict(sorted(labels.items())),
            "domains": dict(sorted(domains.items())),
            "complexity": dict(sorted(complexity.items())),
        },
        "economy": {
            "accepted_rate": round(accepted_rate, 4),
            "accepted_per_100k_output_tokens": round(per_100k, 3),
        },
        "rejection_reasons": dict(sorted(reason_counts.items())),
        "quarantine_reasons": dict(sorted(quarantine_counts.items())),
    }


def render(doc: Mapping[str, Any]) -> str:
    lines = [
        "# Generator-OOD Engineering Pilot — 审计（brief §14）",
        "",
        f"- run_id: `{doc['run_id']}`",
        f"- provider batches: {doc['provider_batches']}，raw skeletons: {doc['raw_skeletons']}",
        f"- accepted: **{doc['accepted']}** / rejected {doc['rejected']} / "
        f"quarantined {doc['quarantined']}",
        f"- tokens: in {doc['input_tokens']} / out {doc['output_tokens']}，"
        f"retries {doc['retries']}，provider errors {doc['provider_errors']}",
        f"- provider 撞 id（只记录，不拒收，brief §29）: "
        f"{doc['provider_claimed_id_reuse']}",
        "",
        "## Compiler compatibility（重点，brief §14）",
        "",
        f"- frame success rate: {doc['parse']['frame_success_rate']:.2%}"
        f"（{doc['parse']['frame_failures']} 帧失败）",
        f"- element schema success rate: {doc['schema']['schema_success_rate']:.2%}"
        f"（{doc['schema']['element_schema_failures']} 条 schema 拒绝；"
        f"未知机制 {doc['schema']['unknown_mechanism_rejects']}）",
        f"- compile success rate: **{doc['compiler']['compile_success_rate']:.2%}**"
        f"（{doc['compiler']['compile_failures']} 次编译失败）",
        f"- internal compiler errors: {doc['compiler']['internal_compiler_errors']}",
        f"- oracle failures: {doc['oracle']['oracle_failures']}，"
        f"先验矛盾拒收: {doc['compiler']['contradictory_expectations']}",
        f"- 编译失败码: {doc['compiler']['compile_failure_codes'] or '（无）'}",
        f"- 本体覆盖: {doc['ontology']['distinct_facts_used']} 个不同语义事实，"
        f"accepted 里出现本体外的名字: "
        f"{doc['ontology']['unknown_facts_in_accepted'] or '（无）'}",
        "",
        "## 反事实 / 掩蔽",
        "",
        f"- critical intervention: {doc['oracle']['critical_total']} 次，"
        f"符合预期 {doc['oracle']['critical_ok']}，mismatch "
        f"{doc['oracle']['critical_mismatch_count']}",
        f"- irrelevant perturbation: {doc['oracle']['irrelevant_total']} 次，"
        f"判决逐字节一致 {doc['oracle']['irrelevant_ok']}，不一致 "
        f"{doc['oracle']['irrelevant_mismatch_count']}",
        f"- evidence masked: {doc['oracle']['masked_total']} 次，world_truth 保持 "
        f"{doc['oracle']['masked_ok']}，改变 {doc['oracle']['masked_mismatch_count']}",
        f"- leakage findings: {doc['oracle']['leakage_findings']}",
        f"- base labels: {doc['oracle']['base_labels']}",
        f"- episodes: {doc['oracle']['episode_count']}",
        "",
        "## 去重 / 多样性",
        "",
        f"- 语义簇: {doc['dedup']['semantic_clusters']}（accepted 里近重复 "
        f"{doc['dedup']['semantic_duplicates']}），近重复隔离 "
        f"{doc['dedup']['semantic_near_duplicate_quarantined']}",
        f"- 结构簇: {doc['dedup']['structural_clusters']}，最大簇 "
        f"{doc['dedup']['largest_structural_share']:.2%}，>10% 模板 "
        f"{doc['dedup']['templates_over_10pct']}",
        f"- distinct mechanism families: {doc['diversity']['distinct_mechanism_families']}/46",
        f"- domains: {doc['diversity']['domains']}",
        f"- complexity: {doc['diversity']['complexity']}",
        "",
        "## 经济性",
        "",
        f"- accepted rate: {doc['economy']['accepted_rate']:.2%}"
        "（不要求达到 Step 的 81.3%，brief §14）",
        f"- accepted / 100k output tokens: {doc['economy']['accepted_per_100k_output_tokens']}",
        "",
        "## 拒绝明细",
        "",
        f"- rejected: {doc['rejection_reasons'] or '（无）'}",
        f"- quarantined: {doc['quarantine_reasons'] or '（无）'}",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Generator-OOD pilot 审计（brief §14）")
    parser.add_argument("--run-id", default=RUN_ID)
    parser.add_argument("--out", default="reports/phase2b/ood-pilot.json")
    parser.add_argument("--md", default="reports/phase2b/ood-pilot.md")
    args = parser.parse_args()

    doc = audit(args.run_id)
    out_path = ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(
        (json.dumps(doc, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    md_path = ROOT / args.md
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_bytes(render(doc).encode("utf-8"))
    print(json.dumps({
        "accepted": doc["accepted"],
        "raw": doc["raw_skeletons"],
        "accepted_rate": doc["economy"]["accepted_rate"],
        "compile_success_rate": doc["compiler"]["compile_success_rate"],
        "internal_compiler_errors": doc["compiler"]["internal_compiler_errors"],
        "oracle_failures": doc["oracle"]["oracle_failures"],
        "frame_success_rate": doc["parse"]["frame_success_rate"],
        "largest_structural_share": doc["dedup"]["largest_structural_share"],
        "accepted_per_100k": doc["economy"]["accepted_per_100k_output_tokens"],
    }, ensure_ascii=False, indent=2))
    print(f"report -> {out_path} / {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
