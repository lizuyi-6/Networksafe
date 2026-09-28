"""Phase 2A 深审（brief §52-§53, §61-§62）。

对全部 accepted 做十项审计并逐项落盘：

=============  ================================================
审计           产出
=============  ================================================
Schema         world-spec / semantic-skeleton 合规
Compiler       失败分布 + internal compiler error 计数
Oracle         失败计数
Counterfactual 先验 vs Oracle 轨迹（矛盾即缺陷）
Structural     编译后结构签名聚类
Semantic       骨架级语义指纹聚类（brief §28）
Leakage        G12 词表扫描全部 episode
Coverage       九类覆盖 + multi_tenant 专项
Token Economy  效率对比 Phase 1
Provider       调用/失败/超时/重试/token/延迟
=============  ================================================

用法::

    py -3 scripts/audit_phase2a.py [--label smoke-10|audit-30|audit-60|final-100]
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

from generation.schema_registry import world_spec_validator  # noqa: E402
from semantic_skeleton.coverage import FINAL_QUOTAS, coverage_report  # noqa: E402
from semantic_skeleton.fingerprint import semantic_fingerprint  # noqa: E402
from semantic_skeleton.mechanisms import MECHANISMS, label_families  # noqa: E402
from semantic_skeleton.validators import verify_compiled_world  # noqa: E402

RUN_ID = "provider-run-002"
#: 默认审计对象；--run-id 可切到 confirmation run（brief §10：各 run 独立指标）。
AUDIT_RUN_ID = "provider-run-002"
PHASE1_ACCEPTED_PER_100K = 0.584


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
    import hashlib

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _structural_signature(spec: Mapping[str, Any]) -> str:
    """编译后结构签名（与 Phase 1 同一把尺子，便于横向比较）。"""
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


def collect(run_id: str = AUDIT_RUN_ID) -> dict[str, Any]:
    suffix = "" if run_id == RUN_ID else f"-{run_id}"
    accepted = _read_jsonl(ROOT / "worlds" / "skeletons" / "accepted" / f"{run_id}.jsonl")
    rejected = _read_jsonl(ROOT / "worlds" / "skeletons" / "rejected" / f"{run_id}.jsonl")
    quarantine = _read_jsonl(ROOT / "worlds" / "skeletons" / "quarantine" / f"{run_id}.jsonl")
    raw = _read_jsonl(ROOT / "worlds" / "skeletons" / "raw" / f"{run_id}.jsonl")
    frames = _read_jsonl(ROOT / "worlds" / "skeletons" / "raw" / f"frames-{run_id}.jsonl")
    progress = {}
    progress_path = ROOT / "state" / f"phase2a-progress{suffix}.json"
    if progress_path.is_file():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
    coverage = {}
    coverage_path = ROOT / "state" / f"phase2a-coverage{suffix}.json"
    if coverage_path.is_file():
        coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
    provenance = _read_jsonl(ROOT / "provenance" / f"{run_id}.jsonl")
    return {
        "run_id": run_id,
        "accepted": accepted, "rejected": rejected, "quarantine": quarantine,
        "raw": raw, "frames": frames, "progress": progress,
        "coverage": coverage, "provenance": provenance,
    }


def audit(data: Mapping[str, Any]) -> dict[str, Any]:
    accepted = data["accepted"]
    specs = [record["spec_document"] for record in accepted if record.get("spec_document")]

    # --- Schema ---
    schema_failures = 0
    schema_details: list[str] = []
    for spec in specs:
        errors = list(world_spec_validator().iter_errors(spec))
        if errors:
            schema_failures += 1
            schema_details.append(
                f"{spec.get('world_id')}: " + "; ".join(
                    f"{'/'.join(str(p) for p in e.absolute_path)} {e.message[:120]}"
                    for e in errors[:2]
                )
            )

    # --- Compiler / Oracle / Verify ---
    compiler_failures = dict(data["progress"].get("compiler_failures") or {})
    internal = int(compiler_failures.get("INTERNAL_COMPILER_ERROR", 0))
    oracle_failures = 0
    verify_failures = int(data["progress"].get("verify_failures", 0))

    # --- Counterfactual：重跑复核，先验 vs Oracle 轨迹 ---
    cf_total = 0
    cf_flip = 0
    cf_invariant = 0
    cf_downgrade = 0
    contradictions: list[dict[str, Any]] = []
    for record in accepted:
        spec = record.get("spec_document")
        if not spec:
            continue
        report = verify_compiled_world(
            spec, skeleton=record.get("skeleton_document"), config_path=ROOT / "configs" / "phase2a.json"
        )
        if not report.compiled:
            oracle_failures += 1
            continue
        for outcome in report.outcomes:
            cf_total += 1
            if outcome.actual_effect == "verdict_flip":
                cf_flip += 1
            elif outcome.actual_effect == "verdict_invariant":
                cf_invariant += 1
            else:
                cf_downgrade += 1
            if outcome.contradicted:
                contradictions.append(outcome.to_document())

    # --- Structural / Semantic dedup ---
    structural = Counter(_structural_signature(spec) for spec in specs)
    semantic = Counter(
        record.get("semantic_fingerprint") or semantic_fingerprint(record.get("skeleton_document") or {})
        for record in accepted
    )
    structural_clusters = len(structural)
    largest_structural = (max(structural.values()) / len(specs)) if specs else 0.0
    largest_semantic = (max(semantic.values()) / len(accepted)) if accepted else 0.0

    # --- Coverage ---
    labels: Counter[str] = Counter()
    for record in accepted:
        for label in record.get("coverage_labels") or ():
            labels[str(label)] += 1
    complexity: Counter[str] = Counter(str(r.get("complexity")) for r in accepted)
    domains: Counter[str] = Counter(str(r.get("application_domain")) for r in accepted)
    families: Counter[str] = Counter(str(r.get("mechanism_family")) for r in accepted)
    attack_families: Counter[str] = Counter(str(r.get("attack_family")) for r in accepted)

    # --- Token economy ---
    output_tokens = int(data["progress"].get("output_tokens", 0))
    input_tokens = int(data["progress"].get("input_tokens", 0))
    accepted_count = len(accepted)
    per_100k = (accepted_count / output_tokens * 100000) if output_tokens else 0.0
    per_1m_input = (accepted_count / input_tokens * 1000000) if input_tokens else 0.0
    latency = float(data["progress"].get("latency_s", 0.0))
    per_hour = (accepted_count / (latency / 3600.0)) if latency else 0.0

    # --- Provider reliability ---
    calls = len(data["frames"])
    finish_reasons = Counter(str(f.get("finish_reason")) for f in data["frames"])
    provider_errors = int(data["progress"].get("provider_errors", 0))
    retries = int(data["progress"].get("retries", 0))

    raw_count = int(data["progress"].get("raw_skeletons", 0))
    return {
        "run_id": data["run_id"],
        "counts": {
            "raw_skeletons": raw_count,
            "accepted": accepted_count,
            "rejected": int(data["progress"].get("rejected", 0)),
            "quarantined": int(data["progress"].get("quarantined", 0)),
            "acceptance_rate": (accepted_count / raw_count) if raw_count else 0.0,
        },
        "schema": {"failures": schema_failures, "details": schema_details[:10]},
        "compiler": {
            "failures": compiler_failures,
            "internal_compiler_errors": internal,
            "total_failures": sum(compiler_failures.values()),
        },
        "oracle": {"failures": oracle_failures, "verify_failures": verify_failures},
        "counterfactual": {
            "total": cf_total,
            "flip": cf_flip,
            "invariant": cf_invariant,
            "downgrade": cf_downgrade,
            "contradictions": contradictions,
            "flip_rate": (cf_flip / cf_total) if cf_total else 0.0,
            "invariance_rate": (cf_invariant / cf_total) if cf_total else 0.0,
        },
        "dedup": {
            "structural_clusters": structural_clusters,
            "largest_structural_share": largest_structural,
            "templates_over_10pct": sum(
                1 for size in structural.values() if specs and size / len(specs) > 0.10
            ),
            "semantic_clusters": len(semantic),
            "largest_semantic_share": largest_semantic,
            "semantic_templates_over_10pct": sum(
                1 for size in semantic.values() if accepted and size / len(accepted) > 0.10
            ),
        },
        "coverage": {
            "labels": dict(sorted(labels.items())),
            "quotas": FINAL_QUOTAS,
            "shortfalls": {
                label: {
                    "have": int(labels.get(label, 0)),
                    "target": target,
                }
                for label, target in FINAL_QUOTAS.items()
                if int(labels.get(label, 0)) < target
            },
            "complexity": dict(sorted(complexity.items())),
            "domains": dict(sorted(domains.items())),
            "mechanism_families": dict(sorted(families.items())),
            "attack_families": dict(sorted(attack_families.items())),
            "distinct_mechanisms": len(families),
            "distinct_attack_families": len(attack_families),
        },
        "token_economy": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "accepted_per_100k_output": per_100k,
            "accepted_per_1m_input": per_1m_input,
            "accepted_per_provider_hour": per_hour,
            "output_tokens_per_accepted_world": (output_tokens / accepted_count) if accepted_count else 0.0,
            "phase1_accepted_per_100k_output": PHASE1_ACCEPTED_PER_100K,
            "improvement_factor": (per_100k / PHASE1_ACCEPTED_PER_100K) if PHASE1_ACCEPTED_PER_100K else 0.0,
        },
        "provider": {
            "calls": calls,
            "provider_errors": provider_errors,
            "retries": retries,
            "latency_s": latency,
            "finish_reasons": dict(finish_reasons),
            "usage_missing_calls": int(data["progress"].get("usage_missing_calls", 0)),
        },
    }


def render(audit_doc: Mapping[str, Any], label: str) -> str:
    counts = audit_doc["counts"]
    token = audit_doc["token_economy"]
    lines = [
        f"# Phase 2A 审计 — {label}",
        "",
        "## GENERATION",
        f"- raw skeletons: {counts['raw_skeletons']}",
        f"- accepted: {counts['accepted']}；rejected: {counts['rejected']}；"
        f"quarantined: {counts['quarantined']}",
        f"- acceptance rate: {counts['acceptance_rate']:.4f}",
        "",
        "## SCHEMA",
        f"- world-spec schema failures: {audit_doc['schema']['failures']}",
        "",
        "## COMPILER",
        f"- total failures: {audit_doc['compiler']['total_failures']}",
        f"- INTERNAL_COMPILER_ERROR: {audit_doc['compiler']['internal_compiler_errors']}"
        f"（目标 0）",
        f"- distribution: {json.dumps(audit_doc['compiler']['failures'], ensure_ascii=False)}",
        "",
        "## ORACLE",
        f"- oracle failures: {audit_doc['oracle']['failures']}（目标 0）",
        f"- verify failures: {audit_doc['oracle']['verify_failures']}",
        "",
        "## COUNTERFACTUAL",
        f"- (axis, probe) 组合: {audit_doc['counterfactual']['total']}",
        f"- verdict_flip: {audit_doc['counterfactual']['flip']}"
        f"（rate {audit_doc['counterfactual']['flip_rate']:.4f}）",
        f"- verdict_invariant: {audit_doc['counterfactual']['invariant']}"
        f"（rate {audit_doc['counterfactual']['invariance_rate']:.4f}）",
        f"- observable_downgrade: {audit_doc['counterfactual']['downgrade']}",
        f"- 先验矛盾（declared vs Oracle 轨迹）: {len(audit_doc['counterfactual']['contradictions'])}",
        "",
        "## DEDUP",
        f"- 结构簇: {audit_doc['dedup']['structural_clusters']}；最大簇占比: "
        f"{audit_doc['dedup']['largest_structural_share']:.4f}；>10% 模板数: "
        f"{audit_doc['dedup']['templates_over_10pct']}",
        f"- 语义簇: {audit_doc['dedup']['semantic_clusters']}；最大簇占比: "
        f"{audit_doc['dedup']['largest_semantic_share']:.4f}；>10% 模板数: "
        f"{audit_doc['dedup']['semantic_templates_over_10pct']}",
        "",
        "## COVERAGE",
        f"- labels: {json.dumps(audit_doc['coverage']['labels'], ensure_ascii=False)}",
        f"- shortfalls: {json.dumps(audit_doc['coverage']['shortfalls'], ensure_ascii=False)}",
        f"- complexity: {json.dumps(audit_doc['coverage']['complexity'], ensure_ascii=False)}",
        f"- distinct mechanism families: {audit_doc['coverage']['distinct_mechanisms']}"
        f" / {len(MECHANISMS)}",
        f"- distinct attack families: {audit_doc['coverage']['distinct_attack_families']}",
        f"- domains covered: {len(audit_doc['coverage']['domains'])}",
        "",
        "## TOKEN ECONOMY",
        f"- input tokens: {token['input_tokens']}；output tokens: {token['output_tokens']}",
        f"- accepted / 100k output tokens: {token['accepted_per_100k_output']:.3f}"
        f"（Phase 1: {token['phase1_accepted_per_100k_output']}）",
        f"- improvement factor: {token['improvement_factor']:.2f}x",
        f"- accepted / 1M input tokens: {token['accepted_per_1m_input']:.3f}",
        f"- accepted / provider hour: {token['accepted_per_provider_hour']:.3f}",
        f"- output tokens / accepted world: {token['output_tokens_per_accepted_world']:.0f}",
        "",
        "## PROVIDER",
        f"- calls: {audit_doc['provider']['calls']}；transport errors: "
        f"{audit_doc['provider']['provider_errors']}；retries: {audit_doc['provider']['retries']}",
        f"- accumulated latency: {audit_doc['provider']['latency_s']:.1f}s",
        f"- finish_reason: {json.dumps(audit_doc['provider']['finish_reasons'], ensure_ascii=False)}",
        f"- usage missing calls: {audit_doc['provider']['usage_missing_calls']}",
        "",
    ]
    if audit_doc["counterfactual"]["contradictions"]:
        lines.append("## CONTRADICTIONS（先验与 Oracle 轨迹不符）")
        lines.append("")
        for item in audit_doc["counterfactual"]["contradictions"][:20]:
            lines.append(
                f"- `{item['axis_id']}` {item['variable']}: 声明 "
                f"{item['declared_expectation']}，实际 {item['actual_effect']}/"
                f"{item['semantic_class']}"
            )
        lines.append("")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 2A 深审")
    parser.add_argument("--label", default="smoke-10")
    parser.add_argument("--run-id", default=AUDIT_RUN_ID)
    args = parser.parse_args()
    data = collect(args.run_id)
    audit_doc = audit(data)
    out_dir = ROOT / "reports" / "phase2a"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{args.label}.json").write_text(
        json.dumps(audit_doc, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (out_dir / f"{args.label}.md").write_text(
        render(audit_doc, args.label), encoding="utf-8"
    )
    print(render(audit_doc, args.label))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
