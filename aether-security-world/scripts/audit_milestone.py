"""Milestone 1 审计与报告（brief J/K/L/M/N/Q 的数据面）。

用法（全部在 aether-security-world/ 下）::

    py -3 scripts/audit_milestone.py            # 全量审计 + 四份报告
    py -3 scripts/audit_milestone.py --smoke    # 只写 reports/provider-smoke.md

输入：worlds/{raw,accepted,rejected,quarantine}/provider-run-001*.jsonl、
state/provider-progress.json、state/provider-coverage.json、provenance/provider-run-001.json。
输出：reports/{milestone-1-summary,structural-audit-100,leakage-audit-100,counterfactual-audit-100}.md
（以及 --smoke 时的 reports/provider-smoke.md）。

原则：所有数字来自落盘记录或重新展开的确定性重算，不估算、不猜语义；审计本身
不修改任何数据集文件。
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

from analysis.pipeline import _family_key, expand_handcrafted_world  # noqa: E402
from security_world.expansion.config import ExpansionConfig  # noqa: E402
from worlds.registry import HandcraftedWorld  # noqa: E402

#: brief L 的标签泄漏可疑词（大小写不敏感、子串匹配——子串命中也值得人看）。
LEAKAGE_MARKERS = [
    "malicious", "unauthorized", "attack", "suspicious", "invalid", "violation",
    "exploit", "forbidden", "blocked", "denied", "benign", "idor", "injection",
    "tamper", "breach", "compromised",
]
#: 合成约定豁免：RFC 6761 保留文档域与 RFC 5737 文档地址段是**强制**的合成主机名/IP
#: 约定（ml 管线的 forbidden_target allowlist 同款），其子串命中不是泄漏。
CONVENTION_PATTERNS = (".invalid", ".example", "192.0.2.", "198.51.100.", "203.0.113.")


def _is_convention_string(text: str) -> bool:
    lowered = text.lower()
    return any(pattern in lowered for pattern in CONVENTION_PATTERNS)


def _canonical(document: Any) -> str:
    return json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def _iter_strings(node: Any, path: str = ""):
    """产出 (json 路径, 字符串值)——只走 model_visible 子树由调用方限定。"""
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, Mapping):
        for key, value in node.items():
            yield from _iter_strings(value, f"{path}.{key}" if path else str(key))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from _iter_strings(value, f"{path}[{index}]")


def load_accepted(run_id: str = "provider-run-001") -> list[dict[str, Any]]:
    return _read_jsonl(ROOT / "worlds" / "accepted" / "milestone-1-100.jsonl")


def expand_accepted(accepted: list[dict[str, Any]], limit: int | None = None) -> dict[str, list[Any]]:
    """重新展开 accepted worlds，返回 world_id -> episodes（确定性重算，可复现）。"""
    out: dict[str, list[Any]] = {}
    selected = accepted if limit is None else accepted[:limit]
    for index, record in enumerate(selected):
        spec_document = record["spec_document"]
        world_id = str(record["world_id"])
        handcrafted = HandcraftedWorld(
            directory=world_id, number=index + 1,
            spec_path=ROOT / "worlds" / "raw" / f"{world_id}.json",
            expected_path=ROOT / "worlds" / "raw" / f"{world_id}.expected.md",
            spec_document=spec_document, expectations={},
        )
        expansion = expand_handcrafted_world(
            handcrafted, config=ExpansionConfig.default(), renderers=("http_request",)
        )
        out[world_id] = list(expansion.episodes)
    return out


# --------------------------------------------------------------------------- #
# J：provider 指标汇总
# --------------------------------------------------------------------------- #
def metrics_section(progress: Mapping[str, Any], provenance: Mapping[str, Any],
                    accepted: list[dict[str, Any]]) -> dict[str, Any]:
    raw = int(progress.get("raw_worlds", 0))
    output_tokens = int(progress.get("output_tokens", 0))
    accepted_count = int(progress.get("accepted", 0))
    rejected = int(progress.get("rejected", 0))
    quarantined = int(progress.get("quarantined", 0))
    batches = provenance.get("batches") or []
    families = Counter(str(record.get("attack_family")) for record in accepted)
    categories = Counter(str(record.get("coverage_category")) for record in accepted)
    complexity = Counter(str(record.get("complexity")) for record in accepted)
    domains = Counter(str(record.get("application_domain")) for record in accepted)
    signatures = Counter(str(record.get("structural_signature")) for record in accepted)
    workflow_topologies = Counter()
    for record in accepted:
        for workflow in (record["spec_document"].get("workflows") or []):
            workflow_topologies[
                (len(workflow.get("states") or []), len(workflow.get("transitions") or []))
            ] += 1
    return {
        "provider_model": provenance.get("generator_model", "step-5-preview"),
        "prompt_version": provenance.get("prompt_version"),
        "prompt_sha256": provenance.get("prompt_sha256"),
        "schema_bundle_sha256": provenance.get("schema_bundle_sha256"),
        "compiler_version": provenance.get("compiler_version"),
        "oracle_version": provenance.get("oracle_version"),
        "batches": len(batches),
        "input_tokens": int(progress.get("input_tokens", 0)),
        "output_tokens": output_tokens,
        "latency_s_total": float(progress.get("latency_s", 0.0)),
        "retries": int(progress.get("retries", 0)),
        "usage_missing_calls": int(progress.get("usage_missing_calls", 0)),
        "raw_worlds": raw,
        "accepted_worlds": accepted_count,
        "rejected": rejected,
        "quarantined": quarantined,
        "acceptance_rate": round(accepted_count / raw, 4) if raw else None,
        "parse_failure_rate": round(int(progress.get("parse_failures", 0)) / max(len(batches), 1), 4),
        "schema_failure_count": int(progress.get("schema_failures", 0)),
        "compile_failure_count": int(progress.get("compile_failures", 0)),
        "oracle_failure_count": int(progress.get("oracle_failures", 0)),
        "duplicate_count": int(progress.get("duplicates", 0)),
        "structural_duplicate_count": int(progress.get("structural_duplicates", 0)),
        "accepted_per_100k_output_tokens": round(accepted_count / output_tokens * 100000, 3) if output_tokens else None,
        "unique_invariant_families": len({
            str(item.get("category") or item.get("invariant_id"))
            for record in accepted for item in (record["spec_document"].get("invariants") or [])
        }),
        "unique_workflow_topologies": len(workflow_topologies),
        "unique_policy_families": len({
            str(rule.get("rule_id") or rule.get("policy_id"))
            for record in accepted for rule in (record["spec_document"].get("policies") or [])
        }),
        "unique_attack_families": len(families),
        "attack_family_distribution": dict(families.most_common()),
        "category_distribution": dict(categories.most_common()),
        "complexity_distribution": dict(complexity.most_common()),
        "domain_distribution": dict(domains.most_common()),
        "top_rejection_reasons": dict(Counter(progress.get("rejection_reasons") or {}).most_common(10)),
    }


# --------------------------------------------------------------------------- #
# K：结构重复审计
# --------------------------------------------------------------------------- #
def structural_audit(accepted: list[dict[str, Any]]) -> dict[str, Any]:
    clusters: dict[str, list[str]] = {}
    for record in accepted:
        clusters.setdefault(str(record["structural_signature"]), []).append(str(record["world_id"]))
    ranked = sorted(clusters.items(), key=lambda item: (-len(item[1]), item[0]))
    total = len(accepted) or 1
    top = [
        {
            "rank": index,
            "structural_signature": signature,
            "size": len(members),
            "share": round(len(members) / total, 4),
            "world_ids": members[:10],
        }
        for index, (signature, members) in enumerate(ranked[:20], start=1)
    ]
    oversized = [item for item in ranked if len(item[1]) / total > 0.10]
    return {
        "cluster_count": len(clusters),
        "largest_cluster_share": round(len(ranked[0][1]) / total, 4) if ranked else 0.0,
        "top20": top,
        "templates_over_10pct": [
            {"structural_signature": signature, "size": len(members),
             "share": round(len(members) / total, 4), "world_ids": members[:10]}
            for signature, members in oversized
        ],
    }


# --------------------------------------------------------------------------- #
# L：标签泄漏审计
# --------------------------------------------------------------------------- #
def leakage_audit(episodes_by_world: Mapping[str, list[Any]]) -> dict[str, Any]:
    """双轨泄漏审计：引擎 G12 判定为**权威发现**；自有子串扫描为参考信息。

    权威轨用 `security_world.validation.lexical.lexical_label_leakage`（与放行门
    同一实现、同一词表、同一豁免规则）——审计与门禁不一致会让报告失去意义。
    参考轨保留裸子串扫描（含被合成约定豁免的字符串），单独计数、不混入发现。
    """
    from security_world.model.config import load_default_config
    from security_world.validation.lexical import lexical_label_leakage, markers_from_config

    markers = markers_from_config(load_default_config())
    findings = []
    informational = []
    scanned = 0
    for world_id, episodes in episodes_by_world.items():
        for episode in episodes:
            scanned += 1
            report = lexical_label_leakage(episode, markers=markers)
            for hit in report.hits:
                findings.append({
                    "world_id": world_id,
                    "episode_id": str(episode.episode_id),
                    "marker": hit.marker,
                    "field": hit.path,
                    "excerpt": hit.excerpt[:160],
                })
            model_visible = episode.observation.get("model_visible")
            if not isinstance(model_visible, Mapping):
                continue
            for field_path, text in _iter_strings(model_visible, "model_visible"):
                lowered = text.lower()
                if not any(marker in lowered for marker in markers):
                    continue
                cleaned = " ".join(
                    token for token in _split_tokens(text) if not _is_convention_string(token)
                ).lower()
                if not any(marker in cleaned for marker in markers):
                    informational.append({
                        "world_id": world_id,
                        "episode_id": str(episode.episode_id),
                        "field": field_path,
                        "excerpt": text[:160],
                        "note": "合成约定（保留文档域/IP）子串命中，引擎规则豁免",
                    })
    return {
        "episodes_scanned": scanned,
        "markers": list(markers),
        "findings": findings,
        "finding_count": len(findings),
        "informational_convention_hits": len(informational),
    }


def _split_tokens(text: str) -> list[str]:
    """把一段文本按非主机字符粗切，用于剥掉合成约定主机名/IP token。"""
    tokens = []
    current = []
    for char in text:
        if char.isalnum() or char in ".-_/:":
            current.append(char)
        else:
            if current:
                tokens.append("".join(current))
                current = []
    if current:
        tokens.append("".join(current))
    return tokens


# --------------------------------------------------------------------------- #
# M：反事实现实核查
# --------------------------------------------------------------------------- #
def _oracle_doc(oracle_output: Any) -> Mapping[str, Any]:
    """oracle_output 可能是 dataclass（OracleOutput）或 document；统一成文档视图。"""
    if isinstance(oracle_output, Mapping):
        return oracle_output
    to_document = getattr(oracle_output, "to_document", None)
    if callable(to_document):
        document = to_document()
        if isinstance(document, Mapping):
            return document
    return {
        "world_truth": getattr(oracle_output, "world_truth", None),
        "observable_decision": getattr(oracle_output, "observable_decision", None),
    }


def _truth(episode: Any) -> str:
    return str(_oracle_doc(episode.oracle_output).get("world_truth"))


def _observable(episode: Any) -> str:
    return str(_oracle_doc(episode.oracle_output).get("observable_decision"))


def counterfactual_audit(episodes_by_world: Mapping[str, list[Any]]) -> dict[str, Any]:
    stats = {
        "worlds_audited": len(episodes_by_world),
        "critical_intervention": {"total": 0, "flip_expected": 0, "flip_observed": 0,
                                  "invariant_expected": 0, "invariant_observed": 0,
                                  "downgrade_expected": 0, "downgrade_observed": 0, "mismatches": []},
        "irrelevant_perturbation": {"total": 0, "verdict_identical": 0, "mismatches": []},
        "evidence_masked": {"total": 0, "insufficient_level": 0,
                            "insufficient_observable": 0, "mismatches": []},
    }
    for world_id, episodes in episodes_by_world.items():
        bases: dict[str, Any] = {}
        for episode in episodes:
            if episode.variant_type == "base":
                bases[str(episode.counterfactual_family_id)] = episode
        for episode in episodes:
            base = bases.get(str(episode.counterfactual_family_id))
            if base is None:
                continue
            base_truth = _truth(base)
            base_observable = _observable(base)
            truth = _truth(episode)
            observable = _observable(episode)
            if episode.variant_type == "critical_intervention":
                bucket = stats["critical_intervention"]
                bucket["total"] += 1
                expected = str((episode.intervention or {}).get("expected_effect"))
                flipped = truth != base_truth
                downgraded = observable != base_observable
                if expected == "verdict_flip":
                    bucket["flip_expected"] += 1
                    bucket["flip_observed"] += 1 if flipped else 0
                    if not flipped:
                        bucket["mismatches"].append(_case(world_id, episode, "verdict_flip_expected_no_flip"))
                elif expected == "verdict_invariant":
                    bucket["invariant_expected"] += 1
                    bucket["invariant_observed"] += 1 if not flipped else 0
                    if flipped:
                        bucket["mismatches"].append(_case(world_id, episode, "verdict_invariant_expected_but_flipped"))
                elif expected == "observable_downgrade":
                    bucket["downgrade_expected"] += 1
                    bucket["downgrade_observed"] += 1 if downgraded else 0
                    if not downgraded:
                        bucket["mismatches"].append(_case(world_id, episode, "downgrade_expected_no_change"))
            elif episode.variant_type == "irrelevant_perturbation":
                bucket = stats["irrelevant_perturbation"]
                bucket["total"] += 1
                if _canonical(_oracle_doc(episode.oracle_output)) == _canonical(_oracle_doc(base.oracle_output)):
                    bucket["verdict_identical"] += 1
                else:
                    bucket["mismatches"].append(_case(world_id, episode, "irrelevant_perturbation_changed_verdict"))
            elif episode.variant_type == "evidence_masked":
                bucket = stats["evidence_masked"]
                bucket["total"] += 1
                metadata = episode.observation.get("decision_metadata") or {}
                level = str(metadata.get("evidence_availability_level"))
                if level == "insufficient":
                    bucket["insufficient_level"] += 1
                    if observable == "insufficient_evidence":
                        bucket["insufficient_observable"] += 1
                    else:
                        bucket["mismatches"].append(_case(world_id, episode, "insufficient_level_but_observable_not_insufficient"))
    for key in ("critical_intervention", "irrelevant_perturbation", "evidence_masked"):
        bucket = stats[key]
        for rate_key, num_key, den_key in (
            ("flip_rate", "flip_observed", "flip_expected"),
            ("invariance_rate", "invariant_observed", "invariant_expected"),
            ("downgrade_rate", "downgrade_observed", "downgrade_expected"),
            ("verdict_identical_rate", "verdict_identical", "total"),
            ("masking_validity_rate", "insufficient_observable", "insufficient_level"),
        ):
            if num_key in bucket:
                denominator = bucket.get(den_key, 0)
                bucket[rate_key] = round(bucket[num_key] / denominator, 4) if denominator else None
    return stats


def _case(world_id: str, episode: Any, kind: str) -> dict[str, Any]:
    return {
        "kind": kind,
        "world_id": world_id,
        "episode_id": str(episode.episode_id),
        "variant_type": episode.variant_type,
        "intervention": dict(episode.intervention) if episode.intervention else None,
        "oracle_output": {
            "world_truth": _truth(episode),
            "observable_decision": _observable(episode),
        },
    }


# --------------------------------------------------------------------------- #
# 报告
# --------------------------------------------------------------------------- #
def write_reports(metrics: Mapping[str, Any], structural: Mapping[str, Any],
                  leakage: Mapping[str, Any], counterfactual: Mapping[str, Any]) -> list[Path]:
    reports = ROOT / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    written = []

    target_met = metrics["accepted_worlds"] >= 100
    summary_lines = [
        "# Milestone 1 汇总（accepted worlds；目标 100 未达成时如实标注）",
        "",
        f"- **目标达成度: {metrics['accepted_worlds']}/100 accepted"
        + ("（达成）" if target_met else "（未达成：被 brief 预设停止线拦下，原因见 TOP FAILURES）") + "**",
        "",
        "## PROVIDER",
        f"- model: {metrics['provider_model']}",
        f"- prompt_version: {metrics['prompt_version']}（sha256 {metrics['prompt_sha256']}）",
        f"- schema_bundle_sha256: {metrics['schema_bundle_sha256']}",
        f"- compiler_version: {metrics['compiler_version']} / oracle_version: {metrics['oracle_version']}",
        f"- batches: {metrics['batches']}；input_tokens: {metrics['input_tokens']}；"
        f"output_tokens: {metrics['output_tokens']}",
        f"- latency 合计: {metrics['latency_s_total']}s；retries: {metrics['retries']}；"
        f"usage 缺失调用: {metrics['usage_missing_calls']}",
        "",
        "## GENERATION",
        f"- raw: {metrics['raw_worlds']}；accepted: {metrics['accepted_worlds']}；"
        f"rejected: {metrics['rejected']}；quarantined: {metrics['quarantined']}",
        f"- acceptance_rate: {metrics['acceptance_rate']}；"
        f"accepted/100k output tokens: {metrics['accepted_per_100k_output_tokens']}",
        "",
        "## QUALITY",
        f"- schema 失败: {metrics['schema_failure_count']}；compile 失败: {metrics['compile_failure_count']}；"
        f"oracle 失败: {metrics['oracle_failure_count']}",
        f"- 重复: {metrics['duplicate_count']}；结构重复: {metrics['structural_duplicate_count']}",
        f"- 结构聚类数: {structural['cluster_count']}；最大簇占比: {structural['largest_cluster_share']}；"
        f">10% 模板数: {len(structural['templates_over_10pct'])}",
        f"- 泄漏发现: {leakage['finding_count']}（扫描 episode {leakage['episodes_scanned']} 个）",
        "",
        "## COUNTERFACTUAL",
        f"- critical intervention: {counterfactual['critical_intervention']}",
        f"- irrelevant perturbation: {counterfactual['irrelevant_perturbation']}",
        f"- evidence masked: {counterfactual['evidence_masked']}",
        "",
        "## COVERAGE",
        f"- 类别分布: {metrics['category_distribution']}",
        f"- 复杂度分布: {metrics['complexity_distribution']}",
        f"- 领域分布: {metrics['domain_distribution']}",
        f"- 唯一不变量族: {metrics['unique_invariant_families']}；"
        f"唯一工作流拓扑: {metrics['unique_workflow_topologies']}；"
        f"唯一 attack family: {metrics['unique_attack_families']}",
        "",
        "## TOP FAILURES（拒绝/隔离原因 Top 10）",
    ]
    for reason, count in metrics["top_rejection_reasons"].items():
        summary_lines.append(f"- {reason}: {count}")
    path = reports / "milestone-1-summary.md"
    path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")
    written.append(path)

    structural_lines = [
        "# 结构重复审计（accepted worlds 全量）",
        "",
        f"- 结构签名聚类数: {structural['cluster_count']}",
        f"- 最大簇占比: {structural['largest_cluster_share']}",
        f"- 占比 >10% 的模板数: {len(structural['templates_over_10pct'])}"
        + ("（**必须明确报告：存在主导模板**）" if structural["templates_over_10pct"] else ""),
        "",
        "## Top 20 结构簇",
    ]
    for item in structural["top20"]:
        structural_lines.append(
            f"{item['rank']}. size={item['size']} share={item['share']} "
            f"signature={item['structural_signature'][:16]}… worlds={', '.join(item['world_ids'])}"
        )
    path = reports / "structural-audit-100.md"
    path.write_text("\n".join(structural_lines) + "\n", encoding="utf-8")
    written.append(path)

    leakage_lines = [
        "# 标签泄漏审计（accepted worlds 的全部 episode）",
        "",
        f"- 扫描 episode 数: {leakage['episodes_scanned']}",
        f"- 发现数: {leakage['finding_count']}",
        "- 规则：decision_metadata 侧允许出现这些词；model_visible 侧出现即可疑（brief L）。",
        "",
    ]
    for finding in leakage["findings"][:100]:
        leakage_lines.append(
            f"- {finding['world_id']} / {finding['episode_id']} / {finding['field']} "
            f"命中 `{finding['marker']}`：{finding['excerpt'][:120]!r}"
        )
    if leakage["finding_count"] > 100:
        leakage_lines.append(f"- …其余 {leakage['finding_count'] - 100} 条见 JSONL 全量输出")
    path = reports / "leakage-audit-100.md"
    path.write_text("\n".join(leakage_lines) + "\n", encoding="utf-8")
    written.append(path)

    cf_lines = [
        "# 反事实现实核查（≥30 accepted worlds）",
        "",
        f"- 审计 world 数: {counterfactual['worlds_audited']}",
        "",
        "## critical intervention",
    ]
    ci = counterfactual["critical_intervention"]
    cf_lines += [
        f"- 总数: {ci['total']}",
        f"- verdict_flip: 预期 {ci['flip_expected']} / 实际翻转 {ci['flip_observed']}"
        + (f"（rate {ci.get('flip_rate')}）" if ci.get("flip_rate") is not None else ""),
        f"- verdict_invariant: 预期 {ci['invariant_expected']} / 实际不变 {ci['invariant_observed']}"
        + (f"（rate {ci.get('invariance_rate')}）" if ci.get("invariance_rate") is not None else ""),
        f"- observable_downgrade: 预期 {ci['downgrade_expected']} / 实际降级 {ci['downgrade_observed']}"
        + (f"（rate {ci.get('downgrade_rate')}）" if ci.get("downgrade_rate") is not None else ""),
        f"- 不匹配案例: {len(ci['mismatches'])}",
    ]
    ip = counterfactual["irrelevant_perturbation"]
    cf_lines += [
        "",
        "## irrelevant perturbation",
        f"- 总数: {ip['total']}；判决逐字节一致: {ip['verdict_identical']}"
        + (f"（rate {ip.get('verdict_identical_rate')}）" if ip.get("verdict_identical_rate") is not None else ""),
        f"- 不匹配案例: {len(ip['mismatches'])}",
    ]
    em = counterfactual["evidence_masked"]
    cf_lines += [
        "",
        "## evidence masking",
        f"- masked 变体总数: {em['total']}；level=insufficient: {em['insufficient_level']}；"
        f"其中 observable=insufficient_evidence: {em['insufficient_observable']}"
        + (f"（rate {em.get('masking_validity_rate')}）" if em.get("masking_validity_rate") is not None else ""),
        f"- 不匹配案例: {len(em['mismatches'])}",
        "",
        "## 失败案例（保存具体案例，brief M）",
    ]
    all_cases = ci["mismatches"] + ip["mismatches"] + em["mismatches"]
    for case in all_cases[:50]:
        cf_lines.append(f"- {case['kind']} | {case['world_id']} | {case['episode_id']} | {case['oracle_output']}")
    path = reports / "counterfactual-audit-100.md"
    path.write_text("\n".join(cf_lines) + "\n", encoding="utf-8")
    written.append(path)

    # 全量案例同时落 JSONL，便于后续程序化复查。
    cases_path = reports / "counterfactual-audit-100.cases.jsonl"
    with cases_path.open("w", encoding="utf-8") as handle:
        for case in all_cases:
            handle.write(json.dumps(case, ensure_ascii=False, sort_keys=True) + "\n")
    written.append(cases_path)
    return written


def write_smoke_report() -> Path | None:
    """reports/provider-smoke.md：从 provider-run-001 的第一批产物生成。"""
    progress_path = ROOT / "state" / "provider-progress.json"
    provenance_path = ROOT / "provenance" / "provider-run-001.json"
    if not progress_path.is_file() or not provenance_path.is_file():
        return None
    progress = json.loads(progress_path.read_text(encoding="utf-8"))
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    batches = provenance.get("batches") or []
    first = batches[0] if batches else {}
    raw_records = _read_jsonl(ROOT / "worlds" / "raw" / "provider-run-001.jsonl")
    first_ids = {str(record.get("raw_generation_id")) for record in raw_records
                 if str(record.get("raw_generation_id")) == str(first.get("raw_generation_id"))}
    smoke_raw = [record for record in raw_records if str(record.get("raw_generation_id")) in first_ids]
    lines = [
        "# Provider Smoke（第一批真实生成）",
        "",
        f"- model: {first.get('model')}；raw_generation_id: {first.get('raw_generation_id')}",
        f"- input_tokens: {first.get('input_tokens')}；output_tokens: {first.get('output_tokens')}；"
        f"latency: {first.get('latency_s')}s；retries: {first.get('retries')}",
        f"- 解析出 worlds: {first.get('specs_parsed')}；元素级拒绝: {first.get('element_rejections')}",
        f"- 帧哈希: prompt_sha256={first.get('prompt_sha256')} schema_bundle={first.get('schema_bundle_sha256')}",
        "",
        "## 本批 worlds",
    ]
    for record in smoke_raw:
        lines.append(
            f"- {record.get('world_id')} | {record.get('application_domain')} | "
            f"{record.get('attack_family')} | complexity={record.get('complexity')}"
        )
    lines += [
        "",
        "## 累积状态",
        f"- raw={progress.get('raw_worlds')} accepted={progress.get('accepted')} "
        f"quarantined={progress.get('quarantined')} rejected={progress.get('rejected')}",
        f"- 拒绝原因: {progress.get('rejection_reasons')}",
    ]
    path = ROOT / "reports" / "provider-smoke.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Milestone 1 审计与报告")
    parser.add_argument("--smoke", action="store_true", help="只写 reports/provider-smoke.md")
    parser.add_argument("--cf-worlds", type=int, default=30, help="反事实审计抽取的 world 数（brief M：≥30）")
    args = parser.parse_args()

    if args.smoke:
        path = write_smoke_report()
        print(f"smoke report: {path}")
        return 0 if path else 1

    progress = json.loads((ROOT / "state" / "provider-progress.json").read_text(encoding="utf-8"))
    provenance = json.loads((ROOT / "provenance" / "provider-run-001.json").read_text(encoding="utf-8"))
    accepted = load_accepted()
    if not accepted:
        print("没有 accepted worlds：先跑 provider_run.py milestone")
        return 1
    metrics = metrics_section(progress, provenance, accepted)
    structural = structural_audit(accepted)
    episodes_by_world = expand_accepted(accepted)
    leakage = leakage_audit(episodes_by_world)
    counterfactual = counterfactual_audit(
        {world_id: episodes for world_id, episodes in list(episodes_by_world.items())[: args.cf_worlds]}
    )
    written = write_reports(metrics, structural, leakage, counterfactual)
    summary_path = ROOT / "reports" / "milestone-1-summary.md"
    (ROOT / "reports" / "milestone-1-metrics.json").write_text(
        json.dumps({"metrics": metrics, "structural": structural,
                    "leakage_summary": {"finding_count": leakage["finding_count"],
                                        "episodes_scanned": leakage["episodes_scanned"]},
                    "counterfactual": counterfactual}, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8")
    for path in written:
        print(f"written: {path}")
    print(f"written: {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
